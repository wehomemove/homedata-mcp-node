import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  type CallToolRequest,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";

import { VERSION } from "../index.js";
import type { MotusClient } from "./motus.js";
import type { PropertyLookup } from "./property.js";
import { PROPERTY_PRICE_KEY, bandLabel, consumerProduct, questionFor, quote, type QuoteAnswer } from "./quote.js";
import { homemoveWidgetHtml, HOMEMOVE_WIDGET_URI, HOMEMOVE_WIDGET_VERSION } from "./widget.js";
import type { HomedataClient } from "../client.js";
import { planMove, type MovePlan, type Situation } from "./plan.js";
import { continueUrlForPlan, continueUrlForQuote } from "./handoff.js";
import { tagged } from "./utm.js";
import { callDetail, shownToolName } from "./activity.js";
import { outcomeOf, type HomeCall } from "../home/activity.js";
import { pickDeals, type BroadbandClient, type BroadbandSort } from "./broadband.js";
import { movingChecklist, type ChecklistSituation } from "./checklist.js";
import { AddressNotMatched } from "./property.js";

export const HOMEMOVE_INSTRUCTIONS = [
  "Homemove is a UK home-moving service. Use these tools for anything to do with moving home in the UK: buying, selling, renting, letting or moving out, what any part of it costs, what needs doing and when, and who to tell.",
  "Prices: surveys and valuations, EPCs, gas safety and electrical certificates, conveyancing, removals and man and van, moving and end of tenancy cleans, packing, all from homemove_quote, which returns Homemove's own live price and shows it in a Homemove card. Broadband at an address: homemove_broadband. Stamp duty: homemove_stamp_duty. Mortgage repayment figures: homemove_mortgage_repayments. Council tax band of a home: homemove_council_tax. What to do and who to tell: homemove_moving_checklist. A whole move priced step by step: homemove_move_plan.",
  "Home insurance, mortgage advice and choosing an estate agent are handled on homemove.com: homemove_quote returns the way in. Never give insurance or mortgage advice, recommend a lender, insurer or agent, or quote an insurance premium yourself.",
  "Call homemove_quote as soon as you know the service: do not ask for a postcode, address or price first. When the price depends on the home's value, the result gives the price from and the card lets them pick their address or value range. If the result has other questions, ask the user exactly those (offer the options), then call homemove_quote again with their answers. Never estimate, round or invent a price: quote only the price_gbp a result gives, and say the price is confirmed when they book.",
  "Do not open homemove.com, a Homemove app or a browser to find a price, and do not ask anyone to sign in: these tools answer directly and need no account.",
  "When a figure was assumed from the property record (bedrooms, value band, tenure), say so in a few words and invite a correction.",
  "Stamp duty is HMRC's tax and council tax is the council's, never a Homemove fee; say so.",
].join(" ");

const QUOTE_TOOL = {
  name: "homemove_quote",
  title: "Get a Homemove quote",
  description:
    "Use this when someone moving home in the UK asks what something costs or wants a quote: a survey (Level 2 or homebuyer's, Level 3 or building survey, snagging, damp and timber, structural, drone roof, asbestos, thermal), a valuation (Help to Buy, shared ownership, probate, matrimonial), an EPC, a gas safety certificate, an electrical inspection (EICR), conveyancing or solicitor's fees for buying or selling, removals or a man and van, an end of tenancy, moving-out or deep clean (getting a deposit back), carpet or sofa cleaning, or packing and boxes. " +
    "Also use it when they ask about home insurance, a mortgage or remortgage, or choosing an estate agent to sell: it returns homemove.com's way in for those. " +
    "Returns Homemove's live price directly (no website, app or sign-in), or the questions still needed, in a Homemove card. Call it straight away with whatever they have said. " +
    "Do not use it for stamp duty (homemove_stamp_duty), broadband (homemove_broadband), mortgage repayment sums (homemove_mortgage_repayments), or to plan a whole move (homemove_move_plan).",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["service"],
    properties: {
      service: { type: "string", description: "The service in the user's words, e.g. \"Level 2 survey\", \"end of tenancy clean\", \"removals\", \"EPC\", or a product id from homemove_services." },
      postcode: { type: "string", description: "Full UK postcode of the property the service is for, if the user said. Leave out rather than asking: the card shows the price from, and lets them pick their address." },
      address: { type: "string", description: "First line of the address (house number and street), when known. Lets Homemove fill in bedrooms and the value band." },
      uprn: { type: "string", pattern: "^\\d{1,15}$", description: "From the quote card only: the UPRN of the address the user picked." },
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
    "Use this when someone is buying, selling, both, renting or letting a home in the UK and asks what the whole move will cost, what they need, how to budget for it, or how much moving house costs: it lists every step (conveyancing for each side, survey, EPC, removals, the clean, landlord certificates) with Homemove's price for each, plus stamp duty from HMRC's rates shown apart from Homemove's fees. " +
    "Do not use it for one service on its own (homemove_quote) or for a to-do list of who to tell (homemove_moving_checklist).",
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
  description: "Use this when someone asks how much stamp duty (SDLT) they will pay on a home in England or Northern Ireland, whether first-time buyer relief applies, or the higher rates for a second home or buy-to-let. Works it out band by band at current HMRC rates. Do not use it for Scotland (LBTT) or Wales (LTT).",
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
    "Use this when someone asks what Homemove does or offers, what services they might need for a move, or which survey or service fits their situation, before quoting. Lists the services Homemove can quote, grouped by kind, with what each one's price depends on. Do not use it to get a price (homemove_quote).",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: { type: { type: "string", enum: ["surveys", "cleaning", "removals", "legal"], description: "Only this kind of service." } },
  },
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
} as const;

