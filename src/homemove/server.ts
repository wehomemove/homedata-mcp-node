import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";

import { VERSION } from "../index.js";
import type { MotusClient } from "./motus.js";
import type { PropertyLookup } from "./property.js";
import { PROPERTY_PRICE_KEY, bandLabel, questionFor, quote, type QuoteAnswer } from "./quote.js";
import { homemoveWidgetHtml, HOMEMOVE_WIDGET_URI, HOMEMOVE_WIDGET_VERSION } from "./widget.js";
import type { HomedataClient } from "../client.js";
import { planMove, type MovePlan, type Situation } from "./plan.js";
import { continueUrlForPlan, continueUrlForQuote } from "./handoff.js";

export const HOMEMOVE_INSTRUCTIONS = [
  "Homemove prices the services people need when they move home: surveys and valuations, EPCs and safety certificates, removals and man and van, end of tenancy and moving cleans, packing, and conveyancing.",
  "Whenever someone asks what any of these cost, call homemove_quote: it shows the price in a Homemove card. Pass the address when you have it: the property record fills in bedrooms and the value band, so you ask fewer questions.",
  "If the result has questions, ask the user exactly those (offer the options), then call homemove_quote again with their answers. Never estimate, round or invent a price: quote only the price_gbp a result gives, and say the price is confirmed when they book.",
  "When a figure was assumed from the property record (bedrooms, value band), say so in a few words and invite a correction.",
  "Use homemove_services when someone asks what Homemove offers or which survey or service they need.",
  "When someone is moving and asks what it will cost, what they need, or how to plan it, call homemove_move_plan: it prices every step of their move at once. Stamp duty is HMRC's tax, never a Homemove fee; say so.",
].join(" ");

const QUOTE_TOOL = {
  name: "homemove_quote",
  title: "Get a Homemove quote",
  description:
    "Price a home-moving service with Homemove: surveys (Level 2, Level 3, building, snagging, damp and timber, drone roof, asbestos, structural), valuations (Help to Buy, shared ownership, probate, matrimonial), EPCs, gas safety and electrical certificates, removals, man and van, end of tenancy and deep cleans, carpet and sofa cleaning, packing and boxes, and conveyancing for buying or selling. " +
    "Use this when someone asks how much any of these costs, wants a quote, or asks for a price for their move. Returns the price, or the questions still needed to price it, and shows it in a Homemove quote card.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["service", "postcode"],
    properties: {
      service: { type: "string", description: "The service in the user's words, e.g. \"Level 2 survey\", \"end of tenancy clean\", \"removals\", \"EPC\", or a product id from homemove_services." },
      postcode: { type: "string", description: "Full UK postcode of the property the service is for. Ask for it if the user has not said." },
      address: { type: "string", description: "First line of the address (house number and street), when known. Lets Homemove fill in bedrooms and the value band." },
      property_price: { type: "integer", minimum: 1, description: "What the home is worth or the price being paid, in pounds, if the user said. Sets a survey's price band." },
      bedrooms: { type: "integer", minimum: 1, maximum: 20, description: "Number of bedrooms, if the user said." },
      answers: { type: "object", additionalProperties: { type: "string" }, description: "Answers to questions a previous homemove_quote result asked, keyed by the question's name, e.g. {\"snagging_type\": \"Post-Completion\"}." },
      inventory: { type: "object", additionalProperties: { type: "integer", minimum: 1, maximum: 100 }, description: "Removals, from the quote card only: picker item id → quantity." },
      to_postcode: { type: "string", description: "Removals: the full postcode they are moving to. postcode is where they are moving from." },
      home_size: { type: "string", enum: ["Studio", "1 bedroom", "2 bedrooms", "3 bedrooms", "4 bedrooms", "5+ bedrooms"], description: "Removals: the size of the home they are moving out of, for an indicative price when they have not listed their things." },
      items: { type: "array", maxItems: 60, items: { type: "object", additionalProperties: false, required: ["item"], properties: { item: { type: "string", description: "A thing being moved in the user's words, e.g. \"double bed\", \"3 seater sofa\", \"medium boxes\"." }, quantity: { type: "integer", minimum: 1, maximum: 100 } } }, description: "Removals: what is moving. Only what the user said; never invent a typical household." },
    },
  },
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  _meta: {
    "openai/outputTemplate": HOMEMOVE_WIDGET_URI,
    "openai/toolInvocation/invoking": "Working out your price…",
    "openai/toolInvocation/invoked": "Here's your Homemove quote",
    "openai/widgetAccessible": true,
    ui: { resourceUri: HOMEMOVE_WIDGET_URI, visibility: ["model", "app"] },
  },
} as const;

