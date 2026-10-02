import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";

import { VERSION } from "../index.js";
import { HomeClient, HomeError, HomeUpstreamError, type SearchArgs, type SoldArgs } from "./client.js";
import { HOME_WIDGET_HTML, HOME_WIDGET_URI } from "./widget.js";

type Schema = Record<string, unknown>;
type Tool = { name: string; title: string; description: string; inputSchema: Schema; outputSchema?: Schema; _meta?: Record<string, unknown> };
const obj = (properties: Schema, required: string[] = []): Schema => ({
  type: "object", properties, additionalProperties: false, ...(required.length ? { required } : {}),
});
const number = (description: string, minimum = 0): Schema => ({ type: "number", minimum, description });
const string = (description: string, values?: string[]): Schema => ({ type: "string", description, ...(values ? { enum: values } : {}) });

export const HOME_INSTRUCTIONS = [
  "Home helps people buying, renting, selling or letting homes across the United Kingdom using home.co.uk.",
  "Start with search_homes. Keep the listing IDs it returns: get_home gives every photo, the full description, agent and Homedata checks; compare_homes gives the same depth side by side.",
  "After choosing search results, call render_home_listings with those home objects to show cards and a map. Call render_home_detail with the get_home result to show its gallery and key facts. A refinement can pass a subset of the homes already returned to render_home_listings without searching again.",
  "Use area_insights for schools, broadband, recorded crime, deprivation and local price growth. Use the two calculators only when the user supplies their assumptions.",
  "Property enrichment is labelled with scope home. When no UPRN can be found, enrichment labelled with scope area contains postcode-level facts only: never present those as facts about the home.",
  "For sellers and landlords: sold_prices shows what nearby homes actually sold for and when, find_agents ranks local agents by the homes they are selling or letting in the area, and typical_rents gives current asking rents. Sold prices are evidence about other homes, never a valuation of the user's home.",
  "Never invent availability, safety, mortgage eligibility or future prices. Dates and status are snapshots and should be described as such.",
].join(" ");