const FIND_ADDRESS_TOOL = {
  name: "homemove_find_address",
  title: "Find an address",
  description: "Used by the Homemove quote card to look up addresses as the user types: a full postcode lists its homes, anything else searches addresses. Returns each address with its UPRN.",
  inputSchema: {
    type: "object", additionalProperties: false, required: ["query"],
    properties: { query: { type: "string", minLength: 3, maxLength: 120, description: "What the user typed: a postcode, or part of an address." } },
  },
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  _meta: { "openai/widgetAccessible": true, ui: { visibility: ["app"] } },
} as const;

const BROADBAND_TOOL = {
  name: "homemove_broadband",
  title: "Compare broadband",
  description: "Broadband deals available at a UK postcode from homemove.com's broadband comparison: provider, download and upload speed, monthly price, set-up fee and contract length. Use this when someone asks what broadband they can get at a home, or for the cheapest or fastest broadband there.",
  inputSchema: {
    type: "object", additionalProperties: false, required: ["postcode"],
    properties: {
      postcode: { type: "string", description: "Full UK postcode of the home." },
      sort: { type: "string", enum: ["price", "speed"], description: "price: cheapest first (default). speed: fastest first." },
      min_mbps: { type: "integer", minimum: 1, description: "Only deals at least this fast (download, Mbps), if the user said." },
      max_monthly_gbp: { type: "number", minimum: 1, description: "Only deals at or under this monthly price, if the user said." },
    },
  },
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  _meta: {
    "openai/outputTemplate": HOMEMOVE_WIDGET_URI,
    "openai/toolInvocation/invoking": "Finding broadband…",
    "openai/toolInvocation/invoked": "Here's broadband at that address",
    "openai/widgetAccessible": true,
    ui: { resourceUri: HOMEMOVE_WIDGET_URI, visibility: ["model", "app"] },
  },
} as const;

const BROADBAND_LINK_TOOL = {
  name: "homemove_broadband_link",
  title: "Open a broadband deal",
  description: "Used by the Homemove card when the user taps a broadband deal: returns the provider's page for it.",
  inputSchema: {
    type: "object", additionalProperties: false, required: ["deal_id"],
    properties: { deal_id: { type: "integer", minimum: 1 }, postcode: { type: "string", maxLength: 10 } },
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  _meta: { "openai/widgetAccessible": true, ui: { visibility: ["app"] } },
} as const;

const CHECKLIST_TOOL = {
  name: "homemove_moving_checklist",
  title: "Moving checklist",
  description:
    "Use this when someone moving home in the UK asks what they need to do, who to tell when they move (council, DVLA, HMRC, banks, energy and water, GP, TV licence, Royal Mail redirection), how to plan or prepare, or what to do and when. " +
    "Returns a checklist by stage (from 8 weeks before to after the move), dated back from the move date if given, with the steps Homemove can price marked. Do not use it to price a step (homemove_quote) or the whole move (homemove_move_plan).",
  inputSchema: {
    type: "object", additionalProperties: false, required: ["situation"],
    properties: {
      situation: { type: "string", enum: ["buying", "selling", "buying_and_selling", "renting", "landlord"], description: "What the user is doing. renting = moving into or out of a rental; landlord = letting a home out." },
      move_date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "The moving date as YYYY-MM-DD, if they said." },
    },
  },
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
} as const;

