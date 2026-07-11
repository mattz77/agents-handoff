# Handoff para o Claude Code — Deploy do painel ops.nicebyte.ia.br

> Cole este conteúdo no Claude Code rodando no host (tem acesso ao Docker local).
> Idioma: pt-BR. Não inventar IDs/hashes. Não commitar secrets. Confirmar cada passo destrutivo.

## Objetivo
Publicar o painel de operação do Handoff Daemon em **https://ops.nicebyte.ia.br**, atrás do
Cloudflare Access (OTP por email). O daemon já roda (código antigo) e precisa de rebuild.

## Já feito (não refazer — só validar)
- `C:\Users\olive\Documents\handoff-daemon\src\ops\*` — camada do painel (metrics, server, dashboard, replay, cf-access).
- Daemon serve o painel em `/` e `/ops`; APIs `/ops/api/*` revalidam JWT do CF Access (fail-closed).
- `infra/proxy/traefik/dynamic/ops.yml` — rota Traefik (mesma cadeia do `handoff.yml`).
- `infra/proxy/cloudflared/config.yml` — ingress `ops.nicebyte.ia.br → https://traefik:443` adicionado.
- `handoff-daemon/docker-compose.yml` — envs `CF_ACCESS_TEAM_DOMAIN` e `CF_ACCESS_AUD`.

## Pré-flight (rodar e conferir)
```powershell
docker ps --format "{{.Names}}" | Select-String "proxy-traefik-1|proxy-cloudflared-1|cordenaain8n-postgres-1|handoff-daemon"
```
Confirmar que os 4 containers existem. Conferir que `infra/proxy/.env` tem `CF_TOKEN_ACCESS`, `CF_DNS_TOKEN`, `CF_ACCOUNT_ID`, `CF_ZONE_ID` (sem imprimir valores).

## Passos

### 1) Schema no Postgres do n8n (idempotente — checar antes)
```powershell
# Se as tabelas já existirem, pular. Caso contrário:
Get-Content C:\Users\olive\Documents\handoff-daemon\sql\01_schema.sql | `
  docker exec -i cordenaain8n-postgres-1 psql -U cordena_n8n_user -d cordena_n8n
```
Validar: `docker exec cordenaain8n-postgres-1 psql -U cordena_n8n_user -d cordena_n8n -c "\dt handoffs"`

### 2) Cloudflare via API — DNS (CNAME→túnel) + Access App + policy OTP (Git Bash/WSL)
```bash
cd /c/Users/olive/Documents/handoff-daemon
set -a; . /c/Users/olive/Documents/Luma-APP/infra/proxy/.env; set +a
CF_DNS_TOKEN="$CF_DNS_TOKEN" CF_ACCESS_TOKEN="$CF_TOKEN_ACCESS" \
CF_ACCOUNT_ID="$CF_ACCOUNT_ID" CF_ZONE_ID="$CF_ZONE_ID" \
ALLOWED_EMAILS="mattz77.mo@gmail.com" \
TUNNEL_ID="2cae17fe-241b-4d0a-9fe0-6fc5d7d660ba" \
bash scripts/cf-access-setup.sh
```
Guardar o **`CF_ACCESS_AUD`** impresso. (Ingress já está no config.yml — NÃO usar `ADD_TUNNEL_INGRESS`.)

### 3) Envs do daemon
Editar `C:\Users\olive\Documents\handoff-daemon\.env`:
```
CF_ACCESS_TEAM_DOMAIN=<org>.cloudflareaccess.com   # Zero Trust → Settings (team domain)
CF_ACCESS_AUD=<aud do passo 2>
```
Pedir ao usuário o team domain se não estiver acessível.

### 4) Rebuild do daemon
```powershell
cd C:\Users\olive\Documents\handoff-daemon
docker compose up -d --build
```

### 5) Recarregar borda
```powershell
docker restart proxy-cloudflared-1
docker restart proxy-traefik-1
```

### 6) Validar
```powershell
# Direto no Traefik (bypass Cloudflare) — espera 200
curl -s --resolve ops.nicebyte.ia.br:443:127.0.0.1 https://ops.nicebyte.ia.br/health -o NUL -w "%{http_code}`n"
# Logs do daemon
docker logs --tail 20 handoff-daemon
```
Abrir https://ops.nicebyte.ia.br → email → OTP → painel deve carregar os cards/tabelas.

## Critérios de aceite
- [ ] `/health` retorna 200 com `redis:ok` e `postgres:ok`.
- [ ] `https://ops.nicebyte.ia.br` pede OTP (CF Access) e, após login, carrega dados (não 503/401).
- [ ] DLQ/Outbox/Breakers/Handoffs renderizam; botão Replay responde.
- [ ] `luma-n8n` e demais rotas continuam funcionando (ingress não regrediu).

## Rollback
- Remover `infra/proxy/traefik/dynamic/ops.yml` e a linha `ops` do `cloudflared/config.yml`; `docker restart proxy-traefik-1 proxy-cloudflared-1`.
- Reverter o container: `docker compose up -d` (sem `--build`) na imagem anterior, se necessário.

## Gotchas
- Traefik usa **file provider** (labels inertes). Se a rota não subir a quente, `docker restart proxy-traefik-1`.
- O daemon precisa estar em `luma-net` para o Traefik resolver `http://handoff-daemon:3000` (já está, igual ao `hdf`).
- Não expor valores de secret em logs/commits.
```
