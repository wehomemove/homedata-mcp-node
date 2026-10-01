# Production: mcp.homedata.co.uk

The ChatGPT MCP endpoint runs on thor's production box (Forge server
`homeco-live`), beside homedata.co.uk, in `MCP_AUTH=oauth` mode. Set up on
2026-10-01 (ticket qt_0a50efa11c2a).

```text
ChatGPT ──HTTPS──▶ Cloudflare (proxied, SSL Full strict)
          ──HTTPS──▶ nginx mcp.homedata.co.uk (Cloudflare Origin CA cert)
          ──HTTP───▶ 127.0.0.1:8191 node dist/http.js (supervisor: homedata-mcp)
                       └─▶ https://homedata.co.uk/oauth/introspect (shared secret)
                       └─▶ https://api.homedata.co.uk (the signed-in user's key)
```

## Where things are

| What | Where |
| --- | --- |
| Releases | `/home/forge/mcp.homedata.co.uk/releases/<sha>`, `current` → live release |
| Settings and secret | `/home/forge/mcp.homedata.co.uk/.env` (mode 600, never in git) |
| Service | `/etc/supervisor/conf.d/homedata-mcp.conf` (copy of `deploy/supervisor/`) |
| Logs | `/home/forge/mcp.homedata.co.uk/logs/homedata-mcp.log`; nginx `/var/log/nginx/mcp.homedata.co.uk-*.log` |
| nginx site | `/etc/nginx/sites-available/mcp.homedata.co.uk` (copy of `deploy/nginx/`), linked in `sites-enabled` |
| Certificate | `/etc/nginx/ssl/mcp.homedata.co.uk/origin.{crt,key}`: Cloudflare Origin CA, RSA, expires 2041-09-27. The key was generated on the box and never left it. |
| DNS | Cloudflare zone homedata.co.uk: `A mcp → 139.59.184.100`, proxied |
| thor side | `/home/forge/homedata.co.uk/.env`: `OAUTH_RESOURCES=https://mcp.homedata.co.uk` and `OAUTH_INTROSPECTION_SECRET` (the same value as the endpoint's). The pre-change backup is `.env.bak-oauth-20261001T203409Z`. |

The nginx site and the supervisor program are hand-placed, not Forge-managed,
like `journey-listen.conf` on the same box. Forge does not rewrite them.

## Deploy a release

As `forge` on the box:

```sh
cd /home/forge/mcp.homedata.co.uk
./deploy.sh origin/main
```

It builds and tests the ref into `releases/<sha>`, switches `current`,
restarts the service with `sudo -n /usr/bin/supervisorctl restart
homedata-mcp` (Forge's sudo rule allows exactly that), and checks `/healthz`.
If the release is unhealthy it switches back to the previous one and exits 1.
It keeps three releases. When `deploy/deploy.sh` changes, copy it to the box
first.

## Rotate the shared secret

Generate it on the box and write the same value into both `.env` files. Then
run `php artisan config:cache` in thor's `current`, because thor caches config
at deploy, and restart `homedata-mcp`. A mismatch shows up as `503` on signed-in
calls, never as a sign-out.

## Check it is healthy

```sh
curl -s https://mcp.homedata.co.uk/healthz
curl -s https://mcp.homedata.co.uk/.well-known/oauth-protected-resource
# A forged token must get 401 invalid_token. 503 means thor could not be asked or the secret differs.
curl -s -o /dev/null -w '%{http_code}\n' https://mcp.homedata.co.uk/mcp \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -H 'Authorization: Bearer forged-0123456789abcdef' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
node scripts/golden-check.mjs https://mcp.homedata.co.uk/mcp
```

Measured 2026-10-01 against release 0860919: `/healthz` 200; protected-resource
metadata 200 at both paths, pointing at `https://homedata.co.uk`; anonymous
`tools/list` returns 15 tools, each declaring `oauth2 homedata.read`; an
anonymous `tools/call` returns the `mcp/www_authenticate` challenge; a forged
token gets `401 invalid_token`, which shows thor introspection and the shared
secret work; http redirects 301 to https.

Not yet verified: a full sign-in by a real user through ChatGPT. That needs a
Homedata test account with a funded wallet.
