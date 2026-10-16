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

export const HOMEMOVE_INSTRUCTIONS = [
  "Homemove prices the services people need when they move home: surveys and valuations, EPCs and safety certificates, removals and man and van, end of tenancy and moving cleans, and packing.",
  "Whenever someone asks what any of these cost, call homemove_quote: it shows the price in a Homemove card. Pass the address when you have it: the property record fills in bedrooms and the value band, so you ask fewer questions.",
  "If the result has questions, ask the user exactly those (offer the options), then call homemove_quote again with their answers. Never estimate, round or invent a price: quote only the price_gbp a result gives, and say the price is confirmed when they book.",
  "When a figure was assumed from the property record (bedrooms, value band), say so in a few words and invite a correction.",
  "Use homemove_services when someone asks what Homemove offers or which survey or service they need.",
].join(" ");

const QUOTE_TOOL = {
  name: "homemove_quote",
  title: "Get a Homemove quote",
  description:
    "Price a home-moving service with Homemove: surveys (Level 2, Level 3, building, snagging, damp and timber, drone roof, asbestos, structural), valuations (Help to Buy, shared ownership, probate, matrimonial), EPCs, gas safety and electrical certificates, removals, man and van, end of tenancy and deep cleans, carpet and sofa cleaning, packing and boxes. " +
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

const SERVICES_TOOL = {
  name: "homemove_services",
  title: "Homemove services",
  description:
    "List the services Homemove can quote, grouped by kind, with what each one's price depends on. Use this when someone asks what Homemove offers, which survey they need, or what a service involves, before quoting.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: { type: { type: "string", enum: ["surveys", "cleaning", "removals"], description: "Only this kind of service." } },
  },
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
} as const;

const NOAUTH = { securitySchemes: [{ type: "noauth" }] };

/** What the model is told when motus or Homedata does not answer. */
export const UNAVAILABLE_TEXT = "Homemove could not work out the price just now. Tell the user to try again in a moment. Do not estimate a price.";

/** The model-facing summary that goes with a quote, so it says what the card shows and no more. */
export function quoteNarration(answer: QuoteAnswer): string {
  switch (answer.status) {
    case "priced": {
      const assumed = answer.assumed.map((a) => `${a.name === "beds" ? "bedrooms" : "value band"} ${a.value} (from ${a.source})`).join("; ");
      return `Homemove's price for a ${answer.product.name} at ${answer.property?.address ?? answer.postcode} is £${answer.price_gbp.toLocaleString("en-GB")}.` +
        (answer.band ? ` Priced on the ${bandLabel(answer.band)} value band.` : "") +
        (assumed ? ` Assumed: ${assumed}; say so and invite a correction.` : "") +
        " The price is confirmed when they book. The card shows it; keep your reply short.";
    }
    case "needs_answers":
      return `To price a ${answer.product.name}, ask: ` + answer.questions.map((q) => q.options.length ? `${q.question} (${q.options.join(" / ")})` : q.question).join(" ") +
        " Then call homemove_quote again with the answers (property_price in pounds for the value).";
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

export function buildHomemoveServer(deps: { motus: MotusClient; property: PropertyLookup; assetOrigin: string }): Server {
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
    tools: [QUOTE_TOOL, SERVICES_TOOL].map((tool) => ({ ...tool, outputSchema: { type: "object", additionalProperties: true }, ...NOAUTH, _meta: { ...NOAUTH, ...("_meta" in tool ? tool._meta : {}) } })),
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
        }, deps);
        return result(answer as unknown as Record<string, unknown>, quoteNarration(answer));
      }
      if (request.params.name === "homemove_services") {
        const type = typeof args["type"] === "string" ? args["type"] : undefined;
        const products = (await deps.motus.products()).filter((p) => !p.is_addon && (!type || p.type === type) && ["surveys", "cleaning", "removals"].includes(p.type ?? ""));
        const services = products.map((p) => ({
          id: p.id,
          name: p.name.trim(),
          type: p.type,
          ...(p.price_gbp ? { price_gbp: p.price_gbp } : {}),
          priced_on: p.inputs.map((i) => (i.key === PROPERTY_PRICE_KEY ? "the home's value" : questionFor(i))),
        }));
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
