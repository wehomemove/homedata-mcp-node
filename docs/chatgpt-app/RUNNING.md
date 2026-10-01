# Running the remote endpoint

`homedata-mcp-http` serves the ChatGPT tool profile (`src/profile.ts`) over MCP
streamable HTTP, the transport ChatGPT requires. It is stateless.

| Variable | Default | Meaning |
| --- | --- | --- |
| `HOMEDATA_API_KEY` | required | Phase 1 only: a dedicated test wallet's key, held by the server because ChatGPT cannot send API keys. |
| `MCP_PATH` | required | Path the endpoint answers on. It must end in a secret segment of at least 16 URL-safe characters, such as `/mcp/<32 random hex>`. Without one the server refuses to start, so a missing variable cannot open the wallet at `/mcp`. It is never logged. |
| `MCP_CALLS_PER_MINUTE` | `30` | Process-wide cap on tool calls (a whole number of at least 1). Over the cap, the endpoint answers 429. It limits the rate only; the path is the access control. |
| `PORT` / `HOST` | `4176` / `127.0.0.1` | Listener. |

`GET /healthz` answers `{ ok, version }`.

```sh
npm run build
HOMEDATA_API_KEY=… MCP_PATH=/mcp/$(openssl rand -hex 16) node dist/http.js
npx @modelcontextprotocol/inspector   # Streamable HTTP → http://127.0.0.1:4176/mcp/…
```

The stdio server (`homedata-mcp`) is unchanged: it serves every tool, with
prices and the signup helpers.

## Golden prompt set

`docs/chatgpt-app/golden-prompts.json` holds the labelled prompts to run in
ChatGPT developer mode after every change to tool names, descriptions,
schemas or annotations: direct, indirect, follow-up, negative and boundary
cases. The cases marked `review: true` are the submission packet's five
positive and three negative cases.

`npm test` checks the set against the ChatGPT tool list. To check it against
a deployed endpoint:

```sh
npm run build && node scripts/golden-check.mjs https://<host>/mcp/<secret>
```

It exits 0 when the set holds, 1 when it has drifted from the tools, and 2
when the endpoint cannot be read. These checks keep the set in step with the
tools; only a run in ChatGPT shows whether the model picks them.
