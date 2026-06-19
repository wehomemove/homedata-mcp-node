#!/usr/bin/env node
/**
 * MCP server entry point.
 *
 * Wires the Homedata tools into the official @modelcontextprotocol/sdk
 * server, communicates over stdio with the host AI client (Claude Desktop,
 * Cursor, Codex, Cline, Continue.dev, Windsurf, Zed, etc.).
 *
 * Auth: reads HOMEDATA_API_KEY from the environment. The MCP runs locally
 * on the user's machine — their property-data queries never go through
 * the AI vendor.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { HomedataClient, HomedataError } from "./client.js";
import * as t from "./tools.js";
import { VERSION } from "./index.js";

// ── Schemas ───────────────────────────────────────────────────────────────────

const uprnSchema = z.object({ uprn: z.string().describe("UPRN (Unique Property Reference Number)") });
const postcodeSchema = z.object({ postcode: z.string().describe("UK postcode, e.g. 'SW1A 2AA'") });
const outcodeSchema = z.object({ outcode: z.string().describe("Postcode outcode, e.g. 'SW11'") });

const comparablesSchema = z.object({
  uprn: z.string(),
  count: z.number().int().min(1).max(200).default(20),
});
const crimeSchema = z.object({
  postcode: z.string(),
  date: z.string().optional().describe("Optional YYYY-MM month filter."),
  category: z.string().optional().describe("Optional crime category, default all-crime."),
});
const searchSchema = z.object({
  query: z.string().describe("Address fragment, e.g. '10 downing street'"),
  postcode: z.string().optional(),
});
const batchSchema = z.object({ uprns: z.array(z.string()).min(1).max(50) });
const customSchema = z.object({
  uprn: z.string(),
  slugs: z.array(z.string()).min(1).describe("Add-on slugs, e.g. ['epc','council_tax','broadband']"),
});
const tierSchema = z.object({
  uprn: z.string().describe("UPRN, or an address token returned by search_address"),
  tier: z.enum(["address", "base", "core", "complete"]).default("base")
    .describe("Detail tier — strict supersets: address ⊂ base ⊂ core ⊂ complete"),
});
const valuationSchema = z.object({
  uprn: z.string(),
  type: z.enum(["sale", "rent"]).default("sale").describe("sale = estimated market value; rent = estimated monthly rent"),
  bedrooms: z.number().int().min(0).optional().describe("Override bedrooms (else uses the property record)"),
  property_type: z.string().optional().describe("Override property type (else uses the property record)"),
});
const schoolsSchema = z.object({
  uprn: z.string(),
  radius_km: z.number().min(0.1).max(10).default(3).optional(),
  phase: z.enum(["Primary", "Secondary", "All-through", "Nursery", "16 plus"]).optional(),
  ofsted: z.enum(["Outstanding", "Good", "Requires Improvement", "Inadequate"]).optional(),
});
const transportSchema = z.object({
  postcode: z.string(),
  radius_km: z.number().min(0.1).max(5).default(1).optional(),
});
const riskSchema = z.object({
  risk_type: z.enum(["noise", "flood", "radon", "landfill", "coal_mining", "invasive_plants", "air_quality_today", "all"]),
  uprn: z.string(),
});
const conservationSchema = z.object({ postcode: z.string(), radius_km: z.number().optional(), limit: z.number().int().optional() });
const listedSchema = z.object({ postcode: z.string(), radius_km: z.number().optional(), grade: z.enum(["I", "II*", "II"]).optional(), limit: z.number().int().optional() });
const designationsSchema = z.object({ postcode: z.string(), radius_km: z.number().optional(), type: z.string().optional(), limit: z.number().int().optional() });

// uprn OR lat+lng anchored POI search
const nearbySchema = z.object({
  uprn: z.string().optional().describe("Anchor by UPRN…"),
  lat: z.number().optional().describe("…or by lat+lng"),
  lng: z.number().optional(),
  radius_km: z.number().optional(),
  limit: z.number().int().optional(),
  include_tags: z.boolean().optional(),
});
// uprn/title_no/lat+lng anchored geospatial layers
const geoSchema = z.object({
  uprn: z.string().optional(),
  title_no: z.string().optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
  radius_m: z.number().int().optional(),
});
const brownfieldSchema = z.object({
  uprn: z.string().optional(),
  title_no: z.string().optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
  radius_m: z.number().int().optional(),
  include_historic: z.boolean().optional(),
});
const liveListingsSchema = z.object({
  uprn: z.string().optional(),
  transaction_type: z.enum(["Sale", "Rental"]).optional(),
  min_bedrooms: z.number().int().optional(),
  max_bedrooms: z.number().int().optional(),
  min_price: z.number().int().optional(),
  max_price: z.number().int().optional(),
  property_type: z.string().optional().describe("Comma-separated, e.g. 'Detached,Flat'"),
  postcode: z.string().optional().describe("Comma-separated outcodes/postcodes"),
  new_builds_only: z.boolean().optional(),
  reduced_only: z.boolean().optional(),
  min_epc_band: z.string().optional(),
  max_epc_band: z.string().optional(),
  has_garden: z.boolean().optional(),
  has_parking: z.boolean().optional(),
  page: z.number().int().optional(),
  page_size: z.number().int().max(200).optional(),
  sort: z.string().optional().describe("added_date | -added_date | latest_price | -latest_price"),
});

const TOOL_DEFS = [
  // Property
  { name: "lookup_property", description: "Look up a UK property by UPRN at the 'base' tier — property type, EPC summary, last sold price, core attributes. For other detail levels use get_property_tier.", schema: uprnSchema },
  { name: "get_property_tier", description: "Full property data at a chosen detail tier (address/base/core/complete) by UPRN. Strict supersets — 'complete' contains everything in 'core', etc.", schema: tierSchema },
  { name: "discover_property", description: "Discovery menu for a UPRN — which add-on slugs/tiers are available and each one's cost. Call BEFORE picking a tier so you don't pay for data the property lacks.", schema: uprnSchema },
  { name: "get_property_custom", description: "Custom à-la-carte property bundle — only the add-on slugs you request.", schema: customSchema },
  { name: "batch_property_lookup", description: "Look up multiple UPRNs in one request (max 50).", schema: batchSchema },
  // EPC / council tax
  { name: "lookup_epc", description: "Energy Performance Certificate for a UPRN — current/potential ratings, floor area, fuel type.", schema: uprnSchema },
  { name: "lookup_council_tax", description: "Council tax for a UPRN — band, annual charges, and billing authority.", schema: uprnSchema },
  { name: "lookup_council_tax_band", description: "Council tax band for a UPRN (band only — cheaper than full council tax).", schema: uprnSchema },
  // Valuation
  { name: "estimate_valuation", description: "AVM estimate of a property's sale price or monthly rent by UPRN. Optionally override bedrooms / property_type.", schema: valuationSchema },
  { name: "get_avm_comparables", description: "The comparable-property evidence set behind a UPRN's automated valuation.", schema: comparablesSchema },
  // Sales / listings
  { name: "get_property_sales", description: "Transaction timeline for a UPRN (listings + sale events).", schema: uprnSchema },
  { name: "get_lr_sales", description: "HM Land Registry price-paid sales for a UPRN.", schema: uprnSchema },
  { name: "search_property_listings", description: "Past and current listings (sales and rentals) for a UPRN.", schema: uprnSchema },
  { name: "get_comparables", description: "The N nearest comparable properties to a UPRN by geographic proximity.", schema: comparablesSchema },
  { name: "search_live_listings", description: "Search the live listings market with filters (location, price, beds, EPC, features). Returns matching on-market properties.", schema: liveListingsSchema },
  // Address
  { name: "search_address", description: "Search for an address by free text (autocomplete).", schema: searchSchema },
  { name: "get_addresses_at_postcode", description: "All addresses at a given postcode.", schema: postcodeSchema },
  // Local / area
  { name: "get_planning_applications", description: "Planning applications near a UPRN.", schema: uprnSchema },
  { name: "get_schools", description: "Schools near a UPRN, optionally filtered by phase and Ofsted rating.", schema: schoolsSchema },
  { name: "get_transport", description: "Transport stops (rail, tube, bus) near a postcode.", schema: transportSchema },
  { name: "get_crime", description: "Recorded crime in the area of the given postcode.", schema: crimeSchema },
  { name: "get_demographics", description: "ONS Census 2021 demographic profile for a postcode.", schema: postcodeSchema },
  { name: "get_deprivation", description: "Index of Multiple Deprivation (IMD) for a postcode.", schema: postcodeSchema },
  { name: "get_broadband", description: "Ofcom broadband availability/speeds for a postcode.", schema: postcodeSchema },
  { name: "get_postcode_profile", description: "Aggregated area profile for a postcode — deprivation, broadband, sold prices, schools, transport.", schema: postcodeSchema },
  { name: "get_conservation_areas", description: "Conservation areas near a postcode.", schema: conservationSchema },
  { name: "get_listed_buildings", description: "Listed buildings near a postcode, optionally by grade (I/II*/II).", schema: listedSchema },
  { name: "get_planning_designations", description: "Planning/landscape designations near a postcode (AONB, green belt, national park, SSSI…).", schema: designationsSchema },
  // Amenities / POIs
  { name: "get_amenities", description: "Nearby amenities (food, education, healthcare, shops, green spaces…) anchored by UPRN or lat+lng.", schema: nearbySchema },
  { name: "get_fuel_stations", description: "Nearby fuel stations (petrol + EV charging) anchored by UPRN or lat+lng.", schema: nearbySchema },
  { name: "get_healthcare", description: "Nearby healthcare (GPs, dentists, pharmacies, hospitals) anchored by UPRN or lat+lng.", schema: nearbySchema },
  // Environment / risk
  { name: "lookup_flood_risk", description: "NaFRA2 flood risk for a UPRN.", schema: uprnSchema },
  { name: "get_risks", description: "Environmental risk of a given type (noise/flood/radon/landfill/coal_mining/invasive_plants/air_quality_today/all) for a UPRN.", schema: riskSchema },
  { name: "get_energy", description: "Energy infrastructure (pylons, substations, generation) near a UPRN/title or lat+lng.", schema: geoSchema },
  { name: "get_brownfield", description: "Brownfield land near a UPRN/title or lat+lng.", schema: brownfieldSchema },
  { name: "get_boreholes", description: "Geological boreholes near a UPRN or lat+lng.", schema: geoSchema },
  { name: "get_environment_report", description: "Combined environmental report for a UPRN/title or lat+lng.", schema: geoSchema },
  { name: "get_rights_of_way", description: "Public rights of way near a UPRN or lat+lng (flags any crossing the property).", schema: geoSchema },
  { name: "get_solar_assessment", description: "Solar/PV generation assessment for a UPRN.", schema: uprnSchema },
  // Pricing trends (outcode)
  { name: "get_price_trends", description: "Price-trend time series for a postcode outcode.", schema: outcodeSchema },
  { name: "get_price_distribution", description: "Price distribution for a postcode outcode.", schema: outcodeSchema },
  { name: "get_price_growth", description: "Year-on-year price growth for a postcode outcode.", schema: outcodeSchema },
  // Agents
  { name: "get_agent_stats", description: "Estate-agent performance stats for the area of a UPRN.", schema: uprnSchema },
] as const;

