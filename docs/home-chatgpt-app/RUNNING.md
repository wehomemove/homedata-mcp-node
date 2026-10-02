# Home ChatGPT app endpoint

Home is a separate, public, read-only MCP surface. It reuses this repository's stateless Streamable HTTP pattern but does not change the `homedata-mcp` command or published npm package.

## Run locally

```sh
npm ci
npm run build
HOMEDATA_API_KEY=... HOME_MCP_PATH=/mcp PORT=4177 npm run home:http
```

The Homedata key is held only by the server and enriches listing details. ChatGPT and other callers use every Home tool without authentication. `HOME_BASE_URL` and `HOMEDATA_BASE_URL` exist for staging and tests; production should leave both unset.

`MCP_CALLS_PER_MINUTE` defaults to 30 per caller. `HOME_ENRICHMENTS_PER_MINUTE` separately defaults to four homes per caller because those lookups use the server-held Homedata key; a four-home comparison consumes all four units. Set `HOME_CLIENT_IP_HEADER=cf-connecting-ip` only behind the trusted proxy configuration that removes caller-supplied copies of that header. Without it, limits use the direct socket address. Invalid limit values prevent startup rather than silently removing the cap.

The endpoint answers MCP at `HOME_MCP_PATH` and health checks at `/healthz`. It is stateless: each POST creates a fresh MCP server and no search, shortlist or user preference is retained.

## Checks

`npm test` covers the endpoint, trimmed search cards, full-detail enrichment, metadata, the golden set and npm exclusion. Against a deployed endpoint, run:

```sh
node scripts/home-golden-check.mjs https://mcp.home.co.uk/mcp
```

Search reads home.co.uk's public JSON. Search responses deliberately omit HTML cards, boundaries, map pins and all other page payload. One-home and comparison responses resolve the listing's published address to a UPRN and request the Homedata Core record; an unmatched address is reported as unavailable rather than guessed.
