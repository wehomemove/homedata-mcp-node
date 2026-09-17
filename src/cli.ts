#!/usr/bin/env node
/**
 * homedata — command line interface.
 *
 * Built from the same manifest as the MCP tools, so a command and its tool
 * cannot drift apart: same names, same arguments, same requests, same prices.
 *
 *   homedata tools                              list the tools and their prices
 *   homedata address_find --q "10 Downing St"   run one
 *   homedata property_core --uprn 100023336956 --field epc
 *
 * Reads HOMEDATA_API_KEY from the environment. The calculators need no key.
 */
import { buildRequest, InvalidArguments } from "./calls.js";
import { HomedataClient, HomedataError } from "./client.js";
import { VERSION } from "./index.js";
import { descriptionFor, paramTextFor, tools, type ToolSpec, type ToolTokens } from "./manifest.js";

export function price(tokens: ToolTokens): string {
  if (tokens.plus_with_addons) return `${tokens.default} + add-ons`;
  if (tokens.default === 0) return "free";
  const rules = (tokens.when ?? []).map((w) => `, ${w.tokens} when ${w.param}=${w.in.join("/")}`).join("");
  return `${tokens.default}${rules}`;
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

function parseFlags(argv: string[]): Record<string, string | boolean> {
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const item = argv[i]!;
    if (!item.startsWith("--")) continue;
    const key = item.slice(2).replace(/-/g, "_");
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) flags[key] = true;
    else {
      flags[key] = next;
      i++;
    }
  }
  return flags;
}

function usage(): string {
  const lines = ["homedata <tool> [--argument value]", "", "Tools:"];
  for (const spec of tools()) lines.push(`  ${spec.name.padEnd(24)} ${price(spec.tokens).padStart(14)} tokens`);
  lines.push("", "  tools                     list every tool with its description", "",
    "Options: --field <dotted.path>, --compact, --version");
  return lines.join("\n");
}

function argumentsFor(spec: ToolSpec, flags: Record<string, string | boolean>): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  for (const param of spec.params) {
    const value = flags[param.name];
    if (value === undefined || value === true) continue;
    args[param.name] = param.type === "number" ? Number(value) : value;
  }
  return args;
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const command = argv[0];
  const flags = parseFlags(argv);

  if (!command || command === "--help" || command === "-h" || command === "help") {
    console.log(usage());
    return command ? 0 : 1;
  }
  if (command === "--version") {
    console.log(`homedata ${VERSION}`);
    return 0;
  }
  if (command === "tools") {
    const listing = tools().map((spec) => ({
      tool: spec.name,
      tokens: price(spec.tokens),
      description: descriptionFor(spec.name),
    }));
    console.log(format(listing, flags["compact"] === true));
    return 0;
  }

  const spec = tools().find((t) => t.name === command);
  if (!spec) {
    console.error(`homedata: unknown tool "${command}". Run "homedata tools" for the list.`);
    return 2;
  }
  if (flags["help"] === true) {
    const text = paramTextFor(spec.name);
    console.log([
      `${spec.name} — ${descriptionFor(spec.name)}`,
      "",
      ...spec.params.map((p) => `  --${p.name.replace(/_/g, "-")}${p.required ? " (required)" : ""}  ${text[p.name] ?? ""}`),
    ].join("\n"));
    return 0;
  }

  let request;
  try {
    request = buildRequest(spec, argumentsFor(spec, flags));
  } catch (err) {
    if (!(err instanceof InvalidArguments)) throw err;
    console.error(`homedata: ${err.message}`);
    return 2;
  }

  const free = spec.tokens.default === 0 && !spec.tokens.when;
  let client: HomedataClient;
  try {
    client = HomedataClient.fromEnv(VERSION, free);
  } catch (err) {
    if (!(err instanceof HomedataError)) throw err;
    console.error(`homedata: ${err.message}`);
    return 2;
  }

  const response = await client.send(request.method, request.path, request.query);
  console.log(format(response.body, flags["compact"] === true, typeof flags["field"] === "string" ? flags["field"] : undefined));
  const charged = response.headers.get("X-Tokens-Charged");
  if (charged !== null) {
    const balance = response.headers.get("X-Tokens-Balance");
    console.error(`tokens charged: ${charged}${balance ? ` (balance ${balance})` : ""}`);
  }
  return response.statusCode < 400 ? 0 : 1;
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().then((code) => process.exit(code)).catch((err) => {
    console.error("[homedata] fatal:", err);
    process.exit(1);
  });
}
