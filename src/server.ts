#!/usr/bin/env node
/**
 * MCP server entry point.
 *
 * Every data tool is built from the vendored manifest (src/manifest/): the
 * tools are exactly the endpoints the Homedata Developer Playground offers, with
 * the same names, arguments and token prices as the Python package. There is no
 * hand-written tool here; a hand-written one that matched the manifest today
 * would be a divergence waiting to happen.
 *
 * Auth: reads HOMEDATA_API_KEY from the environment. The MCP runs locally on the
 * user's machine, so their property queries never go through the AI vendor.
 * Without a key the server still starts and offers the two signup helpers.
 */
import { pathToFileURL } from "node:url";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

import { buildRequest, InvalidArguments, inputSchema } from "./calls.js";
import { HomedataClient, HomedataError } from "./client.js";
import { VERSION } from "./index.js";
import { descriptionFor, paramTextFor, staticTools, tools } from "./manifest.js";
import { checkApiKey, startSignup } from "./signup.js";

const INSTRUCTIONS = [
  "Homedata answers questions about UK property: addresses and UPRNs, EPC, council tax, sale history,",
  "planning, environmental risk, schools, broadband, crime, local amenities and area statistics.",
  "",
  "Start with `address_find` to turn an address into a UPRN, then use the UPRN tools. Postcode and",
  "outcode tools cover the surrounding area.",
  "",
  "For a whole property, prefer one tier call over many small ones: `property_base` for the basics,",
  "`property_core` for the usual full picture, `property_complete` for everything. `property_discovery`",
  "costs 1 token and shows what a property has before you commit.",
  "",
  "Calls are paid for in tokens from a prepaid balance. Each tool's description states its price, and a",
  "call reports what it actually cost in its `homedata.tokens_charged` metadata.",
].join("\n");

const HELPER_SCHEMAS: Record<string, Record<string, unknown>> = {
  start_homedata_signup: {
    type: "object",
    properties: { email: { type: "string", description: "Optional. The email address to sign up with." } },
    additionalProperties: false,
  },
  check_homedata_api_key: { type: "object", properties: {}, additionalProperties: false },
};

/** What the API says a call cost, when it says so. */
function spendMeta(headers: Headers): Record<string, unknown> | undefined {
  const spend: Record<string, string> = {};
  const charged = headers.get("X-Tokens-Charged");
  const balance = headers.get("X-Tokens-Balance");
  if (charged !== null) spend["tokens_charged"] = charged;
  if (balance !== null) spend["tokens_balance"] = balance;
  return Object.keys(spend).length ? { homedata: spend } : undefined;
}

export function buildServer(client: HomedataClient | null): Server {
  const server = new Server(
    { name: "homedata", version: VERSION },
    { capabilities: { tools: {} }, instructions: INSTRUCTIONS },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      ...(client
        ? tools().map((spec) => ({
            name: spec.name,
            description: descriptionFor(spec.name),
            inputSchema: inputSchema(spec, paramTextFor(spec.name)),
          }))
        : []),
      ...staticTools().map((spec) => ({
        name: spec.name,
        description: descriptionFor(spec.name),
        inputSchema: HELPER_SCHEMAS[spec.name] ?? { type: "object", properties: {}, additionalProperties: false },
      })),
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;
    const args = (request.params.arguments ?? {}) as Record<string, unknown>;

    if (name === "start_homedata_signup") return jsonResult(startSignup(args["email"] as string | undefined));
    if (name === "check_homedata_api_key") return jsonResult(checkApiKey(client !== null));

    const spec = client ? tools().find((t) => t.name === name) : undefined;
    if (!spec) {
      return jsonResult({ error: "unknown_tool", detail: name }, true);
    }

    let apiRequest;
    try {
      apiRequest = buildRequest(spec, args);
    } catch (err) {
      // Refused here: an invalid request can still be a charged one.
      if (err instanceof InvalidArguments) return jsonResult({ error: "invalid_arguments", detail: err.problems }, true);
      throw err;
    }

    const response = await client!.send(apiRequest.method, apiRequest.path, apiRequest.query);
    return jsonResult(response.body, response.statusCode >= 400, spendMeta(response.headers));
  });

  return server;
}

function jsonResult(body: unknown, isError = false, meta?: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(body, null, 2) }],
    structuredContent: body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : { data: body },
    ...(meta ? { _meta: meta } : {}),
    ...(isError ? { isError: true } : {}),
  };
}

async function main(): Promise<void> {
  let client: HomedataClient | null = null;
  try {
    client = HomedataClient.fromEnv(VERSION);
  } catch (err) {
    if (!(err instanceof HomedataError)) throw err;
    console.error(
      "homedata-mcp: HOMEDATA_API_KEY is not set, so only start_homedata_signup and " +
        "check_homedata_api_key are available. Set the key and restart this server to activate the " +
        `${tools().length} data tools.`,
    );
  }
  await buildServer(client).connect(new StdioServerTransport());
}

// pathToFileURL, not a hand-built file:// string: that breaks on Windows paths and
// on paths containing spaces or #, and the server would exit without connecting.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error("[homedata-mcp] fatal:", err);
    process.exit(1);
  });
}
