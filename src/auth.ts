/**
 * Sign-in for the remote endpoint: ChatGPT links the user's Homedata account
 * through thor's OAuth server and sends a bearer token on every MCP call. This
 * module checks that token with thor's introspection route and returns the
 * user's organisation key, so each call charges the user's own wallet.
 *
 * Contract: https://developers.openai.com/plugins/build/auth (resource server
 * side) and thor's app/Http/Controllers/OAuth/IntrospectController.php.
 */
import { createHash } from "node:crypto";

export const SCOPE = "homedata.read";

export interface OAuthSettings {
  /** This server's canonical resource identifier; must match thor's OAUTH_RESOURCES exactly. */
  resource: string;
  /** thor's issuer, exactly as its metadata states it. */
  issuer: string;
  introspectionUrl: string;
  introspectionSecret: string;
}

export type TokenCheck =
  | { ok: true; apiKey: string; subject: string }
  | { ok: false; reason: "invalid" }
  | { ok: false; reason: "unavailable" };

interface Introspection {
  active?: boolean;
  iss?: string;
  aud?: string;
  scope?: string;
  exp?: number;
  sub?: string;
  homedata_api_key?: string;
}

const CACHE_SECONDS = 60;
const CACHE_MAX_ENTRIES = 1000;

/**
 * Checks bearer tokens against thor. An active answer is cached for up to a
 * minute (never past the token's expiry), so revocation reaches us within a
 * minute. Inactive answers are not cached. thor being unreachable is
 * "unavailable", not "invalid": an outage must not tell ChatGPT to sign the
 * user out.
 */
export class Introspector {
  private readonly cache = new Map<string, { result: TokenCheck & { ok: true }; until: number }>();

  constructor(
    private readonly settings: OAuthSettings,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  async check(token: string): Promise<TokenCheck> {
    const key = createHash("sha256").update(token).digest("hex");
    const hit = this.cache.get(key);
    if (hit && hit.until > this.now()) return hit.result;
    this.cache.delete(key);

    let answer: Introspection;
    try {
      const response = await this.fetchImpl(this.settings.introspectionUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.settings.introspectionSecret}`,
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: new URLSearchParams({ token }).toString(),
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) return { ok: false, reason: "unavailable" };
      answer = (await response.json()) as Introspection;
    } catch {
      return { ok: false, reason: "unavailable" };
    }

    const nowSeconds = this.now() / 1000;
    const valid =
      answer.active === true &&
      answer.iss === this.settings.issuer &&
      answer.aud === this.settings.resource &&
      typeof answer.scope === "string" &&
      answer.scope.split(" ").includes(SCOPE) &&
      typeof answer.exp === "number" &&
      answer.exp > nowSeconds &&
      typeof answer.homedata_api_key === "string" &&
      answer.homedata_api_key !== "";
    if (!valid) return { ok: false, reason: "invalid" };

    const result = { ok: true as const, apiKey: answer.homedata_api_key!, subject: String(answer.sub ?? "") };
    if (this.cache.size >= CACHE_MAX_ENTRIES) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(key, { result, until: Math.min(this.now() + CACHE_SECONDS * 1000, answer.exp! * 1000) });
    return result;
  }
}

/** Where this server publishes its protected-resource metadata (RFC 9728). */
export function resourceMetadataUrl(resource: string): string {
  return new URL("/.well-known/oauth-protected-resource", resource).toString();
}

/** RFC 9728 protected-resource metadata: tells ChatGPT to sign the user in at thor. */
export function protectedResourceMetadata(settings: OAuthSettings): Record<string, unknown> {
  return {
    resource: settings.resource,
    authorization_servers: [settings.issuer],
    scopes_supported: [SCOPE],
    bearer_methods_supported: ["header"],
    resource_documentation: "https://homedata.co.uk/docs/mcp",
  };
}

/**
 * The WWW-Authenticate challenge ChatGPT reads to start or repeat sign-in.
 * scope comes first: auth-param order carries no meaning (RFC 6750), and
 * leading with resource_metadata makes the line look like a bearer
 * credential to secret scanners.
 */
export function challengeHeader(resource: string, error?: { code: string; description: string }): string {
  const parts = [`Bearer scope="${SCOPE}"`, `resource_metadata="${resourceMetadataUrl(resource)}"`];
  if (error) parts.push(`error="${error.code}"`, `error_description="${error.description}"`);
  return parts.join(", ");
}
