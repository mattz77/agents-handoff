#!/usr/bin/env bash
#
# Provisiona o acesso Zero Trust ao painel /ops:
#   1) Cria/atualiza o registro DNS (proxied) de ops.nicebyte.ia.br
#   2) Cria/atualiza a Access Application (self-hosted)
#   3) Cria/atualiza a Access Policy com login por OTP (código no email)
#
# Idempotente: pode rodar várias vezes. Imprime o AUD da aplicação ao final —
# copie-o para CF_ACCESS_AUD no .env do daemon.
#
# Requisitos: bash, curl, jq.
#
# Variáveis de ambiente (defina antes de rodar — NÃO comite valores reais):
#   Tokens (nenhum token único cobre DNS + Access; use um para cada etapa):
#     CF_DNS_TOKEN     Token Zone:DNS:Edit       (ex.: 'antigravity-dns' ou 'dns_token')
#     CF_ACCESS_TOKEN  Token Account:Access:Edit (ex.: 'claude-token2p0' — Zero Trust + Apps/Policies)
#     CF_API_TOKEN     (opcional) usado como fallback se um dos acima faltar
#   CF_ACCOUNT_ID    ID da conta Cloudflare
#   CF_ZONE_ID       ID da zona (nicebyte.ia.br)
#   ALLOWED_EMAILS   Emails permitidos, separados por vírgula (ex.: mattz77.mo@gmail.com)
#
#   Topologia (escolha uma):
#   A) TÚNEL (recomendado, você já tem cloudflared):
#        TUNNEL_ID        UUID do túnel -> o DNS vira CNAME para <TUNNEL_ID>.cfargotunnel.com
#        (opcional) ADD_TUNNEL_INGRESS=1  faz merge seguro do ingress do túnel via API
#                   exige CF_TUNNEL_TOKEN (Account: Cloudflare One Connector) e
#                   TUNNEL_SERVICE (ex.: http://traefik:80)
#   B) ORIGIN PÚBLICO:
#        DNS_CONTENT      IP público do servidor (com DNS_TYPE=A, default)
#
# Opcionais:
#   OPS_HOSTNAME     (default: ops.nicebyte.ia.br)
#   DNS_TYPE         A | CNAME   (default: A)
#   SESSION_DURATION (default: 24h)
#   APP_NAME         (default: "Handoff Ops Panel")
#
set -euo pipefail

API="https://api.cloudflare.com/client/v4"
OPS_HOSTNAME="${OPS_HOSTNAME:-ops.nicebyte.ia.br}"
DNS_TYPE="${DNS_TYPE:-A}"
SESSION_DURATION="${SESSION_DURATION:-24h}"
APP_NAME="${APP_NAME:-Handoff Ops Panel}"

die() { echo "❌ $*" >&2; exit 1; }
ok()  { echo "✅ $*"; }

DNS_TOKEN="${CF_DNS_TOKEN:-${CF_API_TOKEN:-}}"
ACCESS_TOKEN="${CF_ACCESS_TOKEN:-${CF_API_TOKEN:-}}"

# req <token> <curl args...>
req() {
  local tok="$1"; shift
  curl -sS -H "Authorization: Bearer ${tok}" -H "Content-Type: application/json" "$@"
}
reqd() { req "$DNS_TOKEN" "$@"; }     # etapa DNS
reqa() { req "$ACCESS_TOKEN" "$@"; }  # etapa Access

[ -n "$DNS_TOKEN" ]    || die "Defina CF_DNS_TOKEN (Zone:DNS:Edit) ou CF_API_TOKEN."
[ -n "$ACCESS_TOKEN" ] || die "Defina CF_ACCESS_TOKEN (Account:Access:Edit) ou CF_API_TOKEN."
for v in CF_ACCOUNT_ID CF_ZONE_ID ALLOWED_EMAILS; do
  [ -n "${!v:-}" ] || die "Variável $v não definida."
done
command -v jq >/dev/null || die "jq não encontrado."

