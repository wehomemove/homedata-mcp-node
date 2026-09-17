/**
 * Public API of the package, for embedding the data layer directly.
 *
 * The per-tool functions of 0.x are gone: tools are generated from the
 * manifest, so build a request with buildRequest(spec, args) instead.
 */
export { HomedataClient, HomedataError } from "./client.js";
export type { ApiResponse, HomedataClientOptions } from "./client.js";
export { buildRequest, InvalidArguments, inputSchema, validateArguments } from "./calls.js";
export type { ApiRequest } from "./calls.js";
export { MANIFEST, descriptionFor, paramTextFor, staticTools, tools } from "./manifest.js";
export type { Manifest, ToolSpec } from "./manifest.js";
export { buildServer } from "./server.js";

export const VERSION = "1.0.0";