const PLAN_TOOL = {
  name: "homemove_move_plan",
  title: "Plan and price my move",
  description:
    "Every step of a home move, each with Homemove's price where one can be given: conveyancing, survey, EPC, removals, cleaning and landlord certificates, plus stamp duty from HMRC's rates (shown separately; it is tax, not a Homemove fee). " +
    "Use this when someone says they are buying, selling, renting or letting and asks what moving will cost, what they need to do, or wants a moving checklist or budget.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["situation"],
    properties: {
      situation: { type: "string", enum: ["buying", "selling", "buying_and_selling", "renting", "landlord"], description: "What the user is doing. landlord = letting a home out." },
      to_postcode: { type: "string", description: "Postcode of the home being bought, moved into or let." },
      to_address: { type: "string", description: "First line of that address, when known." },
      from_postcode: { type: "string", description: "Postcode of the home being sold or moved out of." },
      from_address: { type: "string", description: "First line of that address, when known." },
      property_price: { type: "integer", minimum: 1, description: "Price of the home being bought, in pounds." },
      sale_price: { type: "integer", minimum: 1, description: "Price of the home being sold, in pounds." },
      first_time_buyer: { type: "boolean" },
      additional_property: { type: "boolean", description: "True when buying a second home or buy-to-let (higher stamp duty rates)." },
      mortgage: { type: "boolean", description: "Buying with a mortgage, or (when selling) a mortgage to pay off." },
      bedrooms: { type: "integer", minimum: 1, maximum: 20 },
      items: { type: "array", maxItems: 60, items: { type: "object", additionalProperties: false, required: ["item"], properties: { item: { type: "string" }, quantity: { type: "integer", minimum: 1, maximum: 100 } } }, description: "What is moving, only as the user said it." },
    },
  },
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  _meta: {
    "openai/outputTemplate": HOMEMOVE_WIDGET_URI,
    "openai/toolInvocation/invoking": "Pricing your move…",
    "openai/toolInvocation/invoked": "Here's your move, priced",
    "openai/widgetAccessible": true,
    ui: { resourceUri: HOMEMOVE_WIDGET_URI, visibility: ["model", "app"] },
  },
} as const;

const STAMP_TOOL = {
  name: "homemove_stamp_duty",
  title: "Stamp duty",
  description: "Stamp duty (SDLT) on a home purchase in England or Northern Ireland at current HMRC rates, with first-time buyer relief or the higher rates for additional homes, band by band. Use this when someone asks how much stamp duty they will pay.",
  inputSchema: {
    type: "object", additionalProperties: false, required: ["price", "buyer_type"],
    properties: {
      price: { type: "integer", minimum: 1, description: "Purchase price in pounds." },
      buyer_type: { type: "string", enum: ["standard", "first_time", "additional"], description: "first_time for first-time buyers, additional for second homes and buy-to-let." },
    },
  },
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
} as const;

const SERVICES_TOOL = {
  name: "homemove_services",
  title: "Homemove services",
  description:
    "List the services Homemove can quote, grouped by kind, with what each one's price depends on. Use this when someone asks what Homemove offers, which survey they need, or what a service involves, before quoting.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: { type: { type: "string", enum: ["surveys", "cleaning", "removals", "legal"], description: "Only this kind of service." } },
  },
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
} as const;

const NOAUTH = { securitySchemes: [{ type: "noauth" }] };

/** Every tool the endpoint lists when Homedata is configured, for the plugin package's checks. */
export const HOMEMOVE_TOOL_LIST = [QUOTE_TOOL, PLAN_TOOL, STAMP_TOOL, SERVICES_TOOL];

/** What the model is told when motus or Homedata does not answer. */
export const UNAVAILABLE_TEXT = "Homemove could not work out the price just now. Tell the user to try again in a moment. Do not estimate a price.";

/** The model-facing summary that goes with a quote, so it says what the card shows and no more. */
export function quoteNarration(answer: QuoteAnswer & { continue_url?: string }): string {
  const link = answer.continue_url ? ` They can carry on at homemove.com: ${answer.continue_url}` : "";
  return quoteNarrationCore(answer) + link;
}

