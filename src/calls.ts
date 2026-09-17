/**
 * Turning manifest tool specs into validated API calls.
 *
 * A port of the Python package's homedata_mcp/calls.py, so both servers send
 * the same request for the same arguments. Everything here is pure; the MCP
 * server and the CLI share it.
 *
 * Arguments are validated BEFORE a request is built. An invalid call must never
 * reach the API, because a rejected request can still be a charged one. The MCP
 * SDK does not validate arguments against a tool's inputSchema (measured), so
 * this is the only check there is.
 */
import type { ToolParam, ToolSpec } from "./manifest.js";

export class InvalidArguments extends Error {
  constructor(public readonly problems: string[]) {
    super(problems.join("; "));
    this.name = "InvalidArguments";
  }
}

export interface ApiRequest {
  method: string;
  path: string;
  query: Record<string, string>;
}

export const asQueryValue = (value: unknown): string =>
  typeof value === "number" && Number.isInteger(value) ? String(value) : String(value);

function typeProblem(param: ToolParam, value: unknown): string | null {
  if (typeof value === "boolean") return `${param.name} must be a ${param.type}`;
  if (param.type === "number") return typeof value === "number" ? null : `${param.name} must be a number`;
  return typeof value === "string" ? null : `${param.name} must be a string`;
}

export function validateArguments(spec: ToolSpec, args: Record<string, unknown>): Record<string, unknown> {
  const params = new Map(spec.params.map((p) => [p.name, p]));
  const problems: string[] = [];

  for (const name of Object.keys(args).sort()) {
    if (!params.has(name)) problems.push(`unknown argument ${name}`);
  }

  const supplied: Record<string, unknown> = {};
  for (const [name, param] of params) {
    const value = args[name];
    if (value === undefined || value === null || value === "") {
      if (param.required) problems.push(`${name} is required`);
      continue;
    }
    const problem = typeProblem(param, value);
    if (problem) {
      problems.push(problem);
      continue;
    }
    const text = asQueryValue(value);
    if (param.enum && !param.enum.includes(text)) {
      problems.push(`${name} must be one of: ${param.enum.join(", ")}`);
      continue;
    }
    if (param.pattern === "^\\d+$" && !/^\d+$/.test(text)) {
      problems.push(`${name} must be digits only`);
      continue;
    }
    supplied[name] = value;
  }

  if (problems.length) throw new InvalidArguments(problems);
  return supplied;
}

export function buildRequest(spec: ToolSpec, args: Record<string, unknown>): ApiRequest {
  const supplied = validateArguments(spec, args);
  let path = spec.path;
  const query: Record<string, string> = {};

  for (const param of spec.params) {
    if (!(param.name in supplied)) continue;
    const text = asQueryValue(supplied[param.name]);
    if (param.in === "path") path = path.replace(`{${param.name}}`, encodeURIComponent(text));
    else query[param.name] = text;
  }

  for (const rule of spec.path_rules ?? []) {
    const value = supplied[rule.param];
    if (typeof value === "string" && value.startsWith(rule.prefix)) {
      path = rule.path.replace("{suffix}", encodeURIComponent(value.slice(rule.prefix.length)));
      delete query[rule.param];
    }
  }

  return { method: spec.method, path, query };
}

/** The JSON Schema an MCP client sees for a tool's arguments. */
export function inputSchema(spec: ToolSpec, paramText: Record<string, string>): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const param of spec.params) {
    const property: Record<string, unknown> = { type: param.type };
    if (param.enum) property["enum"] = [...param.enum];
    if (param.pattern) property["pattern"] = param.pattern;
    if (paramText[param.name]) property["description"] = paramText[param.name];
    properties[param.name] = property;
    if (param.required) required.push(param.name);
  }
  return {
    type: "object",
    properties,
    additionalProperties: false,
    ...(required.length ? { required } : {}),
  };
}
