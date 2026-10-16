# Homemove ChatGPT app — running it

Started 16 Oct 2026 (Louis: "a quote for absolutely any moving service", presented by the Homies).

## Shape

```
ChatGPT ──HTTPS──▶ Cloudflare (homemove.com zone, proxied, Full strict)
          ──HTTPS──▶ nginx mcp.homemove.com (Cloudflare Origin CA cert, key generated on the box)
          ──HTTP───▶ homemove-mcp (supervisor, node dist/homemove/http.js, 127.0.0.1:8193)
                       ├─▶ motus Bookings MCP API (app.homemove.com/api/mcp/bookings/*) — every price
                       └─▶ Homedata API — address match (5 tokens) + rooms add-on (1); core (25) only
                           for value-band products when the user gave no value
```

| What | Where |
|---|---|
| Endpoint | `https://mcp.homemove.com/mcp` (no sign-in) |
| Service | supervisor `homemove-mcp`, `/etc/supervisor/conf.d/homemove-mcp.conf` |
| Settings | `/home/forge/mcp.homemove.com/.env` (0600): HOMEDATA_API_KEY, HOMEMOVE_MCP_BEARER, MOTUS_BASE_URL, HOMEMOVE_MCP_ORIGIN, PORT=8193, MCP_CALLS_PER_MINUTE, HOMEMOVE_CLIENT_IP_HEADER=cf-connecting-ip, OPENAI_APPS_CHALLENGE (once the portal issues one) |
| motus caller | principal `agent:chatgpt-homemove` (hm_mcp_principals id 2): ops `get_quote`, `list_products`; product scope all_consumer; 120/min. Kill switch: `enabled=false`. Bearer rotation: `php artisan mcp:principal:create agent:chatgpt-homemove --rotate` on the homemove box, piped straight into the .env, never printed |
| Certificate | `/etc/nginx/ssl/mcp.homemove.com/origin.{crt,key}`, Cloudflare Origin CA, expires 2041-10-12 |
| DNS | Cloudflare zone homemove.com: `A mcp → 139.59.184.100`, proxied |
| Bot rule | homemove.com custom rule "mcp.homemove.com (Homemove ChatGPT app MCP endpoint…)": skips managed WAF, SBFM and challenge-type products; rate limiting retained. Without it OpenAI's datacenter calls get a managed challenge |

## Release

```
ssh homeco-live 'DEPLOY_PROGRAM=homemove-mcp DEPLOY_ROOT=/home/forge/mcp.homemove.com \
  DEPLOY_HEALTH=http://127.0.0.1:8193/healthz /home/forge/mcp.homedata.co.uk/deploy.sh origin/main'
```

## Honesty rules the code enforces (src/test/homemove.test.ts)

- A price is shown or told to the model only when motus's get_quote priced it with every question answered.
  motus's base price for an unanswered product (`from: true`) never leaves the server.
- The Homedata value estimate only chooses a band. The estimate itself is never in a tool result.
- A combination the grid leaves unpriced (5+ bedroom clean, expert-witness valuation) says "quoted by the team".

## Widget

`src/homemove/widget/` — Homies and the loop rig copied from the iOS app (`homemove-ios-native`
Resources/Homies, Data/homie-loops.json); springs, celebration and confetti ported from Theme.swift and
Joy/*.swift. Served from this endpoint under a content-hashed prefix. Preview locally with
`src/homemove/widget/index.html?demo=priced|needs_answers|clean|value`.
