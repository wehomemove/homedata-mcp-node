# Changelog

All notable changes to the Node.js edition of the Homedata MCP server.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] - 2026-06-19

### Added — full API parity
Wrapped every remaining public Homedata endpoint as a tool. New tools:
`discover_property`, `get_property_custom`, `get_avm_comparables`, `get_lr_sales`,
`search_live_listings`, `get_addresses_at_postcode`, `get_deprivation`,
`get_conservation_areas`, `get_listed_buildings`, `get_planning_designations`,
`get_amenities`, `get_fuel_stations`, `get_healthcare`, `get_risks`, `get_energy`,
`get_brownfield`, `get_boreholes`, `get_environment_report`, `get_rights_of_way`,
`get_solar_assessment`, `get_price_trends`, `get_price_distribution`,
`get_price_growth`, `get_agent_stats`. CLI gains matching commands.

### Fixed
- `get_schools` / `get_transport` signatures corrected (schools takes phase/ofsted
  filters; transport is postcode-keyed, not UPRN). `get_crime` gains `category`.
- JSON-Schema converter now also emits `boolean` types.

## [0.2.0] - 2026-06-19

### Fixed
- `lookup_property` now calls the canonical singular route `/api/property/{uprn}/base/`. The old plural `/api/properties/{uprn}/` is being sunset.
- `lookup_council_tax` now calls the live `/api/council_tax/{uprn}/` endpoint — the 503 "coming soon" stub is gone (the endpoint shipped weeks ago).

### Added
- `get_property_tier` — full property data at a chosen detail tier (address/base/core/complete); strict supersets.
- `estimate_valuation` — AVM sale-price or monthly-rent estimate by UPRN, with optional bedrooms / property_type overrides.
- `lookup_council_tax_band` — band-only lookup (cheaper than the full council tax bundle).
- CLI gains `tier`, `valuation`, `council-tax`, and `council-tax-band` commands.
- JSON-Schema converter now emits `enum` constraints (tier, valuation type) so MCP hosts pick valid values.
- Default request timeout raised to 30s (valuation runs live comparable computation); overridable via `HOMEDATA_TIMEOUT_MS`.

## [0.1.0] - 2026-05-11

### Added
- Initial release of the Node.js / TypeScript edition.
- Feature-parity with `homedata-mcp` 0.2.0 on PyPI: same 15 working tools plus the `lookup_council_tax` stub, same env-var auth (`HOMEDATA_API_KEY`), same base URL.
- Ships both `homedata-mcp` (stdio MCP server) and `homedata` (CLI) binaries from a single package.
- Built on the official `@modelcontextprotocol/sdk`; communicates over stdio with any MCP-compatible client (Claude Desktop, Claude Code, Cursor, Codex, Cline, Continue.dev, Windsurf, Zed).
- TypeScript source with full `.d.ts` types — package can be imported as a library too: `import { HomedataClient, tools } from "homedata-mcp"`.