export const HOME_TOOLS: readonly Tool[] = [
  {
    name: "search_homes", title: "Search homes",
    description: "Search current UK homes for sale or to rent by location, price, bedrooms, property type, new-build status and market signals. Can find homes reduced within the last N days, on the market for at least N days, or newly added within the last N days. Market-signal searches check up to three source pages and clearly say when further results were not checked. Returns compact cards with time on market, reduction and under-offer dates. Use this when someone wants to find homes or refine a previous property search.",
    inputSchema: obj({
      location: string("Town, city, county or UK postcode."),
      listing_type: string("Whether the user wants to buy or rent.", ["sale", "rent"]),
      min_price: number("Minimum asking price in pounds."), max_price: number("Maximum asking price in pounds."),
      min_beds: number("Minimum bedrooms.", 0), max_beds: number("Maximum bedrooms.", 0),
      property_type: string("Optional property type.", ["detached", "semi_detached", "terraced", "flat"]),
      new_build: { type: "boolean", description: "True to return new-build homes only." },
      reduced_within_days: { type: "integer", minimum: 1, description: "Only return homes with a recorded price reduction in the last N days." },
      on_market_at_least_days: { type: "integer", minimum: 1, description: "Only return homes that have been listed for at least N days." },
      new_within_days: { type: "integer", minimum: 1, description: "Only return homes first added in the last N days." },
      sort: string("Result order.", ["newest", "oldest", "price_asc", "price_desc"]),
      page: { type: "integer", minimum: 1, maximum: 100, description: "Source results page, starting at 1. For a market-signal search with results_limited true, repeat the same search using its next_page value to continue without gaps or duplicates." },
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
    name: "sold_prices", title: "Recent sold prices nearby",
    description: "List what homes near a UK postcode actually sold for, with sale dates, property type and bedrooms, from recorded sale prices on home.co.uk. A full postcode covers its postcode sector; a district such as BA1 covers the district. Use this when someone selling, buying or remortgaging asks what nearby or similar homes sold for. Present the results as past sales of other homes, never as a valuation or estimate of the user's home.",
    inputSchema: obj({
      postcode: string("A full UK postcode (for the street or address in question) or a postcode district such as BA1."),
      months: { type: "integer", enum: [6, 12, 24], description: "How far back to look, in months. Defaults to 12." },
      property_type: string("Optional property type.", ["detached", "semi_detached", "terraced", "flat"]),
      min_price: number("Minimum sale price in pounds."), max_price: number("Maximum sale price in pounds."),
      sort: string("Result order. Defaults to newest.", ["newest", "oldest", "price_asc", "price_desc"]),
      page: { type: "integer", minimum: 1, maximum: 100, description: "Results page of 20 sales, starting at 1." },
    }, ["postcode"]),
  },
  {
    name: "find_agents", title: "Find local agents",
    description: "Rank the estate agents or letting agents in a UK town or postcode area by how many homes each is currently selling or letting there on home.co.uk, with office and profile links. Use this when someone selling or letting a home asks which agents are active locally. Report the listing counts as evidence of local activity, not as a recommendation or a measure of quality.",
    inputSchema: obj({
      location: string("Town, city or UK postcode."),
      agent_type: string("sales for agents selling homes, lettings for agents letting homes.", ["sales", "lettings"]),
      limit: { type: "integer", minimum: 1, maximum: 20, description: "How many agents to return. Defaults to 10." },
    }, ["location", "agent_type"]),
  },
  {
    name: "typical_rents", title: "Typical rents",
    description: "Get typical asking rents per calendar month for a UK postcode district or town from home.co.uk's rental price data: median and average rent, the usual range, and rents by bedrooms and property type. Use this when someone renting or letting asks what rent to expect or charge in an area. Describe the figures as asking rents of homes currently advertised, not agreed rents.",
    inputSchema: obj({ location: string("A UK postcode, postcode district such as BA1, or town.") }, ["location"]),
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
  {
    name: "render_home_listings", title: "Show home cards and map",
    description: "Render home objects already returned by search_homes as a photo-card carousel and a map. Always call search_homes first, choose or refine its results, then pass those home objects here. For a follow-up refinement, re-render the earlier homes without searching again when they contain enough information.",
    inputSchema: obj({
      title: string("A short heading that describes this chosen set of homes."),
      homes: { type: "array", minItems: 1, maxItems: 20, items: { type: "object", additionalProperties: true }, description: "One to twenty complete home card objects returned by search_homes." },
    }, ["homes"]),
    outputSchema: obj({
      view: { type: "string", const: "listings" }, title: { type: "string" },
      homes: { type: "array", minItems: 1, maxItems: 20, items: { type: "object", additionalProperties: true } },
    }, ["view", "title", "homes"]),
    _meta: { ui: { resourceUri: HOME_WIDGET_URI }, "openai/outputTemplate": HOME_WIDGET_URI, "openai/toolInvocation/invoking": "Drawing homes…", "openai/toolInvocation/invoked": "Homes ready" },
  },
  {
    name: "render_home_detail", title: "Show home detail",
    description: "Render one complete home object as a photo gallery with key facts. Always call get_home first and pass its complete result here; this tool does not fetch listing data.",
    inputSchema: obj({ home: { type: "object", additionalProperties: true, description: "The complete home object returned by get_home." } }, ["home"]),
    outputSchema: obj({ view: { type: "string", const: "detail" }, home: { type: "object", additionalProperties: true } }, ["view", "home"]),
    _meta: { ui: { resourceUri: HOME_WIDGET_URI }, "openai/outputTemplate": HOME_WIDGET_URI, "openai/toolInvocation/invoking": "Opening home…", "openai/toolInvocation/invoked": "Home ready" },
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

function renderListings(args: Record<string, unknown>): CallToolResult {
  if (!Array.isArray(args["homes"]) || args["homes"].length < 1 || args["homes"].length > 20 || !args["homes"].every((home) => home !== null && typeof home === "object" && !Array.isArray(home))) {
    throw new HomeError("homes must contain one to twenty home objects returned by search_homes");
  }
  const title = typeof args["title"] === "string" && args["title"].trim() ? args["title"].trim().slice(0, 120) : "Homes";
  return result({ view: "listings", title, homes: args["homes"] });
}

function renderDetail(args: Record<string, unknown>): CallToolResult {
  const home = args["home"];
  if (home === null || typeof home !== "object" || Array.isArray(home)) throw new HomeError("home must be the complete object returned by get_home");
  return result({ view: "detail", home });
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
  const server = new Server({ name: "home", version: VERSION }, { capabilities: { tools: {}, resources: {} }, instructions: HOME_INSTRUCTIONS });
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [{ uri: HOME_WIDGET_URI, name: "Home listings and detail", description: "Responsive listing carousel, map and home gallery.", mimeType: "text/html;profile=mcp-app" }],
  }));
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    if (request.params.uri !== HOME_WIDGET_URI) throw new Error("Unknown Home UI resource");
    const csp = {
      connectDomains: [],
      resourceDomains: ["https://home.co.uk", "https://cdn.home.co.uk", "https://tile.openstreetmap.org"],
    };
    return { contents: [{
      uri: HOME_WIDGET_URI,
      mimeType: "text/html;profile=mcp-app",
      text: HOME_WIDGET_HTML,
      _meta: {
        ui: { prefersBorder: false, domain: "https://mcp.home.co.uk", csp },
        "openai/widgetDescription": "A responsive carousel and map for chosen homes, or a photo gallery and facts for one home.",
        "openai/widgetPrefersBorder": false,
        "openai/widgetDomain": "https://mcp.home.co.uk",
        "openai/widgetCSP": { connect_domains: [], resource_domains: csp.resourceDomains, redirect_domains: ["https://home.co.uk"] },
        "openai/ui": { availableDisplayModes: ["inline", "fullscreen"] },
      },
    }] };
  });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: HOME_TOOLS.map((tool) => ({ ...tool, outputSchema: tool.outputSchema ?? { type: "object", additionalProperties: true }, ...metadata, _meta: { ...metadata._meta, ...tool._meta } })),
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
        case "sold_prices": return result(await client.soldPrices(args as SoldArgs));
        case "find_agents": {
          const limit = args["limit"] === undefined ? 10 : args["limit"];
          if (typeof limit !== "number") throw new HomeError("limit must be a whole number from 1 to 20");
          return result(await client.agents(String(args["location"] ?? ""), String(args["agent_type"] ?? "") as "sales" | "lettings", limit));
        }
        case "typical_rents": return result(await client.rents(String(args["location"] ?? "")));
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
        case "render_home_listings": return renderListings(args);
        case "render_home_detail": return renderDetail(args);
        default: return result({ error: "unknown_tool", detail: request.params.name }, true);
      }
    } catch (error) {
      if (error instanceof HomeError) return result({ error: "invalid_request", detail: error.message }, true);
      if (error instanceof HomeUpstreamError) return result({ available: false, reason: "Not available right now." }, true);
      throw error;
    }
  });
  return server;
}
