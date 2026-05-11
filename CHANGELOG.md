# Changelog

All notable changes to the Node.js edition of the Homedata MCP server.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-05-11

### Added
- Initial release of the Node.js / TypeScript edition.
- Feature-parity with `homedata-mcp` 0.2.0 on PyPI: same 15 working tools plus the `lookup_council_tax` stub, same env-var auth (`HOMEDATA_API_KEY`), same base URL.
- Ships both `homedata-mcp` (stdio MCP server) and `homedata` (CLI) binaries from a single package.
- Built on the official `@modelcontextprotocol/sdk`; communicates over stdio with any MCP-compatible client (Claude Desktop, Claude Code, Cursor, Codex, Cline, Continue.dev, Windsurf, Zed).
- TypeScript source with full `.d.ts` types — package can be imported as a library too: `import { HomedataClient, tools } from "homedata-mcp"`.
