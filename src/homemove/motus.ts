/**
 * Homemove pricing, through motus's Bookings MCP API (/api/mcp/bookings/*).
 * Every price comes from motus, computed the way homemove.com prices a lead;
 * this client never works one out. The bearer identifies one principal
 * (agent:chatgpt-homemove) whose product scope, op allow-list, rate limit and
 * kill switch live in motus (hm_mcp_principals), and every call is audited there.
 */

export interface PricingOption { value: string; label: string }
export interface PricingInput { key: number; name: string; options: PricingOption[] }
export interface MotusProduct {
  id: number;
  name: string;
  type: string | null;
  is_addon: boolean;
  pricing: string | null;
  price_gbp: number | null;
  inputs: PricingInput[];
}
export interface MotusQuote {
  product: { id: number; name: string; type: string | null } | null;
  postcode: string;
  price_gbp: number | null;
  pricing_basis: string;
  from: boolean;
  property_price_band: { id: number; min: number; max: number } | null;
  bands: Array<{ band_id: number; min: number; max: number; price_gbp: number }>;
  needs: PricingInput[];
  price_is_final: boolean;
  coverage_checked: boolean;
}

/** A refusal motus gave for a reason the caller can act on (invalid_answer, quote_unavailable…). */
export class MotusRefusal extends Error {
  constructor(readonly code: string, readonly status: number) { super(code); }
}

export interface MotusOptions {
  bearer: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** How long the product list is reused. Prices still come fresh from get_quote. */
  catalogueTtlMs?: number;
  now?: () => number;
}

export const DEFAULT_MOTUS_BASE_URL = "https://app.homemove.com";

export class MotusClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private catalogue: { at: number; products: MotusProduct[] } | null = null;

  constructor(private readonly options: MotusOptions) {
    if (!options.bearer) throw new Error("HOMEMOVE_MCP_BEARER is required");
    this.baseUrl = (options.baseUrl ?? DEFAULT_MOTUS_BASE_URL).replace(/\/+$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
  }

  async products(): Promise<MotusProduct[]> {
    const ttl = this.options.catalogueTtlMs ?? 10 * 60_000;
    if (this.catalogue && this.now() - this.catalogue.at < ttl) return this.catalogue.products;
    const data = await this.post<{ products: MotusProduct[] }>("/api/mcp/bookings/products", {});
    this.catalogue = { at: this.now(), products: data.products };
    return data.products;
  }

  async quote(input: { productId: number; postcode: string; propertyPrice?: number; answers?: Record<string, string> }): Promise<MotusQuote> {
    return this.post<MotusQuote>("/api/mcp/bookings/quote", {
      product_id: input.productId,
      postcode: input.postcode,
      ...(input.propertyPrice ? { property_price: Math.round(input.propertyPrice) } : {}),
      ...(input.answers && Object.keys(input.answers).length ? { answers: input.answers } : {}),
    });
  }

  private async post<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 15_000);
    try {
      const response = await this.fetchImpl(this.baseUrl + path, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.options.bearer}`, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const json = (await response.json().catch(() => null)) as { success?: boolean; data?: T; error?: string } | null;
      if (response.ok && json?.success && json.data !== undefined) return json.data;
      if (json?.error && response.status < 500) throw new MotusRefusal(json.error, response.status);
      throw new Error(`motus ${path} answered ${response.status}`);
    } finally {
      clearTimeout(timer);
    }
  }
}