# Resolve o destino do DNS conforme a topologia.
if [ -n "${TUNNEL_ID:-}" ]; then
  DNS_TYPE="CNAME"
  DNS_CONTENT="${TUNNEL_ID}.cfargotunnel.com"
else
  [ -n "${DNS_CONTENT:-}" ] || die "Defina TUNNEL_ID (túnel) OU DNS_CONTENT (origin público)."
fi

# Monta o array JSON de includes (um por email) para a policy OTP.
EMAIL_INCLUDES=$(echo "$ALLOWED_EMAILS" | tr ',' '\n' | sed 's/^ *//;s/ *$//' | grep -v '^$' \
  | jq -R '{email:{email:.}}' | jq -s '.')
[ "$(echo "$EMAIL_INCLUDES" | jq 'length')" -gt 0 ] || die "ALLOWED_EMAILS vazio."

echo "▶ Alvo: $OPS_HOSTNAME  | DNS $DNS_TYPE -> $DNS_CONTENT"

# ---------- 1) DNS (proxied) ----------
echo "── DNS ──────────────────────────────"
EXISTING=$(reqd "${API}/zones/${CF_ZONE_ID}/dns_records?name=${OPS_HOSTNAME}")
echo "$EXISTING" | jq -e '.success' >/dev/null || die "Erro DNS list: $(echo "$EXISTING" | jq -c '.errors')"
REC_ID=$(echo "$EXISTING" | jq -r '.result[0].id // empty')

DNS_BODY=$(jq -n --arg t "$DNS_TYPE" --arg n "$OPS_HOSTNAME" --arg c "$DNS_CONTENT" \
  '{type:$t,name:$n,content:$c,proxied:true,ttl:1}')

if [ -n "$REC_ID" ]; then
  RES=$(reqd -X PUT "${API}/zones/${CF_ZONE_ID}/dns_records/${REC_ID}" --data "$DNS_BODY")
  echo "$RES" | jq -e '.success' >/dev/null && ok "DNS atualizado (proxied)" || die "DNS update: $(echo "$RES" | jq -c '.errors')"
else
  RES=$(reqd -X POST "${API}/zones/${CF_ZONE_ID}/dns_records" --data "$DNS_BODY")
  echo "$RES" | jq -e '.success' >/dev/null && ok "DNS criado (proxied)" || die "DNS create: $(echo "$RES" | jq -c '.errors')"
fi

