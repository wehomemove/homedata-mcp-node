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

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { buildRequest, InvalidArguments, inputSchema } from "./calls.js";
import { HomedataClient, HomedataError } from "./client.js";
import { VERSION } from "./index.js";
import { descriptionFor, paramTextFor, staticTools, tools, type ToolSpec } from "./manifest.js";
import { PROFILES, withoutPrice, type Profile } from "./profile.js";
import { checkApiKey, startSignup } from "./signup.js";
import { isMain } from "./entry.js";

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

/** A tool's description as this profile presents it. */
export function describe(name: string, profile: Profile): string {
  const text = profile.descriptions?.[name] ?? descriptionFor(name);
  return profile.prices ? text : withoutPrice(text);
}

/** The catalogue tools a profile exposes, in manifest order. */
export function profileTools(profile: Profile): ToolSpec[] {
  const wanted = profile.tools;
  return wanted === "all" ? tools() : tools().filter((t) => wanted.includes(t.name));
}

/**
 * ChatGPT descriptor fields. Every catalogue tool is a GET against a bounded
 * dataset: it reads, never writes, and does not reach the open internet.
 *
 * outputSchema: OpenAI asks for one wherever a tool returns structured data.
 * It says only what the API contract guarantees: the API's OpenAPI spec
 * publishes no typed response body for any curated tool ("Unspecified response
 * body" or none at all), and jsonResult always returns an object
 * (a non-object body is wrapped as { data }). A field list guessed beyond
 * that would make schema-validating clients reject real answers.
 */
function chatgptFields(spec: ToolSpec, securitySchemes: SecurityScheme[]): Record<string, unknown> {
  return {
    title: spec.label,
    outputSchema: {
      type: "object",
      additionalProperties: true,
      description: `${spec.label} from the Homedata API, as the API returns it.`,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    securitySchemes,
    _meta: { securitySchemes },
  };
}

export type SecurityScheme = { type: "noauth" } | { type: "oauth2"; scopes: string[] };

export interface BuildOptions {
  /** Declared on every ChatGPT tool. Default noauth (the server holds the key). */
  securitySchemes?: SecurityScheme[];
  /**
   * Signed-in mode with no signed-in user: tools are still listed (ChatGPT
   * lists anonymously), and a data tool call returns this result, which
   * carries the challenge that makes ChatGPT offer to connect the account.
   */
  signInRequired?: () => CallToolResult;
}

export function buildServer(
  client: HomedataClient | null,
  profile: Profile = PROFILES.stdio,
  options: BuildOptions = {},
): Server {
  const schemes = options.securitySchemes ?? [{ type: "noauth" }];
  const listsData = client !== null || options.signInRequired !== undefined;
  const server = new Server(
    { name: "homedata", version: VERSION },
    { capabilities: { tools: {} }, instructions: profile.instructions },
  );
  const exposed = profileTools(profile);

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      ...(listsData
        ? exposed.map((spec) => ({
            name: spec.name,
            description: describe(spec.name, profile),
            inputSchema: inputSchema(spec, paramTextFor(spec.name)),
            ...(profile.chatgptMetadata ? chatgptFields(spec, schemes) : {}),
          }))
        : []),
      ...(profile.signupHelpers
        ? staticTools().map((spec) => ({
            name: spec.name,
            description: descriptionFor(spec.name),
            inputSchema: HELPER_SCHEMAS[spec.name] ?? { type: "object", properties: {}, additionalProperties: false },
          }))
        : []),
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;
    const args = (request.params.arguments ?? {}) as Record<string, unknown>;

    if (profile.signupHelpers) {
      if (name === "start_homedata_signup") return jsonResult(startSignup(args["email"] as string | undefined));
      if (name === "check_homedata_api_key") return jsonResult(checkApiKey(client !== null));
    }

    const spec = listsData ? exposed.find((t) => t.name === name) : undefined;
    if (!spec) {
      return jsonResult({ error: "unknown_tool", detail: name }, true);
    }
    if (!client) return options.signInRequired!();

    let apiRequest;
    try {
      apiRequest = buildRequest(spec, args);
    } catch (err) {
      // Refused here: an invalid request can still be a charged one.
      if (err instanceof InvalidArguments) return jsonResult({ error: "invalid_arguments", detail: err.problems }, true);
      throw err;
    }

    const response = await client.send(apiRequest.method, apiRequest.path, apiRequest.query);
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

if (isMain(import.meta.url)) {
  main().catch((err) => {
    console.error("[homedata-mcp] fatal:", err);
    process.exit(1);
  });
}
