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

const uprnSchema = z.object({ uprn: z.string().describe("UPRN (Unique Property Reference Number)") });
const postcodeSchema = z.object({ postcode: z.string().describe("UK postcode, e.g. 'SW1A 2AA'") });
const uprnRadiusSchema = z.object({
  uprn: z.string(),
  radius_m: z.number().int().min(100).max(10_000).optional(),
});
const comparablesSchema = z.object({
  uprn: z.string(),
  count: z.number().int().min(1).max(200).default(20),
});
const crimeSchema = z.object({
  postcode: z.string(),
  date: z.string().optional().describe("Optional YYYY-MM month filter."),
});
const searchSchema = z.object({
  query: z.string().describe("Address fragment, e.g. '10 downing street'"),
  postcode: z.string().optional(),
});
const batchSchema = z.object({
  uprns: z.array(z.string()).min(1).max(50),
});

const TOOL_DEFS = [
  { name: "lookup_property", description: "Look up a UK property by UPRN. Returns property type, EPC summary, last sold price, and core attributes.", schema: uprnSchema },
  { name: "lookup_epc", description: "Get the Energy Performance Certificate for a UPRN — current and potential ratings, floor area, fuel type.", schema: uprnSchema },
  { name: "lookup_flood_risk", description: "Get flood risk assessment for a UPRN.", schema: uprnSchema },
  { name: "get_property_sales", description: "Historical sales for a UPRN (HM Land Registry).", schema: uprnSchema },
  { name: "search_property_listings", description: "Past and current listings (sales and rentals) for a UPRN.", schema: uprnSchema },
  { name: "get_comparables", description: "The N nearest comparable properties to a UPRN by geographic proximity.", schema: comparablesSchema },
  { name: "get_planning_applications", description: "Planning applications near a UPRN.", schema: uprnSchema },
  { name: "get_schools", description: "Schools near a UPRN within the given radius.", schema: uprnRadiusSchema },
  { name: "get_transport", description: "Transport (rail, tube, bus) near a UPRN.", schema: uprnRadiusSchema },
  { name: "get_crime", description: "Recorded crime in the area of the given postcode.", schema: crimeSchema },
  { name: "get_demographics", description: "ONS Census 2021 demographic profile for the given postcode.", schema: postcodeSchema },
  { name: "get_broadband", description: "Ofcom broadband availability for the given postcode.", schema: postcodeSchema },
  { name: "get_postcode_profile", description: "Aggregated profile for a postcode — demographics, broadband, schools, transport, crime.", schema: postcodeSchema },
  { name: "search_address", description: "Search for an address by free text.", schema: searchSchema },
  { name: "batch_property_lookup", description: "Look up multiple UPRNs in one request (max 50).", schema: batchSchema },
  { name: "lookup_council_tax", description: "Council tax band for a UPRN (in development — currently returns a 503 stub).", schema: uprnSchema },
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
    tools: TOOL_DEFS.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: zodToJsonSchema(t.schema),
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const args = req.params.arguments ?? {};
    const result = await dispatch(req.params.name, args, client);
    return {
      content: [{ type: "text", text: JSON.stringify(result) }],
    };
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

async function dispatch(
  name: string,
  args: Record<string, unknown>,
  c: HomedataClient,
): Promise<unknown> {
  switch (name) {
    case "lookup_property": return t.lookup_property(c, String(args.uprn));
    case "lookup_epc": return t.lookup_epc(c, String(args.uprn));
    case "lookup_flood_risk": return t.lookup_flood_risk(c, String(args.uprn));
    case "get_property_sales": return t.get_property_sales(c, String(args.uprn));
    case "search_property_listings": return t.search_property_listings(c, String(args.uprn));
    case "get_comparables": return t.get_comparables(c, String(args.uprn), Number(args.count ?? 20));
    case "get_planning_applications": return t.get_planning_applications(c, String(args.uprn));
    case "get_schools": return t.get_schools(c, String(args.uprn), Number(args.radius_m ?? 1000));
    case "get_transport": return t.get_transport(c, String(args.uprn), Number(args.radius_m ?? 800));
    case "get_crime": return t.get_crime(c, String(args.postcode), args.date ? String(args.date) : undefined);
    case "get_demographics": return t.get_demographics(c, String(args.postcode));
    case "get_broadband": return t.get_broadband(c, String(args.postcode));
    case "get_postcode_profile": return t.get_postcode_profile(c, String(args.postcode));
    case "search_address": return t.search_address(c, String(args.query), args.postcode ? String(args.postcode) : undefined);
    case "batch_property_lookup": return t.batch_property_lookup(c, (args.uprns as string[]) ?? []);
    case "lookup_council_tax": return t.lookup_council_tax(c, String(args.uprn));
    default: return { error: "unknown_tool", detail: name };
  }
}

// Minimal Zod → JSON Schema converter — sufficient for our flat objects.
// We could pull in zod-to-json-schema if our shapes get more complex.
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
  if (s instanceof z.ZodOptional || s instanceof z.ZodDefault) return zodLeaf((s as unknown as { _def: { innerType: z.ZodTypeAny } })._def.innerType);
  if (s instanceof z.ZodString) return { type: "string", ...meta };
  if (s instanceof z.ZodNumber) return { type: "number", ...meta };
  if (s instanceof z.ZodArray) return { type: "array", items: zodLeaf(s.element), ...meta };
  return meta;
}

main().catch((err) => {
  console.error("[homedata-mcp] fatal:", err);
  process.exit(1);
});
