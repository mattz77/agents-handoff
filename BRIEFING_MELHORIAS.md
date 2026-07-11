# Briefing de Melhorias — Antigravity Handoff Daemon v7.0

> Análise de arquitetura ponta a ponta do sistema de handoff entre agentes de IA (Claude Code ↔ Antigravity/Gemini), com correções críticas, débitos técnicos e oportunidades de evolução.
> Data: 14/06/2026

---

## 1. O que o sistema faz hoje (entendimento)

O daemon orquestra **handoffs de contexto entre dois agentes de codificação** (Claude Code e Gemini/Antigravity) e dispara notificações operacionais. Fluxo real:

1. **Wrappers** (`claude-smart-wrap`, `antigravity-smart-wrap`) envolvem os CLIs e detectam esgotamento de cota por **sinal estruturado** (`--error-format=json`, HTTP 429/529/503, exit codes 75/78) — não por scraping de texto. Bom design.
2. Ao detectar limite, compilam **contexto mínimo** (branch, HEAD, diff-stat) e publicam um evento assinado (HMAC) no Redis.
3. **Producer** publica `HandoffEnvelope` no stream `handoff:stream` com **dedupe atômico** (`SET NX` na idempotency key) e `MAXLEN ~100k`.
4. **Consumer** (consumer group `g:ops`) lê com `xreadgroup`, recupera órfãs com `xautoclaim`, faz retry com backoff exponencial (cap 60s, máx 5 tentativas) e move falhas para **DLQ** `handoff:dlq` + alerta em `ops:alerts`.
5. **Outbox transacional**: `applyHandoffTransition` grava auditoria + evento de efeito colateral **na mesma transação Postgres**; `drainOutbox` faz polling com `FOR UPDATE SKIP LOCKED` e entrega via webhook assinado ao **n8n**.
6. **n8n** valida HMAC e dispara WhatsApp (Evolution API) / e-mail. Há também um orquestrador de fallback bidirecional.
7. **Infra**: Redis em alta disponibilidade (1 master + 2 réplicas + 3 Sentinels), Postgres (compartilhado com o n8n), Docker Compose com secrets e socket-proxy.

**Veredito geral:** a fundação está acima da média — outbox pattern, idempotência no producer, DLQ, Sentinel HA e detecção estruturada de erro são decisões maduras. Os problemas estão na **execução incompleta** de alguns padrões e em **lacunas de segurança e observabilidade**.

---

## 2. Correções críticas (fazer primeiro)

### 2.1 🔴 Segredo vazado: API key do n8n hardcoded
`scripts/n8n-deploy.ps1` tem o **JWT da API do n8n em texto puro** e versionável. Há ainda `secrets/redis_secret.txt` e `.env` sem `.gitignore` (o diretório não tem git inicializado, mas qualquer `git init` + push vaza tudo).

**Ação:** rotacionar o JWT do n8n imediatamente; mover para variável de ambiente / secret manager; criar `.gitignore` cobrindo `.env`, `secrets/`, `dist/`, `node_modules/`. Antipattern: credencial de longa duração em script de deploy.

### 2.2 🔴 Verificação HMAC quebra no n8n (mismatch de bytes)
`n8n-webhook-validator.js` recalcula a assinatura com `JSON.stringify($json)` — mas o daemon assina o **corpo bruto** (`JSON.stringify(row)` em `outbox.ts`). A reserialização do n8n reordena chaves/espaços → assinatura **nunca bate** de forma confiável. Além disso, `timingSafeEqual` **lança exceção** se os buffers tiverem tamanhos diferentes (assinatura ausente/curta derruba o fluxo).

**Ação:** assinar e validar sobre o **raw body** (bytes idênticos), nunca sobre objeto reserializado. Comparar comprimento antes do `timingSafeEqual`. Padronizar canonicalização (ex.: JCS) se precisar reserializar.

### 2.3 🔴 Sleep bloqueante no loop do consumer
Em `consumer.ts`, `onFailure` faz `await setTimeout(backoffMs(attempt))` **dentro** do loop single-thread. Um backoff de até 60s **congela o processamento de todas as outras mensagens** do worker. Isso anula o throughput e o propósito do consumer group.

**Ação:** não dormir in-band. Use re-entrega agendada (campo `not_before`/sorted-set de delay no Redis, ou stream de retry com timestamp) e siga processando o lote. O backoff deve ser por-mensagem, fora do caminho quente.

