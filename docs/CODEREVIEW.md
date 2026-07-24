# Daemon-CodeReview

Pipeline multi-agente de code review autônomo. Roda via `handoff-daemon`, opera 100% via GitHub API (repos não são montados no container). Fonte: `src/hermes/`.

## Agentes

| Agente | Arquivo | Skill | Função |
|---|---|---|---|
| Daemon-CodeReview | `codereview-agent.ts` | `reviewSkill` | Analisa diff, emite issues com evidência literal |
| Daemon-ReviewAuditor | `codereview-agent.ts` (`auditIssues`) | `reviewAuditSkill` | 2º passe cético — derruba findings sem prova antes de postar |
| Daemon-FixAgent | `fix-agent.ts` | `fixSkill` | Corrige issues uma a uma (search/replace), abre/atualiza PR |
| Daemon-Verifier | `verify-agent.ts` | `verifySkill` | Audita o fix contra as issues originais, aprova ou reprova |
| Daemon-CIFixAgent | `ci-fix-agent.ts` | `ciFixSkill` | Corrige falha de CI (GitHub Actions) do PR automaticamente |

## Fluxo review → audit → post

1. `collectGitContext` (`git-collector.ts`) coleta diff do PR aberto (via `compare`) + **árvore de paths do repo** (`git ls-files` local ou Trees API remoto) + commits recentes.
2. `reviewSkill` gera issues. Cada issue exige `evidence`: trecho literal do diff que prova a alegação. Regras de escopo: `line` só em linha `+` (adicionada), proibido alegar ausência de arquivo/rota sem checar a árvore fornecida.
3. `coerceResult` descarta mecanicamente qualquer issue sem `evidence` preenchido — filtro determinístico, não confia só no prompt.
4. `auditIssues` roda um 2º modelo (nunca o mesmo do review — cadeia `verify_model > CODEREVIEW_AUDIT_MODEL > RECOMMENDED_MODELS.verify`) que tenta derrubar cada issue sobrevivente: evidência não bate, linha fora de escopo, alegação de ausência refutada pela árvore, especulação sem defeito concreto, duplicata. Fail-open em erro (mantém issues originais — nunca trava o review).
5. Só sobreviventes viram inline comment (`postReviewComments`) e vão pro `codereview_reports`.

