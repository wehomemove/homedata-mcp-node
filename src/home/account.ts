/**
 * Home's account tools: saved searches and price alerts on the user's own
 * home.co.uk account. atlas (home.co.uk) is both the OAuth server and the
 * owner of these tools; this endpoint lists them, so ChatGPT can show them
 * before sign-in, and forwards a signed-in call to atlas's MCP endpoint with
 * the caller's bearer token. atlas validates the token (its resource must be
 * this endpoint's origin) and runs the tool as that user.
 *
 * No token is checked, cached, stored or logged here: it is passed through
 * on one request to the configured atlas URL and nowhere else.
 *
 * Contract: atlas app/Services/Mcp/ConsumerMcpServer.php (tools, scopes,
 * errors) and app/Http/Middleware/McpApiAuthentication.php (401 on a token it
 * will not accept).
 */
import { HomeClient, HomeError } from "./client.js";

export const SAVED_SEARCHES_SCOPE = "home.saved-searches";
export const PRICE_ALERTS_SCOPE = "home.price-alerts";
export const ACCOUNT_SCOPES = [SAVED_SEARCHES_SCOPE, PRICE_ALERTS_SCOPE] as const;
type Scope = (typeof ACCOUNT_SCOPES)[number];

export const DEFAULT_RESOURCE = "https://mcp.home.co.uk";
export const DEFAULT_ISSUER = "https://home.co.uk";
export const DEFAULT_ACCOUNT_MCP_URL = "https://home.co.uk/api/mcp";

export interface AccountSettings {
  /** This endpoint's origin: the resource atlas binds its tokens to. */
  resource: string;
  /** atlas's OAuth issuer. */
  issuer: string;
  /** atlas's MCP endpoint, which runs the account tools. */
  accountMcpUrl: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  logger?: (message: string, detail: unknown) => void;
}

type Schema = Record<string, unknown>;
type Annotations = { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint?: boolean; openWorldHint: boolean };
export type AccountTool = { name: string; title: string; description: string; inputSchema: Schema; scope: Scope; annotations: Annotations };

const obj = (properties: Schema, required: string[] = []): Schema => ({
  type: "object", properties, additionalProperties: false, ...(required.length ? { required } : {}),
});
const id = (what: string): Schema => ({ type: "string", description: `The ${what} id returned by the matching list tool.` });
const paused: Schema = { type: "boolean", description: "True to pause, false to resume." };

// Reads change nothing; creating or pausing changes only the user's own account, and
// deleting cannot be undone. None of them reach anyone but the signed-in user.
const READ: Annotations = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
const CREATE: Annotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const PAUSE: Annotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const DELETE: Annotations = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false };

const PROPERTY_TYPES = ["detached", "semi_detached", "terraced", "flat"];

/**
 * The saved-search types atlas's SavedSearchRunner actually runs. It stores
 * `sold` but returns null from run() and newResults() for it, so a sold search
 * would never send an email or show a new result: it is neither advertised nor
 * forwarded.
 */
export const SAVED_SEARCH_TYPES = ["for_sale", "to_rent", "new_builds"] as const;

