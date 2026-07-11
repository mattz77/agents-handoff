# Painel /ops — Acesso via subdomínio + Cloudflare Access (Zero Trust)

Painel de operação do Handoff Daemon publicado em **`https://ops.nicebyte.ia.br`**, protegido por
**Cloudflare Access** com login por **código no email (One-time PIN / OTP)** — sem senha, sem IdP.

## Arquitetura do acesso

```
Navegador
   │  https://ops.nicebyte.ia.br
   ▼
Cloudflare (edge)
   ├─ Access Application  ──►  pede email ──► envia OTP ──► valida
   │                          (cookie CF_Authorization + JWT assinado)
   ▼  (apenas IPs Cloudflare chegam ao origin)
Traefik (file provider: traefik/dynamic/ops.yml)
   ├─ middleware cf-allowlist (só aceita IPs do Cloudflare)
   ▼
handoff-daemon:3000
   └─ revalida o JWT (Cf-Access-Jwt-Assertion) via JWKS  ──►  /ops/api/*
```

Três camadas: **OTP no edge** (quem entra) → **ipAllowList no Traefik** (bloqueia origin direto) →
**validação de JWT no app** (defesa final). O painel não tem senha própria.

## Passo a passo

### 1. Pré-requisitos no servidor
`bash`, `curl`, `jq`. O container `handoff-daemon` precisa estar na mesma rede docker do Traefik
(assumido `luma-net`).

### 2. Provisionar Cloudflare (DNS + Access + OTP)
As API keys ficam no servidor. Exporte e rode o script:

```bash
export CF_API_TOKEN=...        # Zone:DNS:Edit + Account: Access Apps/Policies:Edit
export CF_ACCOUNT_ID=...
export CF_ZONE_ID=...           # zona nicebyte.ia.br
export ALLOWED_EMAILS=mattz77.mo@gmail.com
export DNS_CONTENT=<IP_PUBLICO_DO_SERVIDOR>   # ou alvo do túnel, com DNS_TYPE=CNAME

bash scripts/cf-access-setup.sh
```

O script é idempotente e, ao final, imprime o **`CF_ACCESS_AUD`**.

### 3. Configurar o daemon
No `.env`:

```
CF_ACCESS_TEAM_DOMAIN=<sua-org>.cloudflareaccess.com
CF_ACCESS_AUD=<aud impresso pelo script>
```

> O team domain está em **Zero Trust → Settings**. Se ainda não escolheu um, defina lá primeiro.

### 4. Traefik
Copie/monte `traefik/dynamic/ops.yml` no diretório de config dinâmica do seu Traefik.
Ajuste em `ops.yml`:
- `certResolver: letsencrypt` → nome do seu resolver na config **estática**;
- a rede docker, se o Traefik não estiver em `luma-net`;
- a lista de IPs do Cloudflare é mantida em https://www.cloudflare.com/ips/ (revise periodicamente).

### 5. Subir
```bash
npm run build
docker compose up -d --build
```

Acesse `https://ops.nicebyte.ia.br` → informe o email → digite o código recebido → painel carrega.
Botão **Sair** encerra a sessão (`/cdn-cgi/access/logout`).

## Notas de segurança
- **Fail-closed:** sem `CF_ACCESS_TEAM_DOMAIN`/`CF_ACCESS_AUD`, as APIs `/ops/api/*` retornam 503.
- O JWT é validado por assinatura (RS256 via JWKS do time), `iss`, `aud` e `exp`.
- Para revogar acesso de alguém, remova o email da policy (rode o script de novo) ou ajuste no painel Zero Trust.
- O endpoint `/health` permanece aberto (sem dados sensíveis) para o healthcheck do Traefik.
- Rotacione `CF_API_TOKEN` após o setup se ele tiver sido exposto.