function quoteNarrationCore(answer: QuoteAnswer): string {
  switch (answer.status) {
    case "priced": {
      const what: Record<string, string> = { beds: "bedrooms", tenure: "tenure", property_price: "value" };
      const assumed = answer.assumed.map((a) => `${what[a.name] ?? a.name} ${a.value} (from ${a.source})`).join("; ");
      if (answer.move) {
        const m = answer.move;
        return `Homemove's ${answer.indicative ? `indicative removals price for ${answer.indicative}` : "removals guide price"} from ${m.from} to ${m.to} is £${answer.price_gbp.toLocaleString("en-GB")}: about ${m.cubic_meters} m³, ${m.num_vans && m.num_vans > 1 ? `${m.num_vans} × ` : ""}${m.van_type}, a crew of ${m.crew_size}, around ${m.estimated_hours} hours, ${m.distance_km} km.` +
          (answer.unmatched?.length ? ` Not in the price (not on the item list): ${answer.unmatched.join(", ")}; say so.` : "") +
          (answer.indicative ? ` Say it is indicative, based on ${answer.indicative}; listing their own things (in chat or on the card) or continuing on homemove.com refines it.` : " It's a guide price from what they listed.") +
          " The final price is confirmed when they book on homemove.com. The card shows it with a button to carry on there; keep your reply short.";
      }
      const extras = (answer.extras ?? []).map((x) => `${x.label} £${x.amount_gbp.toLocaleString("en-GB")} is a separate line`).join("; ");
      return `Homemove's price for a ${answer.product.name} at ${answer.property?.address ?? answer.postcode} is £${answer.price_gbp.toLocaleString("en-GB")}.` +
        (answer.band ? ` Priced on the ${bandLabel(answer.band)} value band.` : "") +
        (assumed ? ` Assumed: ${assumed}; say so and invite a correction.` : "") +
        (extras ? ` ${extras}, not in that total.` : "") +
        " The price is confirmed when they book on homemove.com. The card shows it with a button to carry on there; keep your reply short.";
    }
    case "needs_answers":
      return `To price a ${answer.product.name}, ask: ` + answer.questions.map((q) => q.options.length ? `${q.question} (${q.options.join(" / ")})` : q.question).join(" ") +
        (answer.questions.some((q) => q.name === "home_size" || q.name === "to_postcode")
          ? " Then call homemove_quote again with to_postcode and home_size for an indicative price, or items (each thing they named, with a quantity) for their own list. Never make up a list of their things; the card also lets them pick room by room."
          : " Then call homemove_quote again with the answers (property_price in pounds for the value).") +
        (answer.unmatched?.length ? ` These aren't on Homemove's item list, so ask what they're closest to: ${answer.unmatched.join(", ")}.` : "");
    case "quoted_by_hand":
      return `A ${answer.product.name} for this home is quoted by the Homemove team rather than instantly. Tell the user a specialist will price it, and do not estimate.`;
    case "choose_service":
      return `Several services match: ${answer.options.map((o) => o.name).join(", ")}. Ask which one they mean, then call homemove_quote with it.`;
    case "unknown_service":
      return `Homemove has no instant price for "${answer.service}". Offer the closest service from homemove_services, or say the team can quote it.`;
    case "address_not_found":
      return answer.reason === "multiple_matches"
        ? "That address matches more than one property. Ask for the flat or house number exactly as it appears on post, then try again."
        : "No property matches that address and postcode. Ask the user to check them, or quote with the postcode alone.";
  }
}

function result(body: Record<string, unknown>, text: string, isError = false): CallToolResult {
  return { content: [{ type: "text", text }], structuredContent: body, ...(isError ? { isError: true } : {}) };
}

export function planNarration(plan: MovePlan): string {
  const lines = plan.lines.map((l) => l.answer.status === "priced" ? `${l.step}: £${l.answer.price_gbp.toLocaleString("en-GB")}` : `${l.step}: needs details`).join("; ");
  return `Homemove priced ${plan.priced} of ${plan.lines.length} steps, £${plan.total_gbp.toLocaleString("en-GB")} together (${lines}).` +
    (plan.unpriced.length ? ` Not in that total: ${plan.unpriced.join(", ")}; offer to price them (the card lets them tap through).` : "") +
    (plan.stamp_duty ? ` Stamp duty would be £${plan.stamp_duty.total_tax.toLocaleString("en-GB")} (${plan.stamp_duty.jurisdiction}, rates from ${plan.stamp_duty.thresholds_from}); it is paid to HMRC, not Homemove, and is not in the total.` : "") +
    " Prices are confirmed when they book. The card shows the plan; keep your reply short.";
}

