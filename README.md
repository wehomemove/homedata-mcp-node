# Homedata MCP — Node.js / npm

The official Homedata MCP server and CLI for the [Model Context Protocol](https://modelcontextprotocol.io). Brings 29M UK addresses with EPC, sale history, planning applications, flood risk, comparables, demographics, crime, schools, broadband and transport into any MCP-compatible AI tool — Claude Desktop, Claude Code, Cursor, Codex, Cline, Continue.dev, Windsurf, Zed and more.

Behaviour is identical to the [Python edition (`homedata-mcp`)](https://pypi.org/project/homedata-mcp/) — same tools, same data, same env-var auth. Pick the one that matches your stack.

> Data sourced from Home.co.uk's 30-year panel of partners, the Environment Agency, ONS Census 2021, the Valuation Office Agency, Ofcom, Ofsted, data.police.uk and HM Land Registry.

---

## Install

```bash
npm install -g homedata-mcp
```

Or run on demand with `npx`:

```bash
npx homedata-mcp        # starts the MCP server (stdio)
npx homedata --help     # CLI
```

Get a free Homedata API key at [homedata.co.uk/developer](https://homedata.co.uk/developer) — no card required to start.

```bash
export HOMEDATA_API_KEY=hd_live_xxx
```

---

## Wire it into Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "homedata": {
      "command": "npx",
      "args": ["-y", "homedata-mcp"],
      "env": {
        "HOMEDATA_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

Restart Claude Desktop and ask "what's the EPC rating for UPRN 100021421083?". Same pattern works for Cursor, Codex, Cline, Continue.dev, Windsurf, and Zed — see [homedata.co.uk/mcp](https://homedata.co.uk/mcp) for per-client guides.

---

## CLI

The package also installs a `homedata` command for shell use, scripting, and CI:

```bash
homedata property 100021421083
homedata epc 100021421083 --field current_energy_efficiency
homedata search "10 downing street" --postcode SW1A2AA
homedata flood 100021421083 --compact
homedata batch 100021421083 100022121211
```

Pass `--field <dotted.path>` to extract a single value (good for shell pipelines) and `--compact` for single-line JSON.

---

## Tools

| Tool | Description |
|---|---|
| `lookup_property(uprn)` | Property attributes + EPC summary + last sold price |
| `lookup_epc(uprn)` | Full Energy Performance Certificate |
| `lookup_flood_risk(uprn)` | Flood risk assessment |
| `get_property_sales(uprn)` | Historical sales (HMLR) |
| `search_property_listings(uprn)` | Past + current listing events |
| `get_comparables(uprn, count?)` | Nearest N comparable properties |
| `get_planning_applications(uprn)` | Planning applications near a UPRN |
| `get_schools(uprn, radius_m?)` | Schools near a UPRN |
| `get_transport(uprn, radius_m?)` | Transport options near a UPRN |
| `get_crime(postcode, date?)` | Recorded crime in the postcode |
| `get_demographics(postcode)` | ONS Census 2021 profile |
| `get_broadband(postcode)` | Ofcom broadband availability |
| `get_postcode_profile(postcode)` | Aggregated postcode profile |
| `search_address(query, postcode?)` | Free-text address search |
| `batch_property_lookup(uprns)` | Batch lookup (max 50) |
| `lookup_council_tax(uprn)` | _In development — currently returns a 503 stub_ |

---

## Privacy

The MCP server runs locally on your machine. Your queries go directly from your machine to `api.homedata.co.uk` — your AI vendor never sees the property data.

---

## Links

* Homedata: <https://homedata.co.uk>
* Pricing: <https://homedata.co.uk/pricing>
* Developer dashboard: <https://homedata.co.uk/developer>
* Python edition: <https://pypi.org/project/homedata-mcp/>
* Issues: <https://github.com/wehomemove/homedata-mcp-node/issues>

---

## License

MIT