Isso mata os dois padrões de falso positivo observados em produção (PR #6 do Luma-APP): "verifique se rota X está registrada" (sem ver o resto do repo) e comentário em linha de contexto não alterada.

## Ciclo fix → verify (`codereview-cron.ts::runAttackForSlug`)

Loop até consenso ou `max_cycle_rounds` (default 3):
1. `runAttack` — Daemon-FixAgent ataca as issues do report (ou do `newIssues` da rodada anterior), commita no branch, abre/atualiza PR.
2. `runVerify` — Daemon-Verifier lê diff atual + log do fix + issues originais, decide `approved`/`changes_requested`. Confirma justificativas de skip (falso-positivo, já corrigido) contra o diff real antes de aceitar.
3. Se reprovado, `newIssues` do verifier vira input da próxima rodada. Se aprovado ou limite de rodadas atingido, ciclo fecha (`needs_human` se não convergiu).

Lock por slug (`attackLocks`) cobre o ciclo inteiro — evita PR duplicado de reclique.

## CI-fix automático (`ci-fix-agent.ts`)

Corrige falha de CI do PR sem intervenção humana:

1. Acha o run mais recente com `conclusion: failure` no head SHA do PR.
2. Baixa log dos jobs falhos (`actions/jobs/{id}/logs`), extrai o trecho a partir da primeira linha de erro (`##[error]`, `FAIL`, `AssertionError`, etc.), cap em `CI_FIX_MAX_LOG_CHARS` (15k).
3. Extrai paths candidatos citados no stack trace/log, filtra por escopo seguro (`SAFE_PATH_RE`: `__tests__/`, `*.test.ts`, `jest`, `*.config.*`, `.github/workflows/`) — nunca mexe em código de produção a menos que `CI_FIX_ALLOW_ANY=1`.
4. `ciFixSkill` recebe o log + conteúdo completo dos arquivos candidatos, devolve `diagnosis` + edits search/replace. Proibido silenciar sintoma (deletar teste, afrouxar assert, engolir erro em try/catch). Se a causa raiz está fora dos arquivos fornecidos, ou é infra/secret/flake, responde `{skip: true, reason}`.
5. Edits aplicados e commitados direto no branch do PR — CI re-roda sozinho. Comentário de diagnóstico postado no PR.
6. **Modelo herdado da cadeia do fix**: `attack_model > codereview_model > RECOMMENDED_MODELS.fix[0]`.

### Guard-rails
- Máx. `CI_FIX_MAX_ATTEMPTS` (default 2) tentativas por `run_id`.
- Máx. `CI_FIX_MAX_ATTEMPTS_PER_PR_DAY` (default 4) tentativas por PR em 24h — fecha o ciclo fix→falha→fix, já que cada fix gera um `run_id` novo (o cap por run sozinho não segura loop). Janela **rolling**: cada tentativa registra timestamp; conta-se quantas ocorreram nos últimos 24h a partir do momento da nova tentativa (não janela fixa à meia-noite). Assim, 4 tentativas consecutivas após 23h não bypassam o limite — a 5ª só é permitida quando a mais antiga sair da janela de 24h.
- Tabela `ci_fix_attempts` registra toda tentativa (status, diagnóstico, arquivos tocados, erro).

## Trigger automático — webhook GitHub (`github-webhook.ts`)

`POST /webhooks/github` (fora de `/ops/api/*` — sem Cloudflare Access, auth própria):

- Auth: `X-Hub-Signature-256` HMAC-sha256 contra `GITHUB_WEBHOOK_SECRET`. Fail-closed se o secret não estiver setado.
- Só processa evento `workflow_run` com `action=completed` e `conclusion=failure`, e só se o run tem PR associado (`workflow_run.pull_requests`).
- Mapeia `repository.owner/name` → `slug` via `handoff_projects` (`git_owner`, `git_repo`, `codereview_enabled=true`).
- Responde 202 imediatamente (GitHub tem timeout de 10s) e roda `runCiFixForSlug` em background.

**Setup do webhook no GitHub:**
```bash
gh api repos/<owner>/<repo>/hooks -X POST -f name=web -F active=true \
  -f "events[]=workflow_run" \
  -f config[url]=https://ops.nicebyte.ia.br/webhooks/github \
  -f config[content_type]=json \
  -f config[secret]="$GITHUB_WEBHOOK_SECRET"
```

**Cloudflare Access:** `ops.nicebyte.ia.br` é protegido por Access (OTP) — GitHub não consegue autenticar nisso. Precisa de uma Access Application separada com Policy **Bypass** especificamente pro path `webhooks/github` (Zero Trust → Access → Applications → Self-hosted, domain `ops.nicebyte.ia.br`, path `webhooks/github`, policy bypass/everyone). O endpoint continua protegido pelo HMAC — o bypass só evita o redirect de login OTP pra requisições que o GitHub não consegue completar.

## Endpoints (`/ops/api/*`, atrás de Cloudflare Access)

| Método | Path | Função |
|---|---|---|
| POST | `/ops/api/codereview/run` | Dispara review (`{slug, model?, force?}`) |
| POST | `/ops/api/codereview/attack` | Dispara ciclo fix→verify |
| GET | `/ops/api/codereview` | Lista reports |
| GET | `/ops/api/codereview/attacks` | Lista ataques |
| POST | `/ops/api/cifix/run` | Dispara CI-fix manual (`{slug, prNumber?, model?}`) |
| GET | `/ops/api/cifix/attempts?slug=` | Histórico de tentativas de CI-fix |

## Curadoria de modelo (`skills.ts::RECOMMENDED_MODELS`)

Por função (review/fix/verify/test), lista de modelos NIM curados por força em raciocínio (review/verify) ou código (fix). Regra: verify nunca reusa o modelo do fix no mesmo ciclo (evita viés confirmatório); auditor de review segue a mesma lógica contra o modelo do review.