async function main(): Promise<void> {
  let client: HomedataClient;
  try {
    client = HomedataClient.fromEnv(VERSION);
  } catch (err) {
    if (err instanceof HomedataError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }

  const server = new Server(
    { name: "homedata", version: VERSION },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOL_DEFS.map((d) => ({
      name: d.name,
      description: d.description,
      inputSchema: zodToJsonSchema(d.schema),
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const args = req.params.arguments ?? {};
    const result = await dispatch(req.params.name, args, client);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

const numOpt = (v: unknown): number | undefined => (v === undefined || v === null ? undefined : Number(v));
const strOpt = (v: unknown): string | undefined => (v === undefined || v === null ? undefined : String(v));
const boolOpt = (v: unknown): boolean | undefined => (v === undefined || v === null ? undefined : Boolean(v));

async function dispatch(
  name: string,
  args: Record<string, unknown>,
  c: HomedataClient,
): Promise<unknown> {
  switch (name) {
    // Property
    case "lookup_property": return t.lookup_property(c, String(args.uprn));
    case "get_property_tier": return t.get_property_tier(c, String(args.uprn), (args.tier ? String(args.tier) : "base") as t.PropertyTier);
    case "discover_property": return t.discover_property(c, String(args.uprn));
    case "get_property_custom": return t.get_property_custom(c, String(args.uprn), (args.slugs as string[]) ?? []);
    case "batch_property_lookup": return t.batch_property_lookup(c, (args.uprns as string[]) ?? []);
    // EPC / council tax
    case "lookup_epc": return t.lookup_epc(c, String(args.uprn));
    case "lookup_council_tax": return t.lookup_council_tax(c, String(args.uprn));
    case "lookup_council_tax_band": return t.lookup_council_tax_band(c, String(args.uprn));
    // Valuation
    case "estimate_valuation": return t.estimate_valuation(c, String(args.uprn), (args.type ? String(args.type) : "sale") as "sale" | "rent", numOpt(args.bedrooms), strOpt(args.property_type));
    case "get_avm_comparables": return t.get_avm_comparables(c, String(args.uprn), Number(args.count ?? 20));
    // Sales / listings
    case "get_property_sales": return t.get_property_sales(c, String(args.uprn));
    case "get_lr_sales": return t.get_lr_sales(c, String(args.uprn));
    case "search_property_listings": return t.search_property_listings(c, String(args.uprn));
    case "get_comparables": return t.get_comparables(c, String(args.uprn), Number(args.count ?? 20));
    case "search_live_listings": return t.search_live_listings(c, args as t.LiveListingFilters);
    // Address
    case "search_address": return t.search_address(c, String(args.query), strOpt(args.postcode));
    case "get_addresses_at_postcode": return t.get_addresses_at_postcode(c, String(args.postcode));
    // Local / area
    case "get_planning_applications": return t.get_planning_applications(c, String(args.uprn));
    case "get_schools": return t.get_schools(c, String(args.uprn), Number(args.radius_km ?? 3), strOpt(args.phase), strOpt(args.ofsted));
    case "get_transport": return t.get_transport(c, String(args.postcode), Number(args.radius_km ?? 1));
    case "get_crime": return t.get_crime(c, String(args.postcode), strOpt(args.date), strOpt(args.category));
    case "get_demographics": return t.get_demographics(c, String(args.postcode));
    case "get_deprivation": return t.get_deprivation(c, String(args.postcode));
    case "get_broadband": return t.get_broadband(c, String(args.postcode));
    case "get_postcode_profile": return t.get_postcode_profile(c, String(args.postcode));
    case "get_conservation_areas": return t.get_conservation_areas(c, String(args.postcode), numOpt(args.radius_km), numOpt(args.limit));
    case "get_listed_buildings": return t.get_listed_buildings(c, String(args.postcode), numOpt(args.radius_km), strOpt(args.grade), numOpt(args.limit));
    case "get_planning_designations": return t.get_planning_designations(c, String(args.postcode), numOpt(args.radius_km), strOpt(args.type), numOpt(args.limit));
    // Amenities / POIs
    case "get_amenities": return t.get_amenities(c, { uprn: strOpt(args.uprn), lat: numOpt(args.lat), lng: numOpt(args.lng), radius_km: numOpt(args.radius_km), limit: numOpt(args.limit), include_tags: boolOpt(args.include_tags) });
    case "get_fuel_stations": return t.get_fuel_stations(c, { uprn: strOpt(args.uprn), lat: numOpt(args.lat), lng: numOpt(args.lng), radius_km: numOpt(args.radius_km), limit: numOpt(args.limit), include_tags: boolOpt(args.include_tags) });
    case "get_healthcare": return t.get_healthcare(c, { uprn: strOpt(args.uprn), lat: numOpt(args.lat), lng: numOpt(args.lng), radius_km: numOpt(args.radius_km), limit: numOpt(args.limit) });
    // Environment / risk
    case "lookup_flood_risk": return t.lookup_flood_risk(c, String(args.uprn));
    case "get_risks": return t.get_risks(c, String(args.risk_type) as t.RiskType, String(args.uprn));
    case "get_energy": return t.get_energy(c, { uprn: strOpt(args.uprn), title_no: strOpt(args.title_no), lat: numOpt(args.lat), lng: numOpt(args.lng), radius_m: numOpt(args.radius_m) });
    case "get_brownfield": return t.get_brownfield(c, { uprn: strOpt(args.uprn), title_no: strOpt(args.title_no), lat: numOpt(args.lat), lng: numOpt(args.lng), radius_m: numOpt(args.radius_m), include_historic: boolOpt(args.include_historic) });
    case "get_boreholes": return t.get_boreholes(c, { uprn: strOpt(args.uprn), lat: numOpt(args.lat), lng: numOpt(args.lng), radius_m: numOpt(args.radius_m) });
    case "get_environment_report": return t.get_environment_report(c, { uprn: strOpt(args.uprn), title_no: strOpt(args.title_no), lat: numOpt(args.lat), lng: numOpt(args.lng) });
    case "get_rights_of_way": return t.get_rights_of_way(c, { uprn: strOpt(args.uprn), lat: numOpt(args.lat), lng: numOpt(args.lng), radius_m: numOpt(args.radius_m) });
    case "get_solar_assessment": return t.get_solar_assessment(c, String(args.uprn));
    // Pricing trends
    case "get_price_trends": return t.get_price_trends(c, String(args.outcode));
    case "get_price_distribution": return t.get_price_distribution(c, String(args.outcode));
    case "get_price_growth": return t.get_price_growth(c, String(args.outcode));
    // Agents
    case "get_agent_stats": return t.get_agent_stats(c, String(args.uprn));
    default: return { error: "unknown_tool", detail: name };
  }
}

// Minimal Zod → JSON Schema converter — sufficient for our flat objects.
function zodToJsonSchema(s: z.ZodTypeAny): Record<string, unknown> {
  if (s instanceof z.ZodObject) {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const [key, value] of Object.entries(s.shape as Record<string, z.ZodTypeAny>)) {
      properties[key] = zodLeaf(value);
      if (!(value instanceof z.ZodOptional) && !(value instanceof z.ZodDefault)) {
        required.push(key);
      }
    }
    return { type: "object", properties, ...(required.length ? { required } : {}) };
  }
  return zodLeaf(s);
}

function zodLeaf(s: z.ZodTypeAny): Record<string, unknown> {
  const desc = (s as { description?: string }).description;
  const meta = desc ? { description: desc } : {};
  // Unwrap optional/default, but keep the outer description.
  if (s instanceof z.ZodOptional || s instanceof z.ZodDefault) {
    return { ...zodLeaf((s as unknown as { _def: { innerType: z.ZodTypeAny } })._def.innerType), ...meta };
  }
  if (s instanceof z.ZodEnum) return { type: "string", enum: (s as z.ZodEnum<[string, ...string[]]>).options, ...meta };
  if (s instanceof z.ZodString) return { type: "string", ...meta };
  if (s instanceof z.ZodNumber) return { type: "number", ...meta };
  if (s instanceof z.ZodBoolean) return { type: "boolean", ...meta };
  if (s instanceof z.ZodArray) return { type: "array", items: zodLeaf(s.element), ...meta };
  return meta;
}

main().catch((err) => {
  console.error("[homedata-mcp] fatal:", err);
  process.exit(1);
});
