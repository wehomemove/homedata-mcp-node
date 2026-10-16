import type { HomedataClient } from "../client.js";

/**
 * What an address tells a quote, from Homedata. Two lookups by default: the
 * address match (5 tokens) and the rooms add-on (1 token). The value estimate
 * lives in the 25-token core record, so it is fetched only when a product is
 * priced on the value band and the person has not said what the home is worth.
 */
export interface PropertyFacts {
  uprn: string;
  address: string;
  postcode: string;
  /** Recorded bedrooms, or Homedata's prediction when none is recorded. */
  bedrooms: number | null;
  bedrooms_source: "recorded" | "predicted" | null;
  /** A value estimate, used only to choose a price band, never quoted as a valuation. */
  estimated_value: number | null;
}

export class AddressNotMatched extends Error {
  constructor(readonly reason: string) { super(reason); }
}

const num = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null);

export class PropertyLookup {
  private readonly cache = new Map<string, { at: number; facts: PropertyFacts }>();

  constructor(private readonly homedata: HomedataClient, private readonly now: () => number = Date.now) {}

  async find(address: string, postcode: string): Promise<PropertyFacts> {
    const key = `${address.trim().toLowerCase()}|${postcode.replace(/\s+/g, "").toUpperCase()}`;
    const hit = this.cache.get(key);
    if (hit && this.now() - hit.at < 24 * 3600_000) return hit.facts;

    const match = await this.homedata.send("GET", "/address/match/", { address, postcode });
    if (match.statusCode === 422 || match.statusCode === 404) {
      // Homedata answers 422 {"reason":"no_match"|"multiple_matches"}.
      const code = (match.body as { reason?: string } | null)?.reason ?? "no_match";
      throw new AddressNotMatched(code);
    }
    if (match.statusCode >= 400) throw new Error(`Homedata address match answered ${match.statusCode}`);
    const record = match.body as Record<string, unknown>;
    const uprn = String(record["uprn"] ?? "");
    if (!/^\d+$/.test(uprn)) throw new AddressNotMatched("no_match");

    const extra = await this.homedata.send("GET", `/property/${uprn}/`, { with: "rooms" });
    const rooms = (extra.statusCode < 400 ? (extra.body as { rooms?: Record<string, unknown> })?.rooms : undefined) ?? {};
    const recorded = num(rooms["bedrooms"]), predicted = num(rooms["predicted_bedrooms"]);

    const facts: PropertyFacts = {
      uprn,
      address: String(record["full_address"] ?? record["address"] ?? address),
      postcode: String(record["postcode"] ?? postcode).toUpperCase(),
      bedrooms: recorded ?? predicted,
      bedrooms_source: recorded ? "recorded" : predicted ? "predicted" : null,
      estimated_value: null,
    };
    if (this.cache.size > 5000) this.cache.clear();
    this.cache.set(key, { at: this.now(), facts });
    return facts;
  }

  /** The core record's value estimate (25 tokens), cached on the facts once fetched. */
  async estimatedValue(facts: PropertyFacts): Promise<number | null> {
    if (facts.estimated_value) return facts.estimated_value;
    const core = await this.homedata.send("GET", `/property/${facts.uprn}/core/`);
    if (core.statusCode >= 400) return null;
    const body = core.body as { valuation_estimate?: { estimate_gbp?: unknown }; last_sale?: { price?: unknown } } | null;
    facts.estimated_value = num(body?.valuation_estimate?.estimate_gbp) ?? num(body?.last_sale?.price);
    return facts.estimated_value;
  }
}
