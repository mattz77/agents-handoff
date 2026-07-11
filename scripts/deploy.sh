#!/usr/bin/env bash
#
# Deploy do Handoff Daemon (rodar NO SERVIDOR, onde estão o Docker e as redes).
# Faz: validação de env -> build TS -> build da imagem -> sobe o stack -> health check.
#
# Pré-requisitos: docker + docker compose; .env preenchido (DATABASE_URL, WEBHOOK_*,
# CF_ACCESS_TEAM_DOMAIN, CF_ACCESS_AUD); secrets/redis_secret.txt presente.
#
set -euo pipefail
cd "$(dirname "$0")/.."

die() { echo "❌ $*" >&2; exit 1; }
ok()  { echo "✅ $*"; }

[ -f .env ] || die "Arquivo .env não encontrado."
# shellcheck disable=SC1091
set -a; . ./.env; set +a

for v in DATABASE_URL CF_ACCESS_TEAM_DOMAIN CF_ACCESS_AUD; do
  [ -n "${!v:-}" ] || die "Variável $v ausente no .env (necessária para o painel /ops)."
done
[ -f secrets/redis_secret.txt ] || die "secrets/redis_secret.txt ausente."

echo "── 1/4 Build TypeScript ─────────────"
npm ci
npm run build
ok "Build TS concluído (dist/)."

echo "── 2/4 Build da imagem ──────────────"
docker compose build handoff-daemon
ok "Imagem construída."

echo "── 3/4 Subindo o stack ──────────────"
docker compose up -d
ok "Containers no ar."

echo "── 4/4 Health check ─────────────────"
CID=$(docker compose ps -q handoff-daemon)
HEALTH=""
for i in $(seq 1 20); do
  HEALTH=$(docker exec "$CID" wget -qO- http://localhost:3000/health 2>/dev/null || true)
  echo "$HEALTH" | grep -q '"status":"ok"' && break
  sleep 2
done
echo "$HEALTH" | grep -q '"status":"ok"' \
  && ok "Daemon saudável: $HEALTH" \
  || die "Health check falhou. Veja: docker compose logs handoff-daemon"

echo
echo "════════════════════════════════════════════════════"
echo " Deploy concluído. Painel: https://ops.nicebyte.ia.br"
echo " (Garanta que o cf-access-setup.sh já criou DNS + Access.)"
echo "════════════════════════════════════════════════════"
