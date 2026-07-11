# Plano Handoff v3 — Economia de tokens no LLM-Brain

> Executor: Claude Sonnet. Seguir fases em ordem. Cada fase termina com checkpoint em `active-context.md` (protocolo atual) e commit no repo `handoff-daemon`.
> Idioma: pt-BR. Não commitar secrets. Não reescrever arquivos do LLM-Brain com `Write` sem backup prévio.

## Problema (medido em 2026-07-08)

| Arquivo | Tamanho | Tokens aprox. |
|---|---|---|
| `active-context.md` | 151 KB | ~40k |
| `task-queue.md` | 202 KB | ~50k |
| `decisions.md` | 15 KB | ~4k |

Protocolo atual manda ler os 3 inteiros a cada `/handoff` → **~95k tokens queimados antes de qualquer trabalho**. Arquivos são append-only, nunca compactados: 104 seções no active-context (só a 1ª importa), 49 tasks no task-queue (maioria `[done]`).

Bugs adjacentes:
- RAG do daemon é fake: `src/infra/datalake-rag.ts:33` gera embedding com `Math.random()` — busca vetorial retorna resultados aleatórios.
- Mojibake em tasks antigas do task-queue (`â€”`, `MigraÃ§Ã£o`) — gravadas em encoding errado.
- `rag-watcher.ts` chama scripts externos que podem não existir no container.

## Arquitetura alvo

```
LLM-Brain/
  active-context.md      # HOT: só cabeçalho + últimos 3 checkpoints (~5 KB)
  task-queue.md          # HOT: só tasks [pending] e [in_progress] (~10 KB)
  decisions.md           # inalterado (já pequeno)
  BRAIN-INDEX.md         # NOVO: digest gerado pelo daemon (~2 KB)
  archive/
    active-context-2026-06.md   # COLD: checkpoints antigos, por mês
    task-queue-done.md          # COLD: tasks [done]/[cancelled]
```

Assimilação nova: ler `BRAIN-INDEX.md` + HOT files (~17 KB ≈ 4-5k tokens). Histórico completo só sob demanda via CLI/RAG. **Redução ~95%.**

---

## FASE 1 — CLI `brain.js` (maior impacto, sem tocar no daemon)

Criar `scripts/brain.js` (Node puro, sem deps novas). Comandos:

```
node scripts/brain.js pending [--assigned Claude|Gemini|ambos]
    # imprime só tasks [pending]/[in_progress] filtradas (título + assigned + prioridade + corpo)
node scripts/brain.js checkpoint [--last N]      # últimos N checkpoints do active-context (default 3)
node scripts/brain.js decisions [--last N]       # últimas N decisões
node scripts/brain.js task <número>              # corpo completo de uma task específica
node scripts/brain.js grep "<termo>"             # busca literal nos 3 arquivos + archive, retorna seção inteira do match
node scripts/brain.js stats                      # tamanhos, contagem por status, alerta se HOT > limite
```

Detalhes de implementação:
- Path base: `G:\Meu Drive\LLM-Brain` (permitir override via env `BRAIN_DIR`).
- Parser: split por `^## ` (checkpoints) e `^## \[status\]` (tasks). Tolerar mojibake nos headers antigos (regex flexível para `—`/`â€”`).
- Ler com `utf-8`; se detectar BOM, strip.
- Saída em texto compacto (não JSON verboso) — objetivo é economizar tokens do modelo que lê.
- Testes: rodar cada comando contra os arquivos reais e conferir contagens (49 tasks, 104 seções).

## FASE 2 — Compactação HOT/COLD (rotação)

Criar `scripts/brain-compact.js`:

1. Backup completo dos 3 arquivos em `LLM-Brain/archive/backup-<timestamp>/` antes de qualquer escrita.
2. `task-queue.md`: mover blocos `[done]`, `[cancelled]`, `[archived]` para `archive/task-queue-done.md` (append, preservar ordem). Manter no HOT: convenção de status + `[pending]` + `[in_progress]`.
3. `active-context.md`: manter cabeçalho `## Modelo ativo` + 3 checkpoints mais recentes. Resto vai para `archive/active-context-<YYYY-MM>.md` (agrupar por mês do timestamp; sem timestamp parseável → mês corrente).
4. Corrigir mojibake ao mover (mapa fixo: `â€”`→`—`, `Ã§`→`ç`, `Ã£`→`ã`, `Ã©`→`é`, `Ã¡`→`á`, `Ã­`→`í`, `Ãµ`→`õ`, `Ãª`→`ê`, `Ã³`→`ó`, `Ãº`→`ú`).
5. Idempotente: rodar 2x seguidas = segunda execução no-op.
6. Modo `--dry-run` que só imprime o que faria. **Primeira execução real só após usuário aprovar o dry-run.**