export const ACCOUNT_TOOLS: readonly AccountTool[] = [
  {
    name: "list_saved_searches", title: "List saved searches", scope: SAVED_SEARCHES_SCOPE, annotations: READ,
    description: "List the user's saved property searches on their home.co.uk account, with each search's id, criteria, email frequency, whether it is active and how many new results it has. Use this when someone asks about their saved searches or before pausing, deleting or reading one.",
    inputSchema: obj({}),
  },
  {
    name: "create_saved_search", title: "Save a search", scope: SAVED_SEARCHES_SCOPE, annotations: CREATE,
    description: "Save a property search to the user's home.co.uk account so home.co.uk emails them new matching homes. Use this when someone asks to save a search or be told about new homes matching it; confirm the area and filters with them first.",
    inputSchema: obj({
      name: { type: "string", maxLength: 255, description: "A short name the user will recognise, such as \"3-bed houses in Bath\"." },
      search_type: { type: "string", enum: [...SAVED_SEARCH_TYPES], description: "What to search: homes for sale, to rent, or new builds only. Defaults to for_sale." },
      search_criteria: obj({
        location: { type: "string", description: "Town, city, county or UK postcode, as given to search_homes." },
        min_price: { type: "integer", minimum: 0, description: "Minimum price in whole pounds." },
        max_price: { type: "integer", minimum: 0, description: "Maximum price in whole pounds." },
        min_beds: { type: "integer", minimum: 0, maximum: 10, description: "Minimum bedrooms." },
        max_beds: { type: "integer", minimum: 0, maximum: 10, description: "Maximum bedrooms." },
        property_type: { type: "array", items: { type: "string", enum: PROPERTY_TYPES }, uniqueItems: true, description: "Property types to include; leave out for all." },
      }, ["location"]),
      notification_frequency: { type: "string", enum: ["instant", "daily", "weekly", "never"], description: "How often home.co.uk emails new results. Defaults to daily." },
    }, ["name", "search_criteria"]),
  },
  {
    name: "pause_saved_search", title: "Pause or resume a saved search", scope: SAVED_SEARCHES_SCOPE, annotations: PAUSE,
    description: "Pause or resume one of the user's saved searches. A paused search sends no emails. Use this when someone wants a saved search to stop or start again without deleting it.",
    inputSchema: obj({ id: id("saved search"), paused }, ["id", "paused"]),
  },
  {
    name: "delete_saved_search", title: "Delete a saved search", scope: SAVED_SEARCHES_SCOPE, annotations: DELETE,
    description: "Permanently delete one of the user's saved searches. Use this only when someone asks to delete or remove a saved search; it cannot be undone.",
    inputSchema: obj({ id: id("saved search") }, ["id"]),
  },
  {
    name: "get_saved_search_new_results", title: "New results for a saved search", scope: SAVED_SEARCHES_SCOPE, annotations: READ,
    description: "Read the homes that are new for one of the user's saved searches. Use this when someone asks what is new on a saved search.",
    inputSchema: obj({ id: id("saved search") }, ["id"]),
  },
  {
    name: "list_price_alerts", title: "List price alerts", scope: PRICE_ALERTS_SCOPE, annotations: READ,
    description: "List the user's property alerts on their home.co.uk account, with each alert's id, home, starting and current asking price, alert type and whether it is active. Use this when someone asks about the homes they are watching or before pausing or deleting an alert.",
    inputSchema: obj({}),
  },
  {
    name: "create_price_alert", title: "Watch a home", scope: PRICE_ALERTS_SCOPE, annotations: CREATE,
    description: "Watch one home so home.co.uk emails the user when its asking price or listing status changes. Use this when someone asks to be told if a home from search_homes or get_home is reduced, goes under offer or comes back on the market. Only one alert per home.",
    inputSchema: obj({
      property_id: { type: "string", description: "The listing id from search_homes or get_home." },
      uprn: { type: "string", description: "The home's UPRN when get_home returned one." },
      address: { type: "string", maxLength: 500, description: "The home's address as search_homes or get_home gave it." },
      current_price_pounds: { type: "integer", minimum: 0, description: "The current asking price in whole pounds, as search_homes or get_home gave it, for example 350000 for £350,000." },
      alert_type: { type: "string", enum: ["price_drop", "price_increase", "any_change", "back_on_market", "sold_stc", "reduced"], description: "What to be told about. Defaults to any_change." },
      threshold_percent: { type: "number", minimum: 0, maximum: 100, description: "Only alert on a change of at least this percentage." },
    }, ["property_id", "address", "current_price_pounds"]),
  },
  {
    name: "pause_price_alert", title: "Pause or resume a price alert", scope: PRICE_ALERTS_SCOPE, annotations: PAUSE,
    description: "Pause or resume one of the user's property alerts. A paused alert sends no emails. Use this when someone wants to stop or restart watching a home without deleting the alert.",
    inputSchema: obj({ id: id("alert"), paused }, ["id", "paused"]),
  },
  {
    name: "delete_price_alert", title: "Delete a price alert", scope: PRICE_ALERTS_SCOPE, annotations: DELETE,
    description: "Permanently delete one of the user's property alerts. Use this only when someone asks to stop watching a home for good; it cannot be undone.",
    inputSchema: obj({ id: id("alert") }, ["id"]),
  },
];