### 2.4 🔴 Circuit breaker é código morto
`circuit-breaker.ts` está implementado mas **nunca é chamado** — nem no `deliverEffect` (webhook), nem no consumer. Ou seja, a proteção contra cascata de falhas do n8n/WhatsApp não existe na prática.

**Ação:** envolver a chamada de webhook em `callWithBreaker('n8n-webhook', ...)`. Sem isso, um n8n fora do ar gera retentativas infinitas.

### 2.5 🔴 `fetch` sem timeout no drainOutbox
`deliverEffect` faz `fetch` sem `AbortController`. Um webhook lento/pendurado **trava o drenador inteiro** (loop sequencial). Combinado com 2.3, o sistema pode parar por completo.

**Ação:** `AbortController` com timeout (ex.: 5s) + jitter no backoff.

---

## 3. Débitos técnicos de confiabilidade

### 3.1 🟠 Outbox sem idempotência → notificações duplicadas
A tabela `outbox` não tem unique key por `(aggregate_id, event_type)` nem dedup_key. Como o retry do consumer **re-publica** o envelope (novo stream entry) e `applyHandoffTransition` roda de novo, o `INSERT` no outbox pode **duplicar o efeito** (WhatsApp enviado 2x). O `ON CONFLICT` cobre `handoffs`, mas não `outbox`.

**Ação:** adicionar `unique (aggregate_id, event_type)` ou um `dedup_key` determinístico + `ON CONFLICT DO NOTHING`.

### 3.2 🟠 Outbox sem backoff agendado (hot-loop)
Linhas `FAILED`/`PENDING` que falham são re-tentadas a cada 2s sem `next_attempt_at`. Falha persistente vira **busy-loop** martelando o n8n.

**Ação:** coluna `next_attempt_at timestamptz`; query passa a filtrar `where status='PENDING' and next_attempt_at <= now()`; backoff exponencial por linha.

### 3.3 🟠 DLQ sem replayer
Mensagens entram em `handoff:dlq` e **morrem ali**. Não há ferramenta de reprocessamento ou inspeção.

**Ação:** CLI/worker de replay (reinjeta no stream após correção) + painel de inspeção. Veja §5 (artifact ao vivo).

### 3.4 🟠 Sem validação de schema na ingestão (mensagem-veneno)
`JSON.parse(fields[1])` confia cegamente no payload. Um envelope malformado **lança e cai no retry → DLQ** sem diagnóstico claro, ou pior, quebra o parsing posicional (`fields[1]`).

**Ação:** validar com **Zod** (`HandoffEnvelopeSchema.parse`) na borda; rejeitar para DLQ com motivo estruturado em vez de exception genérica.

### 3.5 🟠 Healthcheck raso
`/health` retorna `ok` fixo — não checa Redis nem Postgres. O Traefik/orquestrador **não detecta** um daemon vivo mas desconectado do broker/DB.

**Ação:** health real (`PING` no Redis, `SELECT 1` no PG) com `200/503`. Separar `liveness` de `readiness`.

### 3.6 🟠 Escala horizontal travada
`startConsumer("g:ops", "daemon-worker-1", ...)` usa **nome de consumer fixo**. Subir 2 réplicas → colisão de PEL e claims errados. O consumer group existe, mas o naming impede escalar.

**Ação:** consumer name dinâmico (`daemon-${HOSTNAME}-${pid}`). Aí 2.3 + escala horizontal resolvem throughput.

### 3.7 🟡 Recursão de fallback sem guarda de loop
Os wrappers chamam `claude → gemini → claude` recursivamente. Se **ambos** estiverem em rate limit, há risco de **loop infinito** de re-entrada. Não há contador de hops nem teto.

**Ação:** `--max-hops` no contexto de fallback (ex.: 2) e abortar com alerta se exceder.

### 3.8 🟡 `git diff HEAD~1..HEAD` frágil
Em `compile-fallback-context.js`, `execSync` de git **lança** em primeiro commit, repo detached ou fora de repo → derruba o wrapper bem no momento de salvar o contexto (pior hora possível).

**Ação:** envolver em try/catch, degradar com `diff_stat: "(indisponível)"`.

### 3.9 🟡 Contexto de fallback no Google Drive (`G:\`)
Escrever `fallback-ctx.json` em pasta sincronizada do Drive adiciona latência e **race com o sync** entre os dois wrappers. Para handoff em milissegundos, é frágil.

**Ação:** usar diretório local/temp e transportar o contexto pelo próprio broker (Redis), que já é a fonte de verdade.

---