export function buildHomemoveServer(deps: { motus: MotusClient; property: PropertyLookup; assetOrigin: string; homedata?: HomedataClient; handoffBase?: string }): Server {
  const server = new Server({ name: "homemove", version: VERSION }, { capabilities: { tools: {}, resources: {} }, instructions: HOMEMOVE_INSTRUCTIONS });

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [{ uri: HOMEMOVE_WIDGET_URI, name: "Homemove quote", description: "A Homemove quote card that opens into a full-window quote with the Homies.", mimeType: "text/html;profile=mcp-app" }],
  }));
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const version = request.params.uri.match(/^ui:\/\/homemove\/quote-v([1-9]\d*)\.html$/)?.[1];
    if (!version || Number(version) > HOMEMOVE_WIDGET_VERSION) throw new Error("Unknown Homemove UI resource");
    const csp = { connectDomains: [] as string[], resourceDomains: [deps.assetOrigin] };
    return { contents: [{
      uri: request.params.uri,
      mimeType: "text/html;profile=mcp-app",
      text: homemoveWidgetHtml(deps.assetOrigin),
      _meta: {
        ui: { prefersBorder: false, domain: deps.assetOrigin, csp },
        "openai/widgetDescription": "A Homemove quote: the price with the service, the answers it was priced on and what was assumed, or the questions still needed.",
        "openai/widgetPrefersBorder": false,
        "openai/widgetDomain": deps.assetOrigin,
        "openai/widgetCSP": { connect_domains: csp.connectDomains, resource_domains: csp.resourceDomains, redirect_domains: ["https://homemove.com", "https://app.homemove.com"] },
        "openai/ui": { availableDisplayModes: ["inline", "fullscreen"] },
      },
    }] };
  });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [QUOTE_TOOL, ...(deps.homedata ? [PLAN_TOOL, STAMP_TOOL] : []), SERVICES_TOOL].map((tool) => ({ ...tool, outputSchema: { type: "object", additionalProperties: true }, ...NOAUTH, _meta: { ...NOAUTH, ...("_meta" in tool ? tool._meta : {}) } })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const args = (request.params.arguments ?? {}) as Record<string, unknown>;
    try {
      if (request.params.name === "homemove_quote") {
        const postcode = typeof args["postcode"] === "string" ? args["postcode"].trim() : "";
        const service = args["service"];
        if (!postcode || !/^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i.test(postcode)) return result({ error: "invalid_request", detail: "postcode must be a full UK postcode" }, "Ask the user for the full postcode of the property, then try again.", true);
        if ((typeof service !== "string" || !service.trim()) && typeof service !== "number") return result({ error: "invalid_request", detail: "service is required" }, "Ask which service they want priced.", true);
        const answers = args["answers"] && typeof args["answers"] === "object" && !Array.isArray(args["answers"]) ? args["answers"] as Record<string, unknown> : undefined;
        const answer = await quote({
          service: service as string,
          postcode,
          address: typeof args["address"] === "string" ? args["address"] : undefined,
          property_price: typeof args["property_price"] === "number" && args["property_price"] > 0 ? args["property_price"] : undefined,
          bedrooms: typeof args["bedrooms"] === "number" && args["bedrooms"] > 0 ? Math.round(args["bedrooms"]) : undefined,
          answers,
          to_postcode: typeof args["to_postcode"] === "string" && args["to_postcode"].trim() ? args["to_postcode"].trim() : undefined,
          home_size: typeof args["home_size"] === "string" ? args["home_size"] : undefined,
          items: Array.isArray(args["items"]) ? (args["items"] as Array<{ item?: unknown; quantity?: unknown }>).filter((i) => typeof i?.item === "string").map((i) => ({ item: String(i.item), quantity: typeof i.quantity === "number" ? i.quantity : undefined })) : undefined,
          inventory: args["inventory"] && typeof args["inventory"] === "object" && !Array.isArray(args["inventory"]) ? Object.fromEntries(Object.entries(args["inventory"] as Record<string, unknown>).filter(([, v]) => typeof v === "number").map(([k, v]) => [k, v as number])) : undefined,
        }, deps);
        const continue_url = continueUrlForQuote(answer, deps.handoffBase);
        const withLink = { ...answer, continue_url };
        return result(withLink as unknown as Record<string, unknown>, quoteNarration(withLink));
      }
      if (request.params.name === "homemove_move_plan" && deps.homedata) {
        const situation = String(args["situation"] ?? "") as Situation;
        if (!["buying", "selling", "buying_and_selling", "renting", "landlord"].includes(situation)) return result({ error: "invalid_request", detail: "situation is required" }, "Ask whether they are buying, selling, both, renting or letting.", true);
        const pc = (k: string) => typeof args[k] === "string" && /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i.test(String(args[k]).trim()) ? String(args[k]).trim() : undefined;
        const num = (k: string) => typeof args[k] === "number" && (args[k] as number) > 0 ? args[k] as number : undefined;
        const str = (k: string) => typeof args[k] === "string" && String(args[k]).trim() ? String(args[k]).trim() : undefined;
        const plan = await planMove({
          situation, to_postcode: pc("to_postcode"), from_postcode: pc("from_postcode"), to_address: str("to_address"), from_address: str("from_address"),
          property_price: num("property_price"), sale_price: num("sale_price"), bedrooms: num("bedrooms"),
          first_time_buyer: args["first_time_buyer"] === true, additional_property: args["additional_property"] === true,
          mortgage: typeof args["mortgage"] === "boolean" ? args["mortgage"] : undefined,
          items: Array.isArray(args["items"]) ? (args["items"] as Array<{ item?: unknown; quantity?: unknown }>).filter((i) => typeof i?.item === "string").map((i) => ({ item: String(i.item), quantity: typeof i.quantity === "number" ? i.quantity : undefined })) : undefined,
        }, { motus: deps.motus, property: deps.property, homedata: deps.homedata });
        if (!plan.lines.length) return result({ view: "plan", ...plan } as unknown as Record<string, unknown>, "Ask for the postcode of the home they are moving to (and from, if they are selling or renting), then try again.");
        const continue_url = continueUrlForPlan(plan, { to_postcode: pc("to_postcode"), from_postcode: pc("from_postcode") }, deps.handoffBase);
        const lines = plan.lines.map((l) => ({ ...l, answer: { ...l.answer, continue_url: continueUrlForQuote(l.answer, deps.handoffBase) } }));
        return result({ view: "plan", ...plan, lines, continue_url } as unknown as Record<string, unknown>, planNarration({ ...plan, lines }) + ` To carry on with everything on homemove.com: ${continue_url}`);
      }
      if (request.params.name === "homemove_stamp_duty" && deps.homedata) {
        const price = typeof args["price"] === "number" && args["price"] > 0 ? Math.round(args["price"]) : 0;
        const buyer = String(args["buyer_type"] ?? "");
        if (!price || !["standard", "first_time", "additional"].includes(buyer)) return result({ error: "invalid_request", detail: "price and buyer_type are required" }, "Ask for the price and whether they are a first-time buyer or buying an additional home.", true);
        const sd = await deps.homedata.send("GET", "/calculators/stamp-duty/", { price: String(price), buyer_type: buyer });
        if (sd.statusCode >= 400) throw new Error(`stamp duty answered ${sd.statusCode}`);
        const body = sd.body as { total_tax?: number; jurisdiction?: string };
        return result(sd.body as Record<string, unknown>, `Stamp duty on £${price.toLocaleString("en-GB")} is £${Number(body.total_tax ?? 0).toLocaleString("en-GB")} (${body.jurisdiction ?? "England and Northern Ireland"}). It is paid to HMRC. Scotland (LBTT) and Wales (LTT) have their own taxes.`);
      }
      if (request.params.name === "homemove_services") {
        const type = typeof args["type"] === "string" ? args["type"] : undefined;
        const products = type === "legal" ? [] : (await deps.motus.products()).filter((p) => !p.is_addon && (!type || p.type === type) && ["surveys", "cleaning", "removals"].includes(p.type ?? ""));
        const services = products.map((p) => ({
          id: p.id,
          name: p.name.trim(),
          type: p.type,
          ...(p.price_gbp ? { price_gbp: p.price_gbp } : {}),
          priced_on: p.inputs.map((i) => (i.key === PROPERTY_PRICE_KEY ? "the home's value" : questionFor(i))),
        }));
        if (!type || type === "legal") services.push({ id: 1062, name: "Conveyancing (buying or selling)", type: "legal", priced_on: ["whether you're buying or selling", "the price", "freehold or leasehold", "mortgage or cash"] });
        return result({ services }, `Homemove can quote ${services.length} services. Name the ones that fit the user's question; quote prices only from homemove_quote or a listed price_gbp.`);
      }
      return result({ error: "unknown_tool", detail: request.params.name }, `Unknown tool ${request.params.name}.`, true);
    } catch (error) {
      console.error("[homemove-mcp] tool failed:", error instanceof Error ? error.message : error);
      return result({ available: false, reason: UNAVAILABLE_TEXT }, UNAVAILABLE_TEXT, true);
    }
  });
  return server;
}
