# Handoff Daemon — Project Instructions

## Stack
- **Runtime**: Node.js + TypeScript
- **Messaging**: Redis Streams (handoff:stream, handoff:dlq, ops:alerts)
- **Database**: PostgreSQL (outbox pattern)
- **Infra**: Docker Compose (Redis Master/Sentinel, Cloudflared, Traefik)
- **Build**: `tsc` → `dist/`

## Arquitetura
- `src/producer.ts` — Publica HandoffEnvelope no Redis Stream com dedupe atômica
- `src/consumer.ts` — Consumer Group com auto-claim, retry com backoff exponencial, DLQ
- `src/outbox.ts` — Outbox pattern para notificações (n8n → WhatsApp)
- `src/domain/handoff.ts` — Tipos TypeScript: HandoffEnvelope, Agent, LifecycleStatus
- `scripts/publish-handoff.js` — Script CLI para agentes publicarem handoffs

## Protocolo LLM-Brain
Este projeto é parte do ecossistema **LLM-Brain** de colaboração multi-agente.
- Ao iniciar sessão, use `$llm-brain-protocol` para sincronizar contexto
- O estado compartilhado fica em `G:\Meu Drive\LLM-Brain\`
- A trinca de agentes é: **Antigravity (Gemini)** + **Claude** + **ZCode (GLM-5.2)**

## Regras
- Manter todos os timestamps em BRT (UTC-3)
- Nunca modificar o schema do Redis Stream sem atualizar `schema_version` no HandoffEnvelope
- Sempre rodar `npm run build` e verificar que compila sem erros antes de commitar
- O tipo `Agent` em `src/domain/handoff.ts` deve listar todos os agentes ativos da trinca
