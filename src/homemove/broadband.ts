/**
 * Broadband deals at a postcode, as homemove.com's broadband comparison lists them
 * (motus GET /api/broadband/search, public). A deal opens through motus's click
 * endpoint, which records the click (source "chatgpt") and returns the provider
 * link with its tracking. Prices are the comparison's listed prices, never ours.
 */
export const DEFAULT_BROADBAND_BASE = "https://app.homemove.com/api/broadband";

export interface BroadbandDeal {
  id: number;
  provider: string;
  logo: string | null;
  name: string;
  download_mbps: number;
  upload_mbps: number;
  monthly_gbp: number;
  setup_gbp: number;
  contract_months: number | null;
  offer: string | null;
  landline: boolean;
  tv: boolean;
  features: string[];
}

export type BroadbandSort = "price" | "speed";

const POSTCODE = /^([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})$/i;
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

export class BroadbandClient {
  private readonly cache = new Map<string, { at: number; deals: BroadbandDeal[] }>();

  constructor(private readonly options: { baseUrl?: string; fetchImpl?: typeof fetch; now?: () => number } = {}) {}

  private get base() { return this.options.baseUrl ?? DEFAULT_BROADBAND_BASE; }
  private get fetch() { return this.options.fetchImpl ?? fetch; }

  /** Every deal listed as available at the postcode, cached ten minutes. */
  async deals(postcode: string): Promise<BroadbandDeal[]> {
    const pc = POSTCODE.exec(postcode.trim());
    if (!pc) throw new Error("postcode must be a full UK postcode");
    const key = `${pc[1]}${pc[2]}`.toUpperCase();
    const now = (this.options.now ?? Date.now)();
    const hit = this.cache.get(key);
    if (hit && now - hit.at < 600_000) return hit.deals;
    const res = await this.fetch(`${this.base}/search?postcode=${encodeURIComponent(key)}`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`broadband search answered ${res.status}`);
    const body = (await res.json()) as { products?: Array<Record<string, unknown>> };
    const deals = (body.products ?? []).flatMap((p): BroadbandDeal[] => {
      const id = num(p["id"]), monthly = num(p["monthlyCost"]), down = num(p["downloadSpeed"]);
      if (id === null || monthly === null || down === null || p["isAvailable"] === false) return [];
      const network = (p["network"] ?? {}) as { shortName?: unknown; logo?: unknown };
      return [{
        id, provider: String(network.shortName ?? ""), logo: typeof network.logo === "string" && network.logo.startsWith("https://cdn.homemove.com/") ? network.logo : null,
        name: String(p["name"] ?? ""),
        // The comparison stores speeds in Kbps (Mbps × 1024).
        download_mbps: Math.round(down / 1024), upload_mbps: Math.round((num(p["uploadSpeed"]) ?? 0) / 1024),
        monthly_gbp: monthly, setup_gbp: num(p["setupFee"]) ?? 0, contract_months: num(p["contractLength"]),
        offer: typeof p["offerText"] === "string" && p["offerText"].trim() ? p["offerText"].trim() : null,
        landline: p["landLine"] === true, tv: p["tv"] === true,
        features: Array.isArray(p["features"]) ? p["features"].filter((f): f is string => typeof f === "string").slice(0, 5) : [],
      }];
    });
    if (this.cache.size > 2000) this.cache.clear();
    this.cache.set(key, { at: now, deals });
    return deals;
  }

  /** The provider link for a deal, with the click recorded against ChatGPT. */
  async link(productId: number, postcode?: string): Promise<string> {
    const res = await this.fetch(`${this.base}/click`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ product_id: productId, source: "chatgpt-plugin", ...(postcode ? { postcode: postcode.slice(0, 10) } : {}), utm_source: "chatgpt-plugin", utm_medium: "referral", utm_campaign: "homemove-chatgpt-app" }),
      signal: AbortSignal.timeout(8000),
    });
    const body = (await res.json().catch(() => ({}))) as { outlink?: unknown };
    if (!res.ok || typeof body.outlink !== "string" || !/^https:\/\//.test(body.outlink)) throw new Error(`broadband click answered ${res.status}`);
    return body.outlink;
  }
}

/** Deals in the order asked, filtered; the cheapest or fastest first. */
export function pickDeals(deals: BroadbandDeal[], o: { sort?: BroadbandSort; min_mbps?: number; max_monthly_gbp?: number; limit?: number }): BroadbandDeal[] {
  const kept = deals.filter((d) => (!o.min_mbps || d.download_mbps >= o.min_mbps) && (!o.max_monthly_gbp || d.monthly_gbp <= o.max_monthly_gbp));
  const sorted = [...kept].sort((a, b) => o.sort === "speed" ? b.download_mbps - a.download_mbps || a.monthly_gbp - b.monthly_gbp : a.monthly_gbp - b.monthly_gbp || b.download_mbps - a.download_mbps);
  return o.limit === Infinity ? sorted : sorted.slice(0, o.limit ?? 30);
}
