# Runbook — Subir o painel em ops.nicebyte.ia.br

Específico da infra real (Docker local, Traefik file provider, túnel `luma`).
Rode os comandos **no host** (PowerShell). Tokens/IDs já existem em `infra/proxy/.env`.

Contexto verificado:
- Traefik `proxy-traefik-1` (file provider em `infra/proxy/traefik/dynamic/`).
- Túnel `luma` = `2cae17fe-241b-4d0a-9fe0-6fc5d7d660ba` (`proxy-cloudflared-1`).
- `handoff-daemon` já roteado em `hdf`; agora adicionamos `ops` (route + ingress já criados).
- Postgres do n8n: container `cordenaain8n-postgres-1`, DB `cordena_n8n`, user `cordena_n8n_user` (o mesmo do `DATABASE_URL` do daemon).

---

## 1. Schema do handoff no Postgres do n8n
Cria as tabelas `handoffs` e `outbox` (o painel lê delas).

```powershell
Get-Content C:\Users\olive\Documents\handoff-daemon\sql\01_schema.sql | `
  docker exec -i cordenaain8n-postgres-1 psql -U cordena_n8n_user -d cordena_n8n
```

## 2. Cloudflare: DNS (CNAME→túnel) + Access App + OTP — via API
Usa os tokens/IDs do `infra/proxy/.env`. Rode num shell bash (Git Bash/WSL):

```bash
cd /c/Users/olive/Documents/handoff-daemon
set -a; . /c/Users/olive/Documents/Luma-APP/infra/proxy/.env; set +a

CF_DNS_TOKEN="$CF_DNS_TOKEN" \
CF_ACCESS_TOKEN="$CF_TOKEN_ACCESS" \
CF_ACCOUNT_ID="$CF_ACCOUNT_ID" \
CF_ZONE_ID="$CF_ZONE_ID" \
ALLOWED_EMAILS="mattz77.mo@gmail.com" \
TUNNEL_ID="2cae17fe-241b-4d0a-9fe0-6fc5d7d660ba" \
bash scripts/cf-access-setup.sh
```

> O ingress do túnel já está no `config.yml` (não use `ADD_TUNNEL_INGRESS`).
> O script imprime o **`CF_ACCESS_AUD`** no final — copie.

Alternativa só-DNS (se preferir): `docker exec proxy-cloudflared-1 cloudflared tunnel route dns luma ops.nicebyte.ia.br` e crie o Access App pelo dashboard (Zero Trust → Access → Applications → self-hosted → `ops.nicebyte.ia.br` → policy One-time PIN incluindo seu email).

## 3. Configurar o daemon
No `C:\Users\olive\Documents\handoff-daemon\.env`:

```
CF_ACCESS_TEAM_DOMAIN=<sua-org>.cloudflareaccess.com   # Zero Trust → Settings → Custom Pages (team domain)
CF_ACCESS_AUD=<aud impresso no passo 2>
```

## 4. Rebuild do daemon (está rodando código antigo, sem o painel)
```powershell
cd C:\Users\olive\Documents\handoff-daemon
docker compose up -d --build
```

## 5. Recarregar a borda
```powershell
docker restart proxy-cloudflared-1   # releu o ingress do ops
docker restart proxy-traefik-1       # garante o pickup do dynamic/ops.yml
```

## 6. Validar
```powershell
# bypass Cloudflare (bate direto no Traefik; deve dar 200 no /health)
curl -s --resolve ops.nicebyte.ia.br:443:127.0.0.1 https://ops.nicebyte.ia.br/health -o NUL -w "%{http_code}`n"
```
Depois abra **https://ops.nicebyte.ia.br** → informe o email → digite o código (OTP) → painel.

---

### Notas
- `infra/proxy/traefik/dynamic/ops.yml` usa a mesma cadeia do `handoff.yml` (`crowdsec-bouncer` → `cloudflare-only` → `security-headers`) + TLS Origin Cert default.
- O daemon revalida o JWT do CF Access nas rotas `/ops/api/*` (fail-closed se faltar `CF_ACCESS_TEAM_DOMAIN`/`CF_ACCESS_AUD`).
- O arquivo `handoff-daemon/traefik/dynamic/ops.yml` (genérico, criado antes) ficou **redundante** — a rota real é a de `infra/proxy/traefik/dynamic/ops.yml`.
- Painel também responde em `/` (raiz) além de `/ops`.
```
