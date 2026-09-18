/**
 * Thin HTTP client for the Homedata API.
 *
 * Mirrors the Python package's client: one request in, status, body and headers
 * out, and never throws for a failed call. An MCP client is better served by a
 * readable error body than by a transport exception.
 */
const DEFAULT_BASE_URL = "https://api.homedata.co.uk";
// The deepest property tiers assemble a lot of data; 10s was too tight for them.
const DEFAULT_TIMEOUT_MS = 30_000;

export class HomedataError extends Error {}

export interface ApiResponse {
  statusCode: number;
  body: unknown;
  headers: Headers;
}

export interface HomedataClientOptions {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  version?: string;
  /** Allowed for the free calculators, which answer without a key. */
  allowKeyless?: boolean;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

export class HomedataClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly userAgent: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: HomedataClientOptions) {
    if (!opts.apiKey && !opts.allowKeyless) {
      throw new HomedataError(
        "HOMEDATA_API_KEY is required. Get a key at https://homedata.co.uk/register",
      );
    }
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.userAgent = `homedata-mcp-node/${opts.version ?? "0.0.0"}`;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  static fromEnv(version?: string, allowKeyless = false): HomedataClient {
    return new HomedataClient({
      apiKey: (process.env["HOMEDATA_API_KEY"] ?? "").trim(),
      baseUrl: (process.env["HOMEDATA_BASE_URL"] ?? "").trim() || undefined,
      version,
      allowKeyless,
    });
  }

  async send(method: string, path: string, query: Record<string, string> = {}): Promise<ApiResponse> {
    const url = new URL(this.baseUrl + path);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) url.searchParams.set(key, value);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(url.toString(), {
        method,
        headers: {
          ...(this.apiKey ? { Authorization: `Api-Key ${this.apiKey}` } : {}),
          Accept: "application/json",
          "User-Agent": this.userAgent,
        },
        signal: controller.signal,
      });
      // Read the body ONCE: response.json() consumes the stream, so a later
      // response.text() on a non-JSON body rejects and the detail is lost.
      const text = await response.text().catch(() => "");
      let body: unknown;
      try {
        body = text === "" ? "" : JSON.parse(text);
      } catch {
        body = text;
      }
      if (!response.ok) {
        body = { error: "api_error", status_code: response.status, detail: body };
      }
      return { statusCode: response.status, body, headers: response.headers };
    } catch (err) {
      const timedOut = (err as Error).name === "AbortError";
      return {
        // 502, not 0: consumers classify >= 400 as a failure, and a request that
        // never reached the API must not read as success.
        statusCode: timedOut ? 504 : 502,
        body: timedOut
          ? { error: "timeout", status_code: 504, detail: `Homedata API did not respond within ${this.timeoutMs}ms` }
          : { error: "network_error", status_code: 502, detail: String(err) },
        headers: new Headers(),
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
