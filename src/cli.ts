#!/usr/bin/env node
/**
 * homedata — command line interface mirroring the Python CLI.
 *
 * Same data as the MCP server but for human shells, scripting, and CI.
 * Usage:
 *   homedata property 100021421083
 *   homedata epc 100021421083 --field current_energy_efficiency
 *   homedata search "10 downing street" --postcode SW1A2AA
 *   homedata batch 100021421083 100022121211
 */

import { HomedataClient, HomedataError } from "./client.js";
import * as t from "./tools.js";
import { VERSION } from "./index.js";

interface ParsedArgs {
  command?: string;
  positional: string[];
  flags: Record<string, string | boolean | string[]>;
}

function parseArgv(argv: string[]): ParsedArgs {
  const out: ParsedArgs = { positional: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        out.flags[key] = true;
      } else {
        out.flags[key] = next;
        i++;
      }
    } else if (!out.command) {
      out.command = a;
    } else {
      out.positional.push(a);
    }
  }
  return out;
}

function printHelp(): void {
  console.log(`homedata ${VERSION} — UK property data CLI

Usage: homedata <command> [args] [--field PATH] [--compact]

Commands:
  property <uprn>                       Look up a property by UPRN (base tier).
  tier <uprn> [--tier T]                Property at a tier (address|base|core|complete).
  valuation <uprn> [--type sale|rent]   AVM sale-price or monthly-rent estimate.
  council-tax <uprn>                    Council tax band, charges + billing authority.
  council-tax-band <uprn>               Council tax band only.
  epc <uprn>                            Get EPC for a UPRN.
  flood <uprn>                          Get flood risk for a UPRN.
  sales <uprn>                          Historical sales (HMLR).
  listings <uprn>                       Past + current listings.
  comparables <uprn> [--count N]        Nearest N comparables (default 20).
  planning <uprn>                       Planning applications near a UPRN.
  schools <uprn> [--radius N]           Schools near a UPRN (default 1000m).
  transport <uprn> [--radius N]         Transport near a UPRN (default 800m).
  crime <postcode> [--date YYYY-MM]     Recorded crime in a postcode.
  demographics <postcode>               ONS Census 2021 profile.
  broadband <postcode>                  Ofcom broadband availability.
  postcode <postcode>                   Aggregated postcode profile.
  search <query> [--postcode PC]        Free-text address search.
  batch <uprn> <uprn> ...               Batch property lookup (max 50).

Flags:
  --field <dotted.path>   Extract a single value from the response (e.g. last_sold_price).
  --compact               Single-line JSON output (good for jq, pipes).
  --version               Show version.
  --help                  Show this help.

Set HOMEDATA_API_KEY in your environment. Get a free key at https://homedata.co.uk/developer.`);
}

function format(data: unknown, compact: boolean, field?: string): string {
  if (field) {
    let cursor: unknown = data;
    for (const part of field.split(".")) {
      if (cursor && typeof cursor === "object" && part in (cursor as Record<string, unknown>)) {
        cursor = (cursor as Record<string, unknown>)[part];
      } else {
        return "";
      }
    }
    if (cursor && typeof cursor === "object") return JSON.stringify(cursor, null, compact ? 0 : 2);
    return String(cursor);
  }
  return JSON.stringify(data, null, compact ? 0 : 2);
}

async function run(args: ParsedArgs): Promise<number> {
  if (args.flags["help"] || args.flags["h"] || !args.command) {
    printHelp();
    return 0;
  }
  if (args.flags["version"] || args.flags["v"]) {
    console.log(`homedata ${VERSION}`);
    return 0;
  }

  let client: HomedataClient;
  try {
    client = HomedataClient.fromEnv(VERSION);
  } catch (err) {
    if (err instanceof HomedataError) {
      console.error(`error: ${err.message}`);
      return 2;
    }
    throw err;
  }

  const p = args.positional;
  let data: unknown;

  switch (args.command) {
    case "property": data = await t.lookup_property(client, p[0]!); break;
    case "tier": data = await t.get_property_tier(client, p[0]!, ((args.flags["tier"] as string) ?? "base") as t.PropertyTier); break;
    case "valuation": data = await t.estimate_valuation(
      client,
      p[0]!,
      ((args.flags["type"] as string) ?? "sale") as "sale" | "rent",
      args.flags["bedrooms"] ? Number(args.flags["bedrooms"]) : undefined,
      args.flags["property_type"] as string | undefined,
    ); break;
    case "council-tax": data = await t.lookup_council_tax(client, p[0]!); break;
    case "council-tax-band": data = await t.lookup_council_tax_band(client, p[0]!); break;
    case "epc": data = await t.lookup_epc(client, p[0]!); break;
    case "flood": data = await t.lookup_flood_risk(client, p[0]!); break;
    case "sales": data = await t.get_property_sales(client, p[0]!); break;
    case "listings": data = await t.search_property_listings(client, p[0]!); break;
    case "planning": data = await t.get_planning_applications(client, p[0]!); break;
    case "comparables": data = await t.get_comparables(client, p[0]!, Number(args.flags["count"] ?? 20)); break;
    case "schools": data = await t.get_schools(client, p[0]!, Number(args.flags["radius"] ?? 1000)); break;
    case "transport": data = await t.get_transport(client, p[0]!, Number(args.flags["radius"] ?? 800)); break;
    case "crime": data = await t.get_crime(client, p[0]!, args.flags["date"] as string | undefined); break;
    case "demographics": data = await t.get_demographics(client, p[0]!); break;
    case "broadband": data = await t.get_broadband(client, p[0]!); break;
    case "postcode": data = await t.get_postcode_profile(client, p[0]!); break;
    case "search": data = await t.search_address(client, p[0]!, args.flags["postcode"] as string | undefined); break;
    case "batch": data = await t.batch_property_lookup(client, p); break;
    default:
      console.error(`unknown command: ${args.command}`);
      printHelp();
      return 2;
  }

  console.log(format(data, args.flags["compact"] === true, args.flags["field"] as string | undefined));
  if (data && typeof data === "object" && "error" in (data as Record<string, unknown>)) {
    return 1;
  }
  return 0;
}

run(parseArgv(process.argv.slice(2)))
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error("[homedata] fatal:", err);
    process.exit(1);
  });
