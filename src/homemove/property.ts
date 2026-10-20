import type { HomedataClient } from "../client.js";

/**
 * What an address tells a quote, from Homedata. Two lookups by default: the
 * address match (5 tokens) and the rooms and Land Registry title add-ons (1 each). The value estimate
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
  /** From the registered title class ("Absolute freehold title", "Good leasehold title"…). */
  tenure: "freehold" | "leasehold" | null;
  /** A value estimate, used only to choose a price band, never quoted as a valuation. */
  estimated_value: number | null;
}

/** One address a person can pick in the card. */
export interface AddressChoice { uprn: string; line: string; town: string; postcode: string }

const POSTCODE = /^([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})$/i;
const title = (s: string) => s.toLowerCase().replace(/(^|[\s\-'(/])([a-z])/g, (_, a, b) => a + b.toUpperCase());

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

    const facts = await this.factsFor(uprn, String(record["full_address"] ?? record["address"] ?? address), String(record["postcode"] ?? postcode));
    if (this.cache.size > 5000) this.cache.clear();
    this.cache.set(key, { at: this.now(), facts });
    return facts;
  }

  /**
   * Addresses for the card's picker. A full postcode lists that postcode's homes (2 tokens);
   * anything else is an address search (2 tokens). Never more than 100.
   */
  async search(query: string): Promise<AddressChoice[]> {
    const text = query.trim().replace(/\s+/g, " ");
    if (text.length < 3) return [];
    const pc = POSTCODE.exec(text);
    if (pc) {
      const answer = await this.homedata.send("GET", `/address/postcode/${pc[1]!.toUpperCase()}${pc[2]!.toUpperCase()}/`);
      if (answer.statusCode === 404 || answer.statusCode === 422) return [];
      if (answer.statusCode >= 400) throw new Error(`Homedata postcode lookup answered ${answer.statusCode}`);
      const body = answer.body as { postcode?: string; addresses?: Array<Record<string, unknown>> };
      return (body.addresses ?? []).slice(0, 100).flatMap((a) => {
        const uprn = String(a["uprn"] ?? "");
        if (!/^\d+$/.test(uprn)) return [];
        const street = [a["building_number"], a["street"]].filter((v) => typeof v === "string" && v).join(" ");
        const line = [a["sub_building"], a["building_name"], street].filter((v) => typeof v === "string" && v).map((v) => title(String(v))).join(", ")
          || title(String(a["address"] ?? "").split(",")[0] ?? "");
        return [{ uprn, line, town: title(String(a["town"] ?? "")), postcode: String(body.postcode ?? `${pc[1]} ${pc[2]}`).toUpperCase() }];
      });
    }
    const answer = await this.homedata.send("GET", "/address/find/", { q: text, limit: "8" });
    if (answer.statusCode >= 400) throw new Error(`Homedata address find answered ${answer.statusCode}`);
    const body = answer.body as { suggestions?: Array<Record<string, unknown>> };
    return (body.suggestions ?? []).flatMap((a) => {
      const uprn = String(a["uprn"] ?? "");
      return /^\d+$/.test(uprn) ? [{ uprn, line: String(a["address"] ?? ""), town: String(a["town"] ?? ""), postcode: String(a["postcode"] ?? "").toUpperCase() }] : [];
    });
  }

  /** Facts for an address picked in the card: its UPRN is known, so no match is spent. */
  async chosen(uprn: string, line: string, postcode: string): Promise<PropertyFacts> {
    if (!/^\d{1,15}$/.test(uprn)) throw new AddressNotMatched("no_match");
    const key = `uprn:${uprn}`;
    const hit = this.cache.get(key);
    if (hit && this.now() - hit.at < 24 * 3600_000) return hit.facts;
    const facts = await this.factsFor(uprn, line, postcode);
    if (this.cache.size > 5000) this.cache.clear();
    this.cache.set(key, { at: this.now(), facts });
    return facts;
  }

  private async factsFor(uprn: string, address: string, postcode: string): Promise<PropertyFacts> {
    const extra = await this.homedata.send("GET", `/property/${uprn}/`, { with: "rooms,lr_title" });
    if (extra.statusCode === 404) throw new AddressNotMatched("no_match");
    const extraBody = (extra.statusCode < 400 ? extra.body : undefined) as { rooms?: Record<string, unknown>; lr_title?: { title_class?: unknown } } | undefined;
    const rooms = extraBody?.rooms ?? {};
    const titleClass = String(extraBody?.lr_title?.title_class ?? "").toLowerCase();
    const recorded = num(rooms["bedrooms"]), predicted = num(rooms["predicted_bedrooms"]);
    return {
      uprn, address, postcode: postcode.toUpperCase(),
      bedrooms: recorded ?? predicted,
      bedrooms_source: recorded ? "recorded" : predicted ? "predicted" : null,
      tenure: titleClass.includes("leasehold") ? "leasehold" : titleClass.includes("freehold") ? "freehold" : null,
      estimated_value: null,
    };
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