## 4. Observabilidade e operação (lacuna grande)

O `correlation_id` é **coletado e nunca usado** — desperdício de um ativo pronto para tracing.

- **Tracing distribuído (OpenTelemetry):** propagar `correlation_id` como trace context daemon → outbox → n8n → WhatsApp. Resposta para "onde o handoff X travou?" em segundos.
- **Métricas (Prometheus + Grafana):** profundidade do stream, tamanho do PEL, taxa de DLQ, latência p95 do handoff, idade do outbox PENDING, estado do circuit breaker. Definir **SLO** (ex.: p95 do handoff < 3s).
- **Logging estruturado (pino/JSON):** hoje são `console.log` com emoji — bom para humano, ruim para agregação. Trocar por logs estruturados com `task_id`/`correlation_id`.
- **Alertas acionáveis:** `ops:alerts` existe mas só recebe CRITICAL da DLQ. Estender para breaker aberto, outbox represado e lag de réplica.

---

## 5. Possibilidades — tirar mais proveito

### 5.1 Painel de operação ao vivo (alto valor, baixo esforço)
Um **artifact persistente** que lê Postgres/Redis e mostra handoffs em andamento, DLQ, outbox represado e estado do breaker — com botão de **replay da DLQ**. Substitui "logar no servidor" por uma página que você reabre e atualiza. Posso construir isso aqui no Cowork.

### 5.2 Roteador multi-modelo (evolução natural)
Hoje o fallback é binário (Claude ↔ Gemini). Generalizar para um **router** que escolhe o próximo agente por disponibilidade + custo + capacidade da tarefa (ex.: incluir um modelo local barato para tarefas triviais). O envelope já tem `signatures.sender/receiver` — basta evoluir para uma cadeia de roteamento.

### 5.3 Handoff com contexto rico (RAG sobre o LLM-Brain)
O agente que recebe hoje pega só `diff_stat` + última ação. Indexar o `LLM-Brain` e anexar **contexto recuperado** (decisões, padrões do projeto) ao envelope → o agente receptor retoma com muito menos perda. Diferencial real de qualidade do handoff.

### 5.4 Unificar os wrappers
Há **três** wrappers duplicados (bash + 2 PowerShell) com lógica repetida e divergente (códigos de erro diferentes entre eles). Consolidar em **um CLI Node cross-platform** com config declarativa por provedor. Elimina drift e o `TODO` do comando `gemini` ainda não ajustado.

### 5.5 Migrations versionadas + desacoplar do Postgres do n8n
`sql/01_schema.sql` é aplicado à mão, no **mesmo banco do n8n**. Adotar `node-pg-migrate`/Flyway e avaliar schema/instância próprios para isolar blast radius de migrações.

### 5.6 Digest automático agendado
Tarefa agendada diária com resumo: handoffs do dia, DLQ pendente, falhas de outbox, tempo médio de retomada. Posso configurar como scheduled task.

---

## 6. Plano sugerido (priorização)

| Prioridade | Item | Esforço | Impacto |
|---|---|---|---|
| P0 | Rotacionar JWT n8n + `.gitignore` + tirar secrets do repo (§2.1) | Baixo | Crítico |
| P0 | Corrigir HMAC raw-body no n8n (§2.2) | Baixo | Crítico |
| P0 | Remover sleep bloqueante do consumer (§2.3) | Médio | Alto |
| P0 | Timeout no fetch + ativar circuit breaker (§2.4, §2.5) | Baixo | Alto |
| P1 | Idempotência + backoff agendado no outbox (§3.1, §3.2) | Médio | Alto |
| P1 | Validação Zod na ingestão (§3.4) | Baixo | Médio |
| P1 | Healthcheck real + consumer name dinâmico (§3.5, §3.6) | Baixo | Médio |
| P2 | DLQ replayer + painel ao vivo (§3.3, §5.1) | Médio | Alto |
| P2 | Observabilidade: OTel + métricas + logs estruturados (§4) | Médio | Alto |
| P3 | Guarda de loop + git resiliente + contexto fora do Drive (§3.7–3.9) | Baixo | Médio |
| P3 | Router multi-modelo / RAG / unificar wrappers (§5.2–5.4) | Alto | Estratégico |

---

**Próximo passo recomendado:** começar pelos 4 itens P0 (são todos de baixo esforço, exceto o sleep) numa única leva. Posso já implementar o `.gitignore`, a correção do HMAC e o timeout/breaker, ou montar o painel ao vivo da §5.1 — é só dizer por onde.
