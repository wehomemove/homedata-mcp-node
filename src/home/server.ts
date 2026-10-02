import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { VERSION } from "../index.js";
import { HomeClient, HomeError, HomeUpstreamError, type SearchArgs } from "./client.js";

type Schema = Record<string, unknown>;
type Tool = { name: string; title: string; description: string; inputSchema: Schema };
const obj = (properties: Schema, required: string[] = []): Schema => ({
  type: "object", properties, additionalProperties: false, ...(required.length ? { required } : {}),
});
const number = (description: string, minimum = 0): Schema => ({ type: "number", minimum, description });
const string = (description: string, values?: string[]): Schema => ({ type: "string", description, ...(values ? { enum: values } : {}) });

export const HOME_INSTRUCTIONS = [
  "Home searches homes for sale and to rent across the United Kingdom using home.co.uk.",
  "Start with search_homes. Keep the listing IDs it returns: get_home gives every photo, the full description, agent and Homedata checks; compare_homes gives the same depth side by side.",
  "Use area_insights for schools, broadband, recorded crime, deprivation and local price growth. Use the two calculators only when the user supplies their assumptions.",
  "Property enrichment is labelled with scope home. When no UPRN can be found, enrichment labelled with scope area contains postcode-level facts only: never present those as facts about the home.",
  "Never invent availability, safety, mortgage eligibility or future prices. Dates and status are snapshots and should be described as such.",
].join(" ");

export const HOME_TOOLS: readonly Tool[] = [
  {
    name: "search_homes", title: "Search homes",
    description: "Search current UK homes for sale or to rent by location, price, bedrooms, property type, new-build status, sort and page. Returns compact cards with time on market, reduction and under-offer dates. Use this when someone wants to find homes or refine a previous property search.",
    inputSchema: obj({
      location: string("Town, city, county or UK postcode."),
      listing_type: string("Whether the user wants to buy or rent.", ["sale", "rent"]),
      min_price: number("Minimum asking price in pounds."), max_price: number("Maximum asking price in pounds."),
      min_beds: number("Minimum bedrooms.", 0), max_beds: number("Maximum bedrooms.", 0),
      property_type: string("Optional property type.", ["detached", "semi_detached", "terraced", "flat"]),
      new_build: { type: "boolean", description: "True to return new-build homes only." },
      sort: string("Result order.", ["newest", "oldest", "price_asc", "price_desc"]),
      page: { type: "integer", minimum: 1, maximum: 100, description: "Results page, starting at 1." },
    }, ["location", "listing_type"]),
  },
  {
    name: "get_home", title: "Get one home",
    description: "Get one home in full: every available photo, complete description, agent, listing history and key facts, enriched through Homedata with EPC, council tax, flood and other risks, broadband, schools and crime. Use this after search_homes when someone asks about one result.",
    inputSchema: obj({ listing_id: string("The UUID returned by search_homes.") }, ["listing_id"]),
  },
  {
    name: "compare_homes", title: "Compare homes",
    description: "Get two to four homes with the same full listing detail and Homedata enrichment for a side-by-side comparison. Use this when someone is choosing between search results.",
    inputSchema: obj({ listing_ids: { type: "array", minItems: 2, maxItems: 4, uniqueItems: true, items: { type: "string" }, description: "Two to four UUIDs returned by search_homes." } }, ["listing_ids"]),
  },
  {
    name: "area_insights", title: "Area insights",
    description: "Bring together nearby schools, broadband coverage, recorded crime, deprivation and local house-price growth for one UK postcode. Use this when someone asks what an area is like or wants to compare locations. Report evidence rather than declaring an area safe or unsafe.",
    inputSchema: obj({ postcode: string("A full UK postcode.") }, ["postcode"]),
  },
  {
    name: "calculate_stamp_duty", title: "Calculate stamp duty",
    description: "Estimate Stamp Duty Land Tax for a purchase in England or Northern Ireland, including first-home and additional-property cases. Use this when someone asks what purchase tax they may pay; call it an estimate, not tax advice.",
    inputSchema: obj({ price: number("Purchase price in pounds.", 1), buyer_type: string("Buyer situation.", ["standard", "first_time", "additional"]) }, ["price", "buyer_type"]),
  },
  {
    name: "calculate_mortgage", title: "Calculate mortgage repayments",
    description: "Estimate monthly mortgage repayments from price, deposit, annual interest rate and term. Use this for affordability scenarios; do not present it as an offer or eligibility decision.",
    inputSchema: obj({ price: number("Purchase price in pounds.", 1), deposit: number("Deposit in pounds."), rate: number("Annual interest rate as a percentage."), term: number("Mortgage term in years.", 1) }, ["price", "deposit", "rate", "term"]),
  },
] as const;

