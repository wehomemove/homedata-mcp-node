/**
 * Public API of the package — re-exports the client and tool functions
 * so users can `import { HomedataClient, lookup_property } from "homedata-mcp"`
 * if they want to integrate the data layer directly into their own code.
 */

export { HomedataClient, HomedataError } from "./client.js";
export type { HomedataResponse } from "./client.js";
export * as tools from "./tools.js";

export const VERSION = "0.1.0";