# ---------- 1b) Ingress do Túnel (opcional, merge seguro) ----------
# Só roda se ADD_TUNNEL_INGRESS=1. Faz GET da config atual, insere a regra do ops
# ANTES do catch-all (http_status:404) e dá PUT — sem clobberar rotas existentes.
if [ "${ADD_TUNNEL_INGRESS:-0}" = "1" ]; then
  echo "── Ingress do Túnel ─────────────────"
  [ -n "${TUNNEL_ID:-}" ]        || die "ADD_TUNNEL_INGRESS=1 exige TUNNEL_ID."
  [ -n "${CF_TUNNEL_TOKEN:-}" ]  || die "ADD_TUNNEL_INGRESS=1 exige CF_TUNNEL_TOKEN (Cloudflare One Connector)."
  [ -n "${TUNNEL_SERVICE:-}" ]   || die "ADD_TUNNEL_INGRESS=1 exige TUNNEL_SERVICE (ex.: http://traefik:80)."
  reqt() { req "$CF_TUNNEL_TOKEN" "$@"; }
  CFG_URL="${API}/accounts/${CF_ACCOUNT_ID}/cfd_tunnel/${TUNNEL_ID}/configurations"
  CUR=$(reqt "$CFG_URL")
  echo "$CUR" | jq -e '.success' >/dev/null || die "GET config túnel: $(echo "$CUR" | jq -c '.errors')"
  # ingress atual (ou base com catch-all se vazio)
  ING=$(echo "$CUR" | jq '.result.config.ingress // []')
  NEW_ING=$(echo "$ING" | jq --arg h "$OPS_HOSTNAME" --arg s "$TUNNEL_SERVICE" '
    [ {hostname:$h, service:$s} ]                       # nossa regra primeiro
    + ( map(select(.hostname and .hostname != $h)) )    # demais hosts (sem a antiga do mesmo host)
    + [ {service:"http_status:404"} ]                   # catch-all único no fim
  ')
  FULL_CFG=$(echo "$CUR" | jq --argjson ing "$NEW_ING" '{config: (.result.config + {ingress:$ing})}')
  RES=$(reqt -X PUT "$CFG_URL" --data "$FULL_CFG")
  echo "$RES" | jq -e '.success' >/dev/null && ok "Ingress do túnel atualizado ($OPS_HOSTNAME -> $TUNNEL_SERVICE)" \
    || die "PUT config túnel: $(echo "$RES" | jq -c '.errors')"
fi

# ---------- 2) Access Application ----------
echo "── Access Application ───────────────"
APPS=$(reqa "${API}/accounts/${CF_ACCOUNT_ID}/access/apps")
echo "$APPS" | jq -e '.success' >/dev/null || die "Erro apps list: $(echo "$APPS" | jq -c '.errors')"
APP_ID=$(echo "$APPS" | jq -r --arg d "$OPS_HOSTNAME" '.result[] | select(.domain==$d) | .id' | head -n1)

APP_BODY=$(jq -n --arg n "$APP_NAME" --arg d "$OPS_HOSTNAME" --arg s "$SESSION_DURATION" \
  '{name:$n, domain:$d, type:"self_hosted", session_duration:$s,
    auto_redirect_to_identity:false,
    app_launcher_visible:true,
    allowed_idps:[]}')   # allowed_idps vazio => mostra o One-time PIN (OTP por email)

if [ -n "$APP_ID" ]; then
  RES=$(reqa -X PUT "${API}/accounts/${CF_ACCOUNT_ID}/access/apps/${APP_ID}" --data "$APP_BODY")
else
  RES=$(reqa -X POST "${API}/accounts/${CF_ACCOUNT_ID}/access/apps" --data "$APP_BODY")
fi
echo "$RES" | jq -e '.success' >/dev/null || die "App create/update: $(echo "$RES" | jq -c '.errors')"
APP_ID=$(echo "$RES" | jq -r '.result.id')
APP_AUD=$(echo "$RES" | jq -r '.result.aud')
ok "Access App pronta (id=$APP_ID)"

# ---------- 3) Access Policy (OTP por email) ----------
echo "── Access Policy (OTP) ──────────────"
POLICY_BODY=$(jq -n --argjson inc "$EMAIL_INCLUDES" \
  '{name:"Ops - OTP por email", decision:"allow", include:$inc, exclude:[], require:[]}')

POLS=$(reqa "${API}/accounts/${CF_ACCOUNT_ID}/access/apps/${APP_ID}/policies")
POL_ID=$(echo "$POLS" | jq -r '.result[]? | select(.name=="Ops - OTP por email") | .id' | head -n1)

if [ -n "$POL_ID" ]; then
  RES=$(reqa -X PUT "${API}/accounts/${CF_ACCOUNT_ID}/access/apps/${APP_ID}/policies/${POL_ID}" --data "$POLICY_BODY")
else
  RES=$(reqa -X POST "${API}/accounts/${CF_ACCOUNT_ID}/access/apps/${APP_ID}/policies" --data "$POLICY_BODY")
fi
echo "$RES" | jq -e '.success' >/dev/null && ok "Policy aplicada" || die "Policy: $(echo "$RES" | jq -c '.errors')"

echo
echo "════════════════════════════════════════════════════════════════"
echo " Provisionamento concluído. Configure no .env do daemon:"
echo
echo "   CF_ACCESS_TEAM_DOMAIN=<sua-org>.cloudflareaccess.com"
echo "   CF_ACCESS_AUD=${APP_AUD}"
echo
echo " (O team domain está em Zero Trust > Settings > Custom Pages / team domain.)"
echo " Depois: docker compose up -d --build  e acesse https://${OPS_HOSTNAME}"
echo "════════════════════════════════════════════════════════════════"