const metadata = {
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  securitySchemes: [{ type: "noauth" }],
  _meta: { securitySchemes: [{ type: "noauth" }] },
};

function result(body: unknown, isError = false): CallToolResult {
  const structuredContent = body !== null && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : { data: body };
  return { content: [{ type: "text", text: JSON.stringify(body, null, 2) }], structuredContent, ...(isError ? { isError: true } : {}) };
}

function finite(args: Record<string, unknown>, name: string): number {
  const value = args[name];
  if (typeof value !== "number" || !Number.isFinite(value)) throw new HomeError(`${name} must be a finite number`);
  return value;
}

function positive(args: Record<string, unknown>, name: string, allowZero = false): number {
  const value = finite(args, name);
  if (value < (allowZero ? 0 : Number.EPSILON)) throw new HomeError(`${name} must be ${allowZero ? "zero or greater" : "greater than zero"}`);
  return value;
}

export function buildHomeServer(client: HomeClient): Server {
  const server = new Server({ name: "home", version: VERSION }, { capabilities: { tools: {} }, instructions: HOME_INSTRUCTIONS });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: HOME_TOOLS.map((tool) => ({ ...tool, outputSchema: { type: "object", additionalProperties: true }, ...metadata })),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const args = (request.params.arguments ?? {}) as Record<string, unknown>;
    try {
      switch (request.params.name) {
        case "search_homes": return result(await client.search(args as SearchArgs));
        case "get_home": return result(await client.home(String(args["listing_id"] ?? "")));
        case "compare_homes": {
          if (!Array.isArray(args["listing_ids"]) || args["listing_ids"].length < 2 || args["listing_ids"].length > 4 || !args["listing_ids"].every((v) => typeof v === "string")) throw new HomeError("listing_ids must contain two to four listing UUIDs");
          return result(await client.compare(args["listing_ids"] as string[]));
        }
        case "area_insights": return result(await client.area(String(args["postcode"] ?? "")));
        case "calculate_stamp_duty": {
          const buyer = String(args["buyer_type"] ?? "");
          if (!["standard", "first_time", "additional"].includes(buyer)) throw new HomeError("buyer_type must be standard, first_time or additional");
          return result(await client.calculator("stamp_duty", { price: String(positive(args, "price")), buyer_type: buyer }));
        }
        case "calculate_mortgage": {
          const price = positive(args, "price"); const deposit = positive(args, "deposit", true);
          if (deposit >= price) throw new HomeError("deposit must be less than price");
          return result(await client.calculator("mortgage", { price: String(price), deposit: String(deposit), rate: String(positive(args, "rate", true)), term: String(positive(args, "term")) }));
        }
        default: return result({ error: "unknown_tool", detail: request.params.name }, true);
      }
    } catch (error) {
      if (error instanceof HomeError) return result({ error: "invalid_request", detail: error.message }, true);
      if (error instanceof HomeUpstreamError) return result({ error: "upstream_unavailable", detail: error.message }, true);
      throw error;
    }
  });
  return server;
}
