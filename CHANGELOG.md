# Changelog

All notable changes to `homedata-mcp` (Node) will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - unreleased

A rebuild. The tools are now exactly the self-serve endpoints of the Homedata
Developer Playground: 56 data tools plus two signup helpers, built from a
manifest vendored from the Python package (`src/manifest/`, with the source
commit and a hash per file in `SOURCE.json`). This is a breaking release; the
table below maps every 0.1.0 tool.

### Changed
- Every tool is built from the vendored manifest: no hand-written tools, no
  per-tool zod schemas. Names, arguments, requests and prices match the
  Playground and the Python package, and CI runs the Python package's parity
  guard against this server so the two cannot drift apart.
- Prices are stated in tokens in every tool description, and each call reports
  what it actually cost in the result metadata (`homedata.tokens_charged`).
- Arguments are validated before a request is sent; an invalid call never
  reaches the API.
- `start_homedata_signup` and `check_homedata_api_key` are new here: 0.1.0 had
  no helpers and exited when `HOMEDATA_API_KEY` was unset. The server now starts
  without a key and offers them. Neither calls the API.
- The `homedata` command is rebuilt on the same tool list:
  `homedata <tool> --<argument> value`, `homedata tools` lists prices, and
  `homedata <tool> --help` lists that tool's arguments.
- `npm test` runs real tests. It pointed at `dist/test/*.js`, which never
  existed, so `npm test` had always passed without running anything.
- Default request timeout raised from 10s to 30s for the deepest property tiers.
- Library exports: the per-tool functions are gone. The package now exports
  `HomedataClient`, `buildRequest`, `validateArguments`, `inputSchema`,
  `buildServer` and the manifest. The client API changed with them:
  `HomedataResponse` is now `ApiResponse`, and `get()` / `post()` are replaced by
  one `send()`:

  ```ts
  // 0.1.0
  const data = await client.get(`/api/properties/${uprn}/`);
  // 1.0.0
  const { statusCode, body, headers } = await client.send("GET", `/properties/${uprn}/`);
  ```
- A request that never reaches the API (DNS, connection refused) now comes back as
  502 rather than 0, so callers that treat >= 400 as failure no longer read it as
  success. A timeout is still 504.
- Arguments are checked against the relationships the manifest declares: `lat` and
  `lng` must be given together, and a tool offering a postcode OR coordinates needs
  one of them. Non-finite numbers are refused rather than sent as `NaN`.
- The CLI rejects an unknown `--flag` instead of ignoring it, so a misspelt flag
  cannot run a different request from the one typed.

### Migration from 0.1.0

| 0.1.0 tool | 1.0.0 |
|---|---|
| `search_address` | `address_find` (argument `q`; the `postcode` filter is gone) |
| `lookup_property` | removed; use `property_base` or `property_core` |
| `batch_property_lookup` | removed |
| `lookup_epc` | `attr_epc` |
| `lookup_flood_risk` | `risks` with `risk_type` `flood` |
| `lookup_council_tax` | `council_tax` for the band, `council_tax_full` for the charge (0.1.0 returned a hard-coded "in development" stub and never called the API) |
| `get_planning_applications` | `planning` (by `postcode` or `lat`/`lng`, not UPRN) |
| `get_schools` | `schools` (by `postcode`, not UPRN) |
| `get_transport` | `amenities_transport` |
| `get_crime` | `crime` |
| `get_demographics` | `demographics` |
| `get_broadband` | `broadband` |
| `get_postcode_profile` | `postcode_profile` |
| `search_property_listings` | removed: listings are not offered through the MCP |
| `get_property_sales` | removed: not offered through the MCP |
| `get_comparables` | removed: not offered through the MCP |

### Added
The property tiers (`property_discovery`, `property_address`, `property_base`,
`property_core`, `property_complete`, `property_custom`), property attributes,
`property_lr_titles`, `address_postcode`, `risks`, `deprivation`, price trends,
distributions and growth, `solar`, `listed_buildings`, amenities, fuel stations,
healthcare, `boundaries`, council tax, and the stamp duty and mortgage
calculators. The full list with prices is in the README.

## [0.1.0] - 2026-05-11

### Added
- Initial release of the Node.js / TypeScript edition.
- Feature-parity with `homedata-mcp` 0.2.0 on PyPI: same 15 working tools plus the `lookup_council_tax` stub, same env-var auth (`HOMEDATA_API_KEY`), same base URL.
- Ships both `homedata-mcp` (stdio MCP server) and `homedata` (CLI) binaries from a single package.
- Built on the official `@modelcontextprotocol/sdk`; communicates over stdio with any MCP-compatible client (Claude Desktop, Claude Code, Cursor, Codex, Cline, Continue.dev, Windsurf, Zed).
- TypeScript source with full `.d.ts` types — package can be imported as a library too: `import { HomedataClient, tools } from "homedata-mcp"`.