const BY_NAME = new Map(ACCOUNT_TOOLS.map((tool) => [tool.name, tool]));
export const isAccountTool = (name: unknown): boolean => typeof name === "string" && BY_NAME.has(name);

/** atlas's McpToolException text for a token without the tool's scope. */
const MISSING_SCOPE = "This connection has not been granted the required permission.";

/** Where this endpoint publishes its protected-resource metadata (RFC 9728). */
export function resourceMetadataUrl(resource: string): string {
  return new URL("/.well-known/oauth-protected-resource", resource).toString();
}

/** RFC 9728 metadata: sign the user in at home.co.uk for these scopes. */
export function protectedResourceMetadata(settings: Pick<AccountSettings, "resource" | "issuer">): Record<string, unknown> {
  return {
    resource: settings.resource,
    authorization_servers: [settings.issuer],
    scopes_supported: [...ACCOUNT_SCOPES],
    bearer_methods_supported: ["header"],
  };
}

/**
 * The WWW-Authenticate challenge ChatGPT reads to start or repeat sign-in.
 * scope leads, as in src/auth.ts, so secret scanners do not read the line as
 * a bearer credential.
 */
export function challengeHeader(resource: string, scope: string, error: { code: string; description: string }): string {
  return [
    `Bearer scope="${scope}"`,
    `resource_metadata="${resourceMetadataUrl(resource)}"`,
    `error="${error.code}"`,
    `error_description="${error.description}"`,
  ].join(", ");
}

export type AccountOutcome =
  | { kind: "result"; body: unknown; isError: boolean }
  /** refused: atlas turned down the token the caller sent, so the HTTP answer is a 401 too. */
  | { kind: "sign-in"; challenge: string; message: string; refused: boolean }
  | { kind: "unavailable" };

/**
 * Whether atlas refused the token itself. atlas answers 401 for a token that is
 * unknown, revoked, expired or bound to another resource; a 401 or 403 whose
 * challenge says insufficient_scope is a missing permission. Anything else,
 * including a 404 while atlas's Socket surface is off or a 403 with no
 * challenge (such as a Cloudflare block), is an outage and never signs out.
 */
function refusedAs(response: Response): "invalid_token" | "insufficient_scope" | null {
  const challenge = response.headers.get("www-authenticate") ?? "";
  const code = /\berror="?([a-z_]+)"?/i.exec(challenge)?.[1]?.toLowerCase();
  if (response.status === 401) return code === "insufficient_scope" ? "insufficient_scope" : "invalid_token";
  if (response.status === 403 && (code === "insufficient_scope" || code === "invalid_token")) return code;
  return null;
}

type JsonObject = Record<string, unknown>;
const object = (value: unknown): JsonObject => value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};

export class AccountTools {
  private readonly fetchImpl: typeof fetch;
  private readonly logger: (message: string, detail: unknown) => void;

  constructor(readonly settings: AccountSettings, private readonly home: HomeClient) {
    this.fetchImpl = settings.fetchImpl ?? fetch;
    this.logger = settings.logger ?? ((message, detail) => console.error(message, detail));
  }

  private signIn(tool: AccountTool, code: "invalid_token" | "insufficient_scope", description: string, message: string, refused = true): AccountOutcome {
    return { kind: "sign-in", challenge: challengeHeader(this.settings.resource, tool.scope, { code, description }), message, refused };
  }

