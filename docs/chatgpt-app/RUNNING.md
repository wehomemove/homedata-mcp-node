# Running the remote endpoint

`homedata-mcp-http` serves the ChatGPT tool profile (`src/profile.ts`) over MCP
streamable HTTP, the transport ChatGPT requires. It is stateless.

| Variable | Default | Meaning |
| --- | --- | --- |
| `HOMEDATA_API_KEY` | required | Phase 1 only: a dedicated test wallet's key, held by the server because ChatGPT cannot send API keys. |
| `MCP_PATH` | `/mcp` | Path the endpoint answers on. In phase 1 set it to an unguessable value such as `/mcp/<random>`; it is never logged. |
| `MCP_CALLS_PER_MINUTE` | `30` | Process-wide cap on tool calls. Over the cap, the endpoint answers 429. |
| `PORT` / `HOST` | `4176` / `127.0.0.1` | Listener. |

`GET /healthz` answers `{ ok, version }`.

```sh
npm run build
HOMEDATA_API_KEY=… MCP_PATH=/mcp/$(openssl rand -hex 16) node dist/http.js
npx @modelcontextprotocol/inspector   # Streamable HTTP → http://127.0.0.1:4176/mcp/…
```

The stdio server (`homedata-mcp`) is unchanged: it serves every tool, with
prices and the signup helpers.
