# Running the remote endpoint

`homedata-mcp-http` serves the ChatGPT tool profile (`src/profile.ts`) over MCP
streamable HTTP, the transport ChatGPT requires. It is stateless.

Two auth modes, chosen by `MCP_AUTH`:

**`oauth` (default): each user signs in with their Homedata account.**
ChatGPT links the account through thor's OAuth server
(`https://homedata.co.uk/.well-known/oauth-authorization-server`). Listing
tools is anonymous. A tool call needs a bearer token, which the endpoint
checks with thor's introspection route, then runs on the key thor returns, so
it charges the user's own wallet. No key is held here.

| Variable | Default | Meaning |
| --- | --- | --- |
| `MCP_RESOURCE` | required | This endpoint's canonical URL, e.g. `https://mcp.homedata.co.uk`. It must equal an entry in thor's `OAUTH_RESOURCES` exactly. It is permanent once the plugin is published. |
| `OAUTH_INTROSPECTION_SECRET` | required | The same value as thor's `OAUTH_INTROSPECTION_SECRET`, at least 32 characters. Keep it out of git. |
| `OAUTH_ISSUER` | `https://homedata.co.uk` | thor's issuer, exactly as its metadata states it. |
| `OAUTH_INTROSPECTION_URL` | `<issuer>/oauth/introspect` | |
| `MCP_PATH` | `/mcp` | |
| `HOMEDATA_API_KEY` | must be unset | The server refuses to start with one, so that it cannot become a hidden shared wallet. |

The endpoint serves `/.well-known/oauth-protected-resource` (and the same path
with `MCP_PATH` appended), which points ChatGPT at thor. A call made without
signing in returns the `mcp/www_authenticate` challenge that makes ChatGPT
offer to connect the account. A token thor will not vouch for gets `401` with
`WWW-Authenticate`. If thor is unreachable the endpoint answers `503`, not
`401`, so an outage never signs anyone out. Active answers are cached for up
to a minute, so a revoked link stops working within a minute.

**`server-key`: developer-mode testing only.** The server holds one test
wallet's key and the tools are declared `noauth`.

| Variable | Default | Meaning |
| --- | --- | --- |
| `HOMEDATA_API_KEY` | required | A dedicated test wallet's key. |
| `MCP_PATH` | required | Must end in a secret segment of at least 16 URL-safe characters, such as `/mcp/<32 random hex>`. Without one the server refuses to start, because the path is the only thing between the internet and that wallet. It is never logged. |

Both modes:

| Variable | Default | Meaning |
| --- | --- | --- |
| `MCP_CALLS_PER_MINUTE` | `30` | Tool calls per caller per minute: per signed-in user in `oauth` mode (unsigned calls only get the sign-in challenge and are not capped), for the whole server in `server-key` mode. A whole number of at least 1. Over the cap, the endpoint answers 429. |
| `PORT` / `HOST` | `4176` / `127.0.0.1` | Listener. |

`GET /healthz` answers `{ ok, version }`.

```sh
npm run build
MCP_AUTH=server-key HOMEDATA_API_KEY=… MCP_PATH=/mcp/$(openssl rand -hex 16) node dist/http.js
npx @modelcontextprotocol/inspector   # Streamable HTTP → http://127.0.0.1:4176/mcp/…
```

The stdio server (`homedata-mcp`) is unchanged: it serves every tool, with
prices and the signup helpers.

## Golden prompt set

`docs/chatgpt-app/golden-prompts.json` holds the labelled prompts to run in
ChatGPT developer mode after every change to tool names, descriptions,
schemas or annotations: direct, indirect, follow-up, negative and boundary
cases. A case may list `expect.allowed` calls that can happen but are not required; any other call fails it. The cases marked `review: true` are the submission packet's five
positive and three negative cases.

`npm test` checks the set against the ChatGPT tool list. To check it against
a deployed endpoint:

```sh
npm run build && node scripts/golden-check.mjs https://<host>/mcp/<secret>
```

It exits 0 when the set holds, 1 when it has drifted from the tools, and 2
when the endpoint cannot be read. These checks keep the set in step with the
tools; only a run in ChatGPT shows whether the model picks them.
