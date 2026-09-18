/**
 * The two helpers that work before an API key exists.
 *
 * Both are declared in the manifest's static_tools with billable: false and
 * http_requests: [], and the parity check fails the build if either sends a
 * request. A helper whose job is "have you got a key?" must not spend the
 * user's tokens to answer, so the check reports what it can see locally and the
 * first real tool call is what proves the key.
 */
import { descriptionFor, tools } from "./manifest.js";

const SIGNUP_URL = "https://homedata.co.uk/register";
const API_KEYS_DASHBOARD_URL = "https://homedata.co.uk/developer/api-keys";
const PRICING_URL = "https://homedata.co.uk/pricing";
const DOCS_URL = "https://homedata.co.uk/docs";
const ENV_VAR = "HOMEDATA_API_KEY";

export const helperDescription = (name: string): string => descriptionFor(name);

export function startSignup(email?: string): Record<string, unknown> {
  return {
    product: "Homedata",
    what_it_is:
      "UK property data API: addresses and UPRNs, EPC, sale history, council tax, planning, " +
      "environmental risk, schools, broadband, crime and local area data.",
    signup_url: SIGNUP_URL,
    pricing_url: PRICING_URL,
    docs_url: DOCS_URL,
    api_key_dashboard_url: API_KEYS_DASHBOARD_URL,
    steps: [
      `1. Create an account at ${SIGNUP_URL}${email ? ` using ${email}` : ""}`,
      "2. Click the verification link in the email",
      `3. Copy the API key from ${API_KEYS_DASHBOARD_URL}`,
      `4. Set it in the environment: export ${ENV_VAR}='...'`,
      `5. Restart this MCP server; the ${tools().length} data tools then appear`,
    ],
    billing:
      "Calls are paid for in tokens from a prepaid balance; each tool's description states what it " +
      `costs. Current prices are at ${PRICING_URL}.`,
  };
}

export function checkApiKey(hasClient: boolean): Record<string, unknown> {
  const apiKey = (process.env[ENV_VAR] ?? "").trim();
  if (!apiKey) {
    return {
      configured: false,
      message: `${ENV_VAR} is not set, so only the signup helpers are available.`,
      next_step: "start_homedata_signup",
    };
  }
  if (!hasClient) {
    return {
      configured: true,
      key_prefix: `${apiKey.slice(0, 6)}…`,
      message: `${ENV_VAR} is set, but this server started before it was and is not using it.`,
      next_step: `Restart this MCP server to activate the ${tools().length} data tools.`,
    };
  }
  return {
    configured: true,
    key_prefix: `${apiKey.slice(0, 6)}…`,
    tools_available: tools().length,
    message:
      "A key is configured and the data tools are active. This check spends nothing; whether the " +
      "key is accepted is settled by the first real call.",
  };
}