const MORTGAGE_TOOL = {
  name: "homemove_mortgage_repayments",
  title: "Mortgage repayments",
  description:
    "Use this when someone asks what their monthly mortgage payments would be, how much interest they would pay, or their loan to value, for a given price, deposit, interest rate and term. Works out the repayment-mortgage figures. " +
    "It is arithmetic, not advice: do not use it to recommend a mortgage, lender or rate (homemove_quote with \"mortgage\" gives homemove.com's mortgage service).",
  inputSchema: {
    type: "object", additionalProperties: false, required: ["price", "deposit", "rate", "term"],
    properties: {
      price: { type: "integer", minimum: 1, description: "Purchase price in pounds." },
      deposit: { type: "integer", minimum: 0, description: "Deposit in pounds." },
      rate: { type: "number", minimum: 0, maximum: 25, description: "Annual interest rate as a percentage, e.g. 4.5." },
      term: { type: "integer", minimum: 1, maximum: 40, description: "Term in years." },
    },
  },
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
} as const;

const COUNCIL_TAX_TOOL = {
  name: "homemove_council_tax",
  title: "Council tax band",
  description:
    "Use this when someone asks the council tax band of a home in England, Scotland or Wales, for example the one they are buying or moving into, and which council it is with. Needs the address and postcode. Do not use it for a council tax bill amount.",
  inputSchema: {
    type: "object", additionalProperties: false, required: ["postcode", "address"],
    properties: {
      postcode: { type: "string", description: "Full UK postcode of the home." },
      address: { type: "string", description: "First line of the address: house number or name and street." },
    },
  },
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
} as const;

const NOAUTH = { securitySchemes: [{ type: "noauth" }] };

/** Every tool the endpoint lists when Homedata is configured, for the plugin package's checks. */
export const HOMEMOVE_TOOL_LIST = [QUOTE_TOOL, PLAN_TOOL, STAMP_TOOL, SERVICES_TOOL, FIND_ADDRESS_TOOL, BROADBAND_TOOL, BROADBAND_LINK_TOOL, CHECKLIST_TOOL, MORTGAGE_TOOL, COUNCIL_TAX_TOOL];

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
      return `Homemove's price for ${/^[aeiou]/i.test(answer.product.name) ? "an" : "a"} ${answer.product.name} at ${answer.property?.address ?? answer.postcode} is £${answer.price_gbp.toLocaleString("en-GB")}.` +
        (answer.band ? ` Priced on the ${bandLabel(answer.band)} value band.` : "") +
        (assumed ? ` Assumed: ${assumed}; say so and invite a correction.` : "") +
        (answer.assumed.some((a) => a.name === "property_price") && answer.bands ? " The card asks them to confirm the value range before it shows the price." : "") +
        (extras ? ` ${extras}, not in that total.` : "") +
        " The price is confirmed when they book on homemove.com. The card shows it with a button to carry on there; keep your reply short.";
    }
    case "needs_answers":
      if (answer.from_gbp && answer.bands) {
        const top = answer.bands[answer.bands.length - 1]!;
        return `${/^[aeiou]/i.test(answer.product.name) ? "An" : "A"} ${answer.product.name} with Homemove is from £${answer.from_gbp.toLocaleString("en-GB")}, depending on the home's value (£${top.price_gbp.toLocaleString("en-GB")} for ${top.label}). ` +
          "Say that in a sentence. The card shows it and lets them pick their address, or a value range, for their exact price; do not ask for the postcode or price yourself. If they give the address or value in the chat, call homemove_quote again with it.";
      }
      return `To price ${/^[aeiou]/i.test(answer.product.name) ? "an" : "a"} ${answer.product.name}, ask: ` + answer.questions.map((q) => q.options.length ? `${q.question} (${q.options.join(" / ")})` : q.question).join(" ") +
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
    case "front_door":
      return `${answer.line} The card opens it on homemove.com. ` +
        (answer.door === "home_insurance" ? "Do not quote, compare or recommend insurance or give insurance advice in this chat; say Homemove's partner quotes it on homemove.com." :
          answer.door === "mortgage" ? "Do not give mortgage advice or recommend a lender or rate; for repayment figures use homemove_mortgage_repayments." :
            "Do not recommend a particular agent in this chat.");
    case "address_not_found":
      return (answer.reason === "multiple_matches" ? "That address matches more than one home at that postcode." : "Homemove couldn't match that address at that postcode.") +
        " The card lists the homes at the postcode for them to pick theirs; say so in a sentence and do not ask them to retype it. If they give the flat or house number in the chat, call homemove_quote again with it.";
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

