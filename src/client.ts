/**
 * Thin HTTP client for the Homedata API (Loki).
 * Mirrors the Python implementation 1:1 so both packages have identical behaviour.
 */

const DEFAULT_BASE_URL = "https://api.homedata.co.uk";
// 30s — the valuation/AVM endpoints run live comparable computation and can
// take well over 10s. Overridable via HOMEDATA_TIMEOUT_MS.
const DEFAULT_TIMEOUT_MS = 30_000;

export class HomedataError extends Error {}

export interface HomedataResponse {
  // success body OR { error, status_code, detail }
  [key: string]: unknown;
}

export class HomedataClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly userAgent: string;

  constructor(opts: { apiKey: string; baseUrl?: string; timeoutMs?: number; version?: string }) {
    if (!opts.apiKey) {
      throw new HomedataError(
        "HOMEDATA_API_KEY is required. Get a key at https://homedata.co.uk/developer",
      );
    }
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.userAgent = `homedata-mcp-node/${opts.version ?? "0.1.0"}`;
  }

  static fromEnv(version?: string): HomedataClient {
    const apiKey = (process.env.HOMEDATA_API_KEY ?? "").trim();
    const baseUrl = (process.env.HOMEDATA_BASE_URL ?? "").trim() || undefined;
    const rawTimeout = Number((process.env.HOMEDATA_TIMEOUT_MS ?? "").trim());
    const timeoutMs = Number.isFinite(rawTimeout) && rawTimeout > 0 ? rawTimeout : undefined;
    return new HomedataClient({ apiKey, baseUrl, timeoutMs, version });
  }

  async get(path: string, params?: Record<string, string | number | undefined>): Promise<HomedataResponse> {
    const url = new URL(this.baseUrl + path);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== null) {
          url.searchParams.set(k, String(v));
        }
      }
    }
    return this._request("GET", url.toString());
  }

  async post(path: string, body: unknown): Promise<HomedataResponse> {
    return this._request("POST", this.baseUrl + path, body);
  }

  private async _request(method: "GET" | "POST", url: string, body?: unknown): Promise<HomedataResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const resp = await fetch(url, {
        method,
        headers: {
          Authorization: `Api-Key ${this.apiKey}`,
          Accept: "application/json",
          "User-Agent": this.userAgent,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      let parsed: unknown;
      try {
        parsed = await resp.json();
      } catch {
        parsed = await resp.text().catch(() => "");
      }
      if (!resp.ok) {
        return { error: "api_error", status_code: resp.status, detail: parsed };
      }
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        return parsed as HomedataResponse;
      }
      return { data: parsed };
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        return {
          error: "timeout",
          status_code: 504,
          detail: `Homedata API did not respond within ${this.timeoutMs}ms`,
        };
      }
      return { error: "network_error", status_code: 0, detail: String(err) };
    } finally {
      clearTimeout(timer);
    }
  }
}
