#!/usr/bin/env bash
# /usr/local/bin/claude-smart-wrap  — detecção estruturada, sem scraping de texto
set -uo pipefail

ERR_JSON="$(mktemp)"
# claude-code expõe --error-format=json: status HTTP e código em STDOUT estruturado
claude-code --error-format=json "$@" 2>"$ERR_JSON"
CODE=$?

# Mapeia condições de fallback por SINAL, não por texto livre
HTTP=$(jq -r '.error.status // empty' "$ERR_JSON" 2>/dev/null)
TYPE=$(jq -r '.error.type   // empty' "$ERR_JSON" 2>/dev/null)

needs_fallback=false
case "$HTTP" in 429|529) needs_fallback=true ;; esac
case "$TYPE" in rate_limit_error|overloaded_error|quota_exceeded) needs_fallback=true ;; esac
# Exit codes reservados do wrapper para esgotamento de contexto/cota
case "$CODE" in 75|78) needs_fallback=true ;; esac

if $needs_fallback; then
  echo "🚨 [FALLBACK] Cota/limite Claude atingido (http=$HTTP type=$TYPE code=$CODE). Acionando Gemini."
  # Serializa SOMENTE o contexto necessário (não o estado global)
  node /opt/scripts/compile-fallback-context.js --reason="$TYPE" --http="$HTTP" \
       --out=/tmp/fallback-ctx.json
  # Publica evento no broker (idempotente, assinado)
  node /opt/scripts/publish-fallback.js --ctx=/tmp/fallback-ctx.json --status=FALLBACK_TRIGGERED
  rm -f "$ERR_JSON" /tmp/fallback-ctx.json
  exit 0
fi

rm -f "$ERR_JSON"
exit $CODE