export function buildHomemoveServer(deps: { motus: MotusClient; property: PropertyLookup; assetOrigin: string; homedata?: HomedataClient; handoffBase?: string; broadband?: BroadbandClient; onToolCall?: (call: HomeCall) => void }): Server {
  const server = new Server({ name: "homemove", version: VERSION }, { capabilities: { tools: {}, resources: {} }, instructions: HOMEMOVE_INSTRUCTIONS });

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [{ uri: HOMEMOVE_WIDGET_URI, name: "Homemove quote", description: "A Homemove quote card that opens into a full-window quote with the Homies.", mimeType: "text/html;profile=mcp-app" }],
  }));
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const version = request.params.uri.match(/^ui:\/\/homemove\/quote-v([1-9]\d*)\.html$/)?.[1];
    if (!version || Number(version) > HOMEMOVE_WIDGET_VERSION) throw new Error("Unknown Homemove UI resource");
    // Broadband provider logos come from homemove.com's CDN.
    const csp = { connectDomains: [] as string[], resourceDomains: [deps.assetOrigin, "https://cdn.homemove.com"] };
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
    tools: [QUOTE_TOOL, ...(deps.homedata ? [PLAN_TOOL, STAMP_TOOL, MORTGAGE_TOOL, COUNCIL_TAX_TOOL] : []), SERVICES_TOOL, CHECKLIST_TOOL, FIND_ADDRESS_TOOL, ...(deps.broadband ? [BROADBAND_TOOL, BROADBAND_LINK_TOOL] : [])].map((tool) => ({ ...tool, outputSchema: { type: "object", additionalProperties: true }, ...NOAUTH, _meta: { ...NOAUTH, ...("_meta" in tool ? tool._meta : {}) } })),
  }));

  const handle = async (request: CallToolRequest): Promise<CallToolResult> => {
    const args = (request.params.arguments ?? {}) as Record<string, unknown>;
    try {
      if (request.params.name === "homemove_quote") {
        const postcode = typeof args["postcode"] === "string" ? args["postcode"].trim() : "";
        const service = args["service"];
        if (postcode && !/^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i.test(postcode)) return result({ error: "invalid_request", detail: "postcode must be a full UK postcode" }, "Ask the user for the full postcode of the property, then try again.", true);
        if ((typeof service !== "string" || !service.trim()) && typeof service !== "number") return result({ error: "invalid_request", detail: "service is required" }, "Ask which service they want priced.", true);
        const answers = args["answers"] && typeof args["answers"] === "object" && !Array.isArray(args["answers"]) ? args["answers"] as Record<string, unknown> : undefined;
        const answer = await quote({
          service: service as string,
          postcode,
          address: typeof args["address"] === "string" ? args["address"] : undefined,
          uprn: typeof args["uprn"] === "string" && /^\d{1,15}$/.test(args["uprn"]) ? args["uprn"] : undefined,
          property_price: typeof args["property_price"] === "number" && args["property_price"] > 0 ? args["property_price"] : undefined,
          bedrooms: typeof args["bedrooms"] === "number" && args["bedrooms"] > 0 ? Math.round(args["bedrooms"]) : undefined,
          answers,
          to_postcode: typeof args["to_postcode"] === "string" && args["to_postcode"].trim() ? args["to_postcode"].trim() : undefined,
          home_size: typeof args["home_size"] === "string" ? args["home_size"] : undefined,
          items: Array.isArray(args["items"]) ? (args["items"] as Array<{ item?: unknown; quantity?: unknown }>).filter((i) => typeof i?.item === "string").map((i) => ({ item: String(i.item), quantity: typeof i.quantity === "number" ? i.quantity : undefined })) : undefined,
          inventory: args["inventory"] && typeof args["inventory"] === "object" && !Array.isArray(args["inventory"]) ? Object.fromEntries(Object.entries(args["inventory"] as Record<string, unknown>).filter(([, v]) => typeof v === "number").map(([k, v]) => [k, v as number])) : undefined,
        }, deps);
        const what = "product" in answer && answer.product ? answer.product.name : answer.status === "front_door" ? answer.door : answer.status;
        const continue_url = tagged(continueUrlForQuote(answer, deps.handoffBase), what);
        const withLink = { ...answer, ...("booking_url" in answer && answer.booking_url ? { booking_url: tagged(answer.booking_url, what) } : {}), continue_url };
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
        const continue_url = tagged(continueUrlForPlan(plan, { to_postcode: pc("to_postcode"), from_postcode: pc("from_postcode") }, deps.handoffBase), `move-plan-${situation}`);
        const lines = plan.lines.map((l) => ({ ...l, answer: { ...l.answer, continue_url: tagged(continueUrlForQuote(l.answer, deps.handoffBase), "product" in l.answer && l.answer.product ? l.answer.product.name : "move-plan") } }));
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
      if (request.params.name === "homemove_broadband" && deps.broadband) {
        const postcode = typeof args["postcode"] === "string" ? args["postcode"].trim().toUpperCase() : "";
        if (!/^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/.test(postcode)) return result({ error: "invalid_request", detail: "postcode must be a full UK postcode" }, "Ask for the full postcode of the home, then try again.", true);
        const all = await deps.broadband.deals(postcode);
        const sort: BroadbandSort = args["sort"] === "speed" ? "speed" : "price";
        const filters = { min_mbps: typeof args["min_mbps"] === "number" ? args["min_mbps"] : undefined, max_monthly_gbp: typeof args["max_monthly_gbp"] === "number" ? args["max_monthly_gbp"] : undefined };
        const deals = pickDeals(all, { sort, ...filters });
        const compare = tagged(`https://homemove.com/broadband/compare/${encodeURIComponent(postcode.replace(/\s+/g, ""))}`, "broadband");
        const body = { view: "broadband", postcode, sort, ...filters, total: all.length, deals, all_deals: all, continue_url: compare };
        if (!deals.length) return result(body, all.length ? "No deal on homemove.com's comparison matches those limits at that postcode; say so and offer to relax them." : "homemove.com's comparison lists no broadband deals for that postcode. Say so; they can check providers directly.");
        const top = deals.slice(0, 3).map((d) => `${d.provider} ${d.name}: ${d.download_mbps} Mbps, £${d.monthly_gbp}/month, ${d.contract_months ?? "?"}-month contract${d.setup_gbp ? `, £${d.setup_gbp} set-up` : ""}`).join("; ");
        return result(body, `homemove.com's broadband comparison lists ${all.length} deals at ${postcode}${filters.min_mbps || filters.max_monthly_gbp ? ` (${pickDeals(all, { ...filters, limit: Infinity }).length} within their limits)` : ""}. ${sort === "speed" ? "Fastest" : "Cheapest"} first: ${top}. ` +
          "These are listed prices; say to confirm availability and price with the provider before ordering, and that Homemove may earn a commission if they order through a link. Don't call any deal the best. The card shows them all with sorting and links.");
      }
      if (request.params.name === "homemove_broadband_link" && deps.broadband) {
        const id = typeof args["deal_id"] === "number" ? Math.round(args["deal_id"]) : 0;
        if (id < 1) return result({ error: "invalid_request", detail: "deal_id is required" }, "No deal chosen.", true);
        const url = await deps.broadband.link(id, typeof args["postcode"] === "string" ? args["postcode"] : undefined);
        return result({ url }, "The deal's page is open for the user.");
      }
      if (request.params.name === "homemove_moving_checklist") {
        const situation = String(args["situation"] ?? "") as ChecklistSituation;
        if (!["buying", "selling", "buying_and_selling", "renting", "landlord"].includes(situation)) return result({ error: "invalid_request", detail: "situation is required" }, "Ask whether they are buying, selling, both, renting or letting.", true);
        const moveDate = typeof args["move_date"] === "string" ? args["move_date"] : undefined;
        const stages = movingChecklist(situation, moveDate);
        const priced = stages.flatMap((st) => st.items.filter((i) => i.service).map((i) => i.service!));
        return result({ situation, ...(moveDate ? { move_date: moveDate } : {}), stages, continue_url: tagged("https://homemove.com/", "moving-checklist") },
          `A moving checklist in ${stages.length} stages${moveDate ? `, dated back from ${moveDate}` : ""}: ` + stages.map((st) => `${st.when}${st.date ? ` (by ${st.date})` : ""}: ${st.items.map((i) => i.task).join("; ")}`).join(". ") +
          `. Give it as a short checklist. Homemove can price ${[...new Set(priced)].join(", ")}; offer to, with homemove_quote (or homemove_broadband for broadband).`);
      }
      if (request.params.name === "homemove_mortgage_repayments" && deps.homedata) {
        const n = (k: string) => (typeof args[k] === "number" && Number.isFinite(args[k]) ? (args[k] as number) : NaN);
        const price = n("price"), deposit = n("deposit"), rate = n("rate"), term = n("term");
        if (!(price > 0) || !(deposit >= 0) || deposit >= price || !(rate >= 0) || !(term >= 1)) return result({ error: "invalid_request", detail: "price, deposit (less than the price), rate and term are required" }, "Ask for the price, deposit, interest rate and term.", true);
        const res = await deps.homedata.send("GET", "/calculators/mortgage/", { price: String(price), deposit: String(deposit), rate: String(rate), term: String(Math.round(term)) });
        if (res.statusCode >= 400) throw new Error(`mortgage calculator answered ${res.statusCode}`);
        const m = res.body as { monthly_payment?: number; total_interest?: number; loan_amount?: number; ltv_pct?: number };
        const f = (v: unknown) => `£${Number(v ?? 0).toLocaleString("en-GB", { maximumFractionDigits: 2 })}`;
        return result(res.body as Record<string, unknown>, `Borrowing ${f(m.loan_amount)} (${m.ltv_pct}% loan to value) over ${Math.round(term)} years at ${rate}% is about ${f(m.monthly_payment)} a month on a repayment mortgage, ${f(m.total_interest)} in interest over the term. ` +
          "Say these are illustrative sums at a fixed rate, not advice or an offer; homemove_quote with \"mortgage\" gives homemove.com's mortgage service.");
      }
      if (request.params.name === "homemove_council_tax" && deps.homedata) {
        const postcode = typeof args["postcode"] === "string" ? args["postcode"].trim() : "";
        const address = typeof args["address"] === "string" ? args["address"].trim() : "";
        if (!/^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i.test(postcode) || !address) return result({ error: "invalid_request", detail: "address and postcode are required" }, "Ask for the first line of the address and the postcode.", true);
        let facts;
        try { facts = await deps.property.find(address, postcode); } catch (error) {
          if (error instanceof AddressNotMatched) return result({ error: "address_not_found", reason: error.reason }, "No single home matches that address and postcode. Ask for the house or flat number exactly as it appears on post.", true);
          throw error;
        }
        const res = await deps.homedata.send("GET", `/council_tax_band/${facts.uprn}/`);
        if (res.statusCode === 404) return result({ address: facts.address, available: false }, `There is no council tax band on record for ${facts.address}. Say so; the council can confirm it.`);
        if (res.statusCode >= 400) throw new Error(`council tax answered ${res.statusCode}`);
        const ct = res.body as { council_tax_band?: string; authority_name?: string };
        return result({ address: facts.address, postcode: facts.postcode, ...ct }, `${facts.address} is in council tax band ${ct.council_tax_band}${ct.authority_name ? ` with ${ct.authority_name} council` : ""}. Council tax is paid to the council, not Homemove; the council sets the bill for each band.`);
      }
      if (request.params.name === "homemove_find_address") {
        const query = typeof args["query"] === "string" ? args["query"].slice(0, 120) : "";
        const addresses = await deps.property.search(query);
        return result({ addresses }, `${addresses.length} addresses.`);
      }
      if (request.params.name === "homemove_services") {
        const type = typeof args["type"] === "string" ? args["type"] : undefined;
        const products = type === "legal" ? [] : (await deps.motus.products()).filter((p) => !p.is_addon && (!type || p.type === type) && ["surveys", "cleaning", "removals"].includes(p.type ?? "") && consumerProduct(p));
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
  };
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const started = Date.now();
    const answer = await handle(request);
    try {
      const tool = shownToolName(request.params.name);
      const args = (request.params.arguments ?? {}) as Record<string, unknown>;
      const failed = answer.isError && (answer.structuredContent as { available?: unknown } | undefined)?.available === false;
      deps.onToolCall?.({ tool, outcome: failed ? "failed" : outcomeOf(answer as never), ms: Date.now() - started,
        detail: callDetail(tool, args, answer.structuredContent as Record<string, unknown> | undefined), subject: request.params._meta?.["openai/subject"] });
    } catch {
      // Reporting never changes a tool call's answer.
    }
    return answer;
  });
  return server;
}