  private expired(tool: AccountTool): AccountOutcome {
    return this.signIn(tool, "invalid_token", "Your home.co.uk connection has expired. Sign in again.", "Your home.co.uk connection has expired. Sign in again to use this tool.");
  }

  private missingScope(tool: AccountTool): AccountOutcome {
    return this.signIn(tool, "insufficient_scope", `Allow ${tool.scope} on home.co.uk to continue.`, "This home.co.uk connection does not include that permission. Sign in again and allow it.");
  }

  /** Runs one account tool for the bearer token the caller sent, or asks them to sign in. */
  async call(name: string, args: Record<string, unknown>, token: string | null): Promise<AccountOutcome> {
    const tool = BY_NAME.get(name);
    if (!tool) throw new Error(`not an account tool: ${name}`);
    if (token === null) {
      return this.signIn(tool, "invalid_token", "Sign in to home.co.uk to continue.", "Sign in to your home.co.uk account to use this tool.", false);
    }

    let forwarded: Record<string, unknown> = args;
    let area: unknown;
    if (name === "create_saved_search") {
      ({ forwarded, area } = await this.withArea(args));
    }

    let response: Response;
    let answer: JsonObject;
    try {
      response = await this.fetchImpl(this.settings.accountMcpUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json", "User-Agent": "home-chatgpt-app/1.0" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: forwarded } }),
        signal: AbortSignal.timeout(this.settings.timeoutMs ?? 15_000),
      });
      const refusal = refusedAs(response);
      if (refusal === "insufficient_scope") return this.missingScope(tool);
      if (refusal === "invalid_token") return this.expired(tool);
      if (!response.ok) {
        this.logger(`Home account request failed: ${name}`, { statusCode: response.status });
        return { kind: "unavailable" };
      }
      answer = object(await response.json());
    } catch (error) {
      // The error names the URL and the cause, never the request headers.
      this.logger(`Home account request failed: ${name}`, error instanceof Error ? error.name : "error");
      return { kind: "unavailable" };
    }

    const result = object(answer["result"]);
    const content = Array.isArray(result["content"]) ? result["content"] : [];
    const text = object(content[0])["text"];
    if (answer["error"] !== undefined || typeof text !== "string") {
      this.logger(`Home account request returned no result: ${name}`, { error: object(answer["error"])["code"] ?? null });
      return { kind: "unavailable" };
    }
    let body: unknown;
    try { body = JSON.parse(text); } catch { body = { message: text }; }
    const isError = result["isError"] === true;
    if (isError && object(body)["error"] === MISSING_SCOPE) return this.missingScope(tool);
    if (!isError && area !== undefined) body = { ...object(body), area };
    return { kind: "result", body, isError };
  }

  /** Validates create_saved_search's criteria and adds where it should look. */
  private async withArea(args: Record<string, unknown>): Promise<{ forwarded: Record<string, unknown>; area: unknown }> {
    const type = args["search_type"];
    if (type !== undefined && !(SAVED_SEARCH_TYPES as readonly unknown[]).includes(type)) {
      throw new HomeError(`search_type must be one of ${SAVED_SEARCH_TYPES.join(", ")}; sold-price searches cannot be saved`);
    }
    const criteria = object(args["search_criteria"]);
    const location = criteria["location"];
    if (typeof location !== "string") throw new HomeError("search_criteria.location is required");
    const resolved = await this.home.savedSearchArea(location, args["search_type"] === "to_rent");
    const { area_name: area, ...where } = resolved;
    const kept = Object.fromEntries(["min_price", "max_price", "min_beds", "max_beds", "property_type"]
      .filter((key) => criteria[key] !== undefined).map((key) => [key, criteria[key]]));
    return { forwarded: { ...args, search_criteria: { ...kept, ...where } }, area };
  }
}

