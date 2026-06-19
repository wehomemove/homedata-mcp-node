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

Property (by UPRN):
  property <uprn>                       Base-tier property lookup.
  tier <uprn> [--tier T]                Tier (address|base|core|complete).
  discover <uprn>                       Available add-ons + per-slug cost.
  custom <uprn> --with a,b,c            Custom à-la-carte slug bundle.
  batch <uprn> <uprn> ...               Batch lookup (max 50).
  epc <uprn>                            Energy Performance Certificate.
  council-tax <uprn>                    Band, charges + authority.
  council-tax-band <uprn>               Band only.
  valuation <uprn> [--type sale|rent]   AVM sale-price / rent estimate.
  avm <uprn> [--count N]                AVM comparable evidence set.
  sales <uprn>                          Sale + listing timeline.
  lr-sales <uprn>                       HM Land Registry price-paid.
  listings <uprn>                       Past + current listings.
  comparables <uprn> [--count N]        Nearest N comparables.
  planning <uprn>                       Planning applications nearby.
  schools <uprn> [--radius --phase --ofsted]   Nearby schools.
  flood <uprn> | risks <uprn> --type T  Flood / environmental risk.
  energy|brownfield|boreholes|environment-report|rights-of-way <uprn>
  solar <uprn>                          Solar/PV assessment.
  amenities|fuel|healthcare <uprn> [--radius --limit]   Nearby POIs.
  agent-stats <uprn>                    Local agent performance.

Area (by postcode / outcode):
  search <query> [--postcode PC]        Free-text address search.
  addresses <postcode>                  All addresses at a postcode.
  transport <postcode> [--radius N]     Nearby transport stops.
  crime <postcode> [--date --category]  Recorded crime.
  demographics|deprivation|broadband|postcode <postcode>
  conservation-areas|listed-buildings|planning-designations <postcode>
  price-trends|price-distribution|price-growth <outcode>
  live-listings [--postcode --min_price --max_price --min_bedrooms --type]

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

  const num = (k: string) => (args.flags[k] !== undefined ? Number(args.flags[k]) : undefined);
  const str = (k: string) => args.flags[k] as string | undefined;

  switch (args.command) {
    // Property
    case "property": data = await t.lookup_property(client, p[0]!); break;
    case "tier": data = await t.get_property_tier(client, p[0]!, ((args.flags["tier"] as string) ?? "base") as t.PropertyTier); break;
    case "discover": data = await t.discover_property(client, p[0]!); break;
    case "custom": data = await t.get_property_custom(client, p[0]!, (str("with") ?? "").split(",").filter(Boolean)); break;
    case "batch": data = await t.batch_property_lookup(client, p); break;
    // EPC / council tax
    case "epc": data = await t.lookup_epc(client, p[0]!); break;
    case "council-tax": data = await t.lookup_council_tax(client, p[0]!); break;
    case "council-tax-band": data = await t.lookup_council_tax_band(client, p[0]!); break;
    // Valuation
    case "valuation": data = await t.estimate_valuation(client, p[0]!, ((str("type")) ?? "sale") as "sale" | "rent", num("bedrooms"), str("property_type")); break;
    case "avm": data = await t.get_avm_comparables(client, p[0]!, Number(args.flags["count"] ?? 20)); break;
    // Sales / listings
    case "sales": data = await t.get_property_sales(client, p[0]!); break;
    case "lr-sales": data = await t.get_lr_sales(client, p[0]!); break;
    case "listings": data = await t.search_property_listings(client, p[0]!); break;
    case "comparables": data = await t.get_comparables(client, p[0]!, Number(args.flags["count"] ?? 20)); break;
    case "live-listings": data = await t.search_live_listings(client, { postcode: str("postcode"), min_price: num("min_price"), max_price: num("max_price"), min_bedrooms: num("min_bedrooms"), transaction_type: str("type") as ("Sale" | "Rental" | undefined) }); break;
    // Address
    case "search": data = await t.search_address(client, p[0]!, str("postcode")); break;
    case "addresses": data = await t.get_addresses_at_postcode(client, p[0]!); break;
    // Local / area
    case "planning": data = await t.get_planning_applications(client, p[0]!); break;
    case "schools": data = await t.get_schools(client, p[0]!, num("radius") ?? 3, str("phase"), str("ofsted")); break;
    case "transport": data = await t.get_transport(client, p[0]!, num("radius") ?? 1); break;
    case "crime": data = await t.get_crime(client, p[0]!, str("date"), str("category")); break;
    case "demographics": data = await t.get_demographics(client, p[0]!); break;
    case "deprivation": data = await t.get_deprivation(client, p[0]!); break;
    case "broadband": data = await t.get_broadband(client, p[0]!); break;
    case "postcode": data = await t.get_postcode_profile(client, p[0]!); break;
    case "conservation-areas": data = await t.get_conservation_areas(client, p[0]!, num("radius")); break;
    case "listed-buildings": data = await t.get_listed_buildings(client, p[0]!, num("radius"), str("grade")); break;
    case "planning-designations": data = await t.get_planning_designations(client, p[0]!, num("radius"), str("type")); break;
    // Amenities / POIs (uprn positional)
    case "amenities": data = await t.get_amenities(client, { uprn: p[0]!, radius_km: num("radius"), limit: num("limit") }); break;
    case "fuel": data = await t.get_fuel_stations(client, { uprn: p[0]!, radius_km: num("radius"), limit: num("limit") }); break;
    case "healthcare": data = await t.get_healthcare(client, { uprn: p[0]!, radius_km: num("radius"), limit: num("limit") }); break;
    // Environment / risk
    case "flood": data = await t.lookup_flood_risk(client, p[0]!); break;
    case "risks": data = await t.get_risks(client, (str("type") ?? "all") as t.RiskType, p[0]!); break;
    case "energy": data = await t.get_energy(client, { uprn: p[0]!, radius_m: num("radius_m") }); break;
    case "brownfield": data = await t.get_brownfield(client, { uprn: p[0]!, radius_m: num("radius_m") }); break;
    case "boreholes": data = await t.get_boreholes(client, { uprn: p[0]!, radius_m: num("radius_m") }); break;
    case "environment-report": data = await t.get_environment_report(client, { uprn: p[0]! }); break;
    case "rights-of-way": data = await t.get_rights_of_way(client, { uprn: p[0]!, radius_m: num("radius_m") }); break;
    case "solar": data = await t.get_solar_assessment(client, p[0]!); break;
    // Pricing trends (outcode)
    case "price-trends": data = await t.get_price_trends(client, p[0]!); break;
    case "price-distribution": data = await t.get_price_distribution(client, p[0]!); break;
    case "price-growth": data = await t.get_price_growth(client, p[0]!); break;
    // Agents
    case "agent-stats": data = await t.get_agent_stats(client, p[0]!); break;
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