Integrar no daemon: job diário (setInterval 24h em `src/index.ts`) que roda compactação se HOT files > 30 KB. Logar no padrão existente.

## FASE 3 — BRAIN-INDEX.md (digest automático)

Gerar `LLM-Brain/BRAIN-INDEX.md` (daemon regenera a cada mudança detectada pelo `rag-watcher`, debounce já existe):

```markdown
# BRAIN INDEX (gerado <timestamp> — NÃO editar manualmente)
## Modelo ativo
<linha 1 do active-context>
## Tasks pending (N)
- TASK 34 [alta] Gemini — Ops Control Panel: painel próprio...
- TASK 32 [média] Claude — XONE-WA: nomenclatura dinâmica...
## Último checkpoint
<primeiras ~10 linhas do checkpoint mais recente>
## Últimas 3 decisões
- [2026-07-01] <título>
## Docs do Brain (1 linha cada)
- xone-wa-documentacao.md — <primeira linha H1/descrição>
```

Alvo: ≤ 2 KB. Implementar como `scripts/brain-index.js`, chamado pelo `rag-watcher` junto da ingestão.

## FASE 4 — Consertar RAG (busca semântica real)

- `src/infra/datalake-rag.ts`: trocar mock por embeddings reais via `@google/genai` (já é dependência) — modelo `text-embedding-004` ou mais novo, key via env `GEMINI_API_KEY` (já deve existir no `.env`; se não, pedir ao usuário).
- Chunking: dividir docs por seção `## ` com máximo ~1500 chars, metadata `{filePath, heading}`.
- Re-indexar tudo: dropar tabela `knowledge_base` (dados atuais são lixo aleatório) e re-ingerir Brain + Knowledge_Base.
- Expor endpoint no ops server (`src/ops/server.ts`): `GET /ops/api/brain/search?q=...&k=5` retornando `{heading, filePath, snippet(300 chars), score}` — snippet curto, nunca doc inteiro.
- Adicionar comando `node scripts/brain.js search "<query>"` que chama o endpoint (fallback: busca local direta no LanceDB).

## FASE 5 — Atualizar protocolo (SKILL.md + CLAUDE.md global)

Reescrever assimilação em `~/.claude/skills/handoff/SKILL.md` e seção LLM-Brain do `~/.claude/CLAUDE.md`:

1. Assimilação = `node scripts/brain.js stats` + Read `BRAIN-INDEX.md` + `brain.js pending --assigned Claude` + `brain.js checkpoint --last 2`.
2. **Proibido** ler `active-context.md`/`task-queue.md` inteiros; detalhe de task via `brain.js task N`; histórico via `brain.js grep`/`search`.
3. Checkpoint continua sendo `Edit` no `active-context.md` (formato inalterado — Gemini/Antigravity segue lendo o mesmo arquivo).
4. Regra nova: checkpoint sempre **no topo**, nunca duplicar seção `## Modelo ativo` (hoje há duplicatas).
5. Atualizar também instruções espelho do Antigravity se existirem em `LLM-BRAIN-HANDOFF-DOCS.md` / `hermes-handoff-protocol.md`.

## FASE 6 — Guard-rails no daemon

- Métrica no ops panel (`src/ops/metrics.ts`): tamanho dos HOT files + estimativa de tokens; alerta (webhook existente) se HOT > 40 KB.
- Linter Hermes (`src/hermes/linter.ts`): adicionar regra que acusa checkpoint fora do topo ou seção `## Modelo ativo` duplicada.

## Ordem e critérios de aceite

| Fase | Aceite |
|---|---|
| 1 | `brain.js pending` retorna as ~10 tasks pending atuais; `stats` bate com tamanhos reais |
| 2 | dry-run aprovado; após rodar, HOT files < 20 KB; nada perdido (diff backup vs HOT+archive) |
| 3 | BRAIN-INDEX.md ≤ 2 KB, regenerado ao editar qualquer .md do Brain |
| 4 | `brain.js search "xone garantia"` retorna chunks do doc xone-wa com score decrescente coerente |
| 5 | `/handoff` numa sessão nova consome < 8k tokens de assimilação (medir com /caveman-stats ou ctx_stats) |
| 6 | painel ops mostra card "Brain Size"; alerta dispara em teste com arquivo inflado |

## Riscos

- Google Drive (G:) pode ter lock/latência — toda escrita com retry 3x e nunca truncar sem backup.
- Antigravity/Gemini precisa continuar funcionando durante migração: formato dos HOT files não muda, só encolhe. Avisar Gemini via task no task-queue ao concluir Fase 5.
- Rotação errada perderia histórico → por isso backup obrigatório + dry-run + idempotência (Fase 2).
