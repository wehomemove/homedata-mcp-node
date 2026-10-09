import { HomedataClient, type ApiResponse } from "../client.js";
import { TtlCache } from "./cache.js";
import { matchWishes, WISHES, type Wish } from "./wishes.js";

const DEFAULT_HOME_URL = "https://home.co.uk";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const POSTCODE = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i;

export class HomeError extends Error {}
export class HomeSearchRequiredError extends HomeError {}
export class HomeUpstreamError extends Error {
  constructor(message: string, readonly status?: number, readonly notJson = false) { super(message); }
}

const UNAVAILABLE = Object.freeze({ available: false, reason: "Not available right now." });
const NO_ENRICHMENT = Object.freeze({ available: false, reason: "No UPRN or valid full postcode was published for enrichment." });
const isUnavailable = (value: unknown): boolean => object(value)["available"] === false && object(value)["reason"] === UNAVAILABLE.reason;

/** How a listing's enrichment was resolved, so a repeat view skips address matching. */
type EnrichmentRoute =
  | { kind: "home"; uprn: string; source: "listing_uprn" | "exact_address_match" }
  | { kind: "area"; postcode: string }
  | { kind: "none" };

export const ENRICHMENT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export interface EnrichmentCacheStats {
  homes: { hits: number; misses: number; entries: number };
  areas: { hits: number; misses: number; entries: number };
}

export interface HomeClientOptions {
  homeBaseUrl?: string;
  homedata: HomedataClient;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  listingViewSecret?: string;
  now?: () => Date;
  logger?: (message: string, detail: unknown) => void;
  /**
   * Successful Homedata answers are kept this long: each home's core lookup by
   * UPRN, and area facts by postcode. Failures are never kept.
   */
  enrichmentTtlMs?: number;
  /** Most homes held at once; about one month of the Home app's allowance. */
  cachedHomes?: number;
  cachedAreas?: number;
}

export type SearchArgs = {
  location: string;
  listing_type: "sale" | "rent";
  min_price?: number;
  max_price?: number;
  min_beds?: number;
  max_beds?: number;
  property_type?: "detached" | "semi_detached" | "terraced" | "flat";
  new_build?: boolean;
  sort?: "newest" | "oldest" | "price_asc" | "price_desc";
  page?: number;
  reduced_within_days?: number;
  on_market_at_least_days?: number;
  new_within_days?: number;
  wishes?: Wish[];
};

export type SoldArgs = {
  postcode: string;
  months?: 6 | 12 | 24;
  property_type?: "detached" | "semi_detached" | "terraced" | "flat";
  min_price?: number;
  max_price?: number;
  sort?: "newest" | "oldest" | "price_asc" | "price_desc";
  page?: number;
};

type JsonObject = Record<string, unknown>;

/** One home's published position; coordinates are null when the listing has none. */
export type HomeLocation = {
  listing_id: string;
  address: string | null;
  postcode: string | null;
  url: string | null;
  coordinates: { latitude: number; longitude: number } | null;
};

type PublicListingIdentity = Pick<HomeLocation, "address" | "postcode" | "url"> & { address: string };

const MIN_SECTOR_SALES = 10;
/** Listing descriptions read at once for a wish search; home.co.uk answers each in about 0.2 s. */
const WISH_READS_AT_ONCE = 5;
const LISTING_TEXT_TTL_MS = 60 * 60 * 1000;
const AGENT_PAGE_SIZE = 120;
const AGENT_MAX_PAGES = 40;
const PROPERTY_TYPES = ["detached", "semi_detached", "terraced", "flat"];
const SORTS = ["newest", "oldest", "price_asc", "price_desc"];
const sortParam = (sort: string) => sort === "newest" ? "date_desc" : sort === "oldest" ? "date_asc" : sort;

function object(value: unknown): JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}

function present(value: unknown): boolean {
  return value !== undefined && value !== null && value !== "";
}

function compactObject(entries: Array<[string, unknown]>): JsonObject {
  return Object.fromEntries(entries.filter(([, value]) => present(value)));
}

/** Rebuild the broad core record from an allowlist; new fields stay private. */
export function buyerPropertyFacts(value: unknown): JsonObject {
  const core = object(value);
  const nestedEpc = object(core["epc"]); const nestedTax = object(core["council_tax"]);
  const first = (...values: unknown[]) => values.find(present);
  const epc = compactObject([
    ["rating", first(core["current_energy_rating"], nestedEpc["current_energy_rating"], nestedEpc["current_rating"], nestedEpc["rating"])],
    ["potential_rating", first(core["potential_energy_rating"], nestedEpc["potential_energy_rating"], nestedEpc["potential_rating"])],
    ["assessment_date", first(core["last_epc_date"], nestedEpc["last_epc_date"], nestedEpc["assessment_date"], nestedEpc["date"])],
  ]);
  const councilTax = compactObject([["band", first(core["council_tax_band"], nestedTax["council_tax_band"], nestedTax["band"])]]);
  const safeRisk = (risk: unknown): unknown => {
    if (Array.isArray(risk)) {
      const details = risk.map(safeRisk).map(object).filter((item) => Object.keys(item).length);
      const levels = details.map((item) => text(item["level"])).filter((level): level is string => level !== null);
      return compactObject([["level", levels.join("; ") || undefined], ["details", details.length ? details : undefined]]);
    }
    const item = object(risk);
    if (!Object.keys(item).length) return typeof risk === "string" ? risk : undefined;
    return compactObject([["type", first(item["risk_type"], item["type"])], ["level", first(item["label"], item["level"], item["rating"], item["risk"])]]);
  };
  const safeSchool = (value: unknown): JsonObject => {
    const school = object(value); const ofsted = object(school["ofsted"]);
    return compactObject([
      ["name", first(school["name"], school["school_name"])], ["phase", school["phase"]],
      ["distance_km", first(school["distance_km"], school["distance"])],
      ["ofsted_rating", first(school["ofsted_rating"], ofsted["rating"])],
      ["ofsted_inspection_date", first(school["ofsted_inspection_date"], ofsted["last_inspection"])],
    ]);
  };
  const schoolBlock = object(core["schools"]);
  const propertyTypeBlock = object(core["property_type"]);
  const roomsBlock = object(core["rooms"]);
  const dimensionsBlock = object(core["dimensions"]);
  const titleBlock = object(core["lr_title"]);
  const schools = (Array.isArray(core["schools"]) ? core["schools"] : Array.isArray(schoolBlock["schools"]) ? schoolBlock["schools"] : []).map(safeSchool);
  const broadbandBlock = object(core["broadband"]);
  const broadband = compactObject([
    ["avg_download_speed", first(core["avg_download_speed"], broadbandBlock["avg_download_speed"], broadbandBlock["average_download_speed"])],
    ["max_download_speed", first(core["max_download_speed"], broadbandBlock["max_download_speed"], broadbandBlock["maximum_download_speed"])],
    ["superfast_available_pct", first(core["superfast_available_pct"], broadbandBlock["superfast_available_pct"])],
    ["gigabit_available_pct", first(core["gigabit_available_pct"], broadbandBlock["gigabit_available_pct"])],
    ["full_fibre_available_pct", first(core["full_fibre_available_pct"], broadbandBlock["full_fibre_available_pct"])],
  ]);
  const crimeBlock = object(core["crime"]);
  const crime = compactObject([
    ["level", first(core["crime_level"], crimeBlock["level"], crimeBlock["rating"],
      present(crimeBlock["total_crimes"]) ? `${String(crimeBlock["total_crimes"])} recorded crimes${present(crimeBlock["latest_month"]) ? ` (${String(crimeBlock["latest_month"])})` : ""}` : undefined)],
    ["total", first(crimeBlock["total_crimes"], crimeBlock["total"])], ["period", first(crimeBlock["latest_month"], crimeBlock["period"])],
    ["categories", Array.isArray(crimeBlock["categories"]) ? crimeBlock["categories"].map((category) => {
      const item = object(category); return compactObject([["name", first(item["label"], item["category"])], ["count", item["count"]]]);
    }) : undefined],
  ]);
  const rooms = compactObject([
    ["bedrooms", first(core["bedrooms"], roomsBlock["bedrooms"])],
    ["bathrooms", first(core["bathrooms"], roomsBlock["bathrooms"])],
    ["habitable", first(core["habitable_rooms"], roomsBlock["habitable_rooms"])],
    ["heated", first(core["heated_rooms"], roomsBlock["heated_rooms"])],
  ]);
  return compactObject([
    ["epc", Object.keys(epc).length ? epc : undefined], ["council_tax", Object.keys(councilTax).length ? councilTax : undefined],
    ["flood", safeRisk(core["flood"])], ["radon", safeRisk(core["radon"])], ["noise", safeRisk(core["noise"])],
    ["landfill", safeRisk(core["landfill"])], ["coal_mining", safeRisk(core["coal_mining"])],
    ["air_quality", safeRisk(core["air_quality"])], ["other_risks", safeRisk(core["risks"])],
    ["broadband", Object.keys(broadband).length ? broadband : undefined],
    ["schools", schools.length ? schools : undefined], ["crime", Object.keys(crime).length ? crime : undefined],
    ["property_type", first(propertyTypeBlock["property_type"], core["property_type"])],
    ["rooms", Object.keys(rooms).length ? rooms : undefined],
    ["floor_area_sqm", first(core["epc_floor_area"], nestedEpc["epc_floor_area"], core["predicted_floor_area"], dimensionsBlock["predicted_floor_area"], core["floor_area_sqm"])],
    ["tenure", first(core["tenure"], core["ownership"], core["estate_interest"], titleBlock["estate_interest"])],
  ]);
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Turn listing-agent HTML into safe, readable plain-text paragraphs. */
export function cleanListingDescription(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const decoded = value
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/?(?:p|div|li|ul|ol|h[1-6]|blockquote|section|article)\b[^>]*>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&(#\d+|#x[\da-f]+|amp|lt|gt|quot|apos|nbsp);/gi, (entity, code: string) => {
      const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
      if (code[0] !== "#") return named[code.toLowerCase()] ?? entity;
      const numeric = code[1]?.toLowerCase() === "x" ? Number.parseInt(code.slice(2), 16) : Number.parseInt(code.slice(1), 10);
      return Number.isFinite(numeric) && numeric > 0 && numeric <= 0x10ffff ? String.fromCodePoint(numeric) : entity;
    })
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[\t\f\v ]+/g, " ").trim())
    .filter(Boolean)
    // Some agents hard-wrap mid-sentence with <br>: a line that does not end a sentence
    // continues into the next when that starts lower case or the line ends on a joining word.
    .reduce((paragraphs: string[], line) => {
      const previous = paragraphs[paragraphs.length - 1];
      const continues = previous !== undefined && !/[.!?:;)]$/.test(previous) &&
        (/^[a-z]/.test(line) || /\b(?:a|an|and|at|by|for|from|in|of|on|or|the|to|with)$/i.test(previous));
      if (continues) paragraphs[paragraphs.length - 1] = `${previous} ${line}`; else paragraphs.push(line);
      return paragraphs;
    }, [])
    .join("\n\n")
    .trim();
  return decoded || null;
}

function coordinate(value: unknown): string | null {
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(numeric) ? String(numeric) : null;
}

/** A full postcode ("BA1 1LZ") or a postcode district ("BA1"), normalised; null when it is neither. */
export function parsePostcode(value: unknown): { outcode: string; full: string | null } | null {
  const compact = (text(value) ?? "").toUpperCase().replace(/\s+/g, "");
  if (/^[A-Z]{1,2}\d[A-Z\d]?$/.test(compact)) return { outcode: compact, full: null };
  const full = compact.length > 3 ? `${compact.slice(0, -3)} ${compact.slice(-3)}` : compact;
  return POSTCODE.test(full) ? { outcode: full.split(" ")[0]!, full } : null;
}

/** home.co.uk location slugs are lower case with hyphens: "Milton Keynes" -> "milton-keynes". */
function slug(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function absoluteHomeUrl(value: unknown): string | null {
  const path = text(value);
  if (!path) return null;
  try { return new URL(path, DEFAULT_HOME_URL).toString(); } catch { return null; }
}

/** One listing photo: the full image for galleries and its thumbnail for cards. */
export type HomePhoto = { full: string; thumb: string | null };
/** Most photos a listing sends the widget; listings carry up to about ninety. */
export const HOME_PHOTO_LIMIT = 30;

/** A search property's photos in listing order: the primary first, then by sort order, images only. */
export function orderedPhotos(value: unknown): HomePhoto[] {
  const images = (Array.isArray(object(value)["images"]) ? object(value)["images"] as unknown[] : []).map(object)
    .filter((image) => image["media_type"] === undefined || image["media_type"] === "image");
  const rank = (image: JsonObject) => (image["is_primary"] === true ? -1 : 0);
  const order = (image: JsonObject) => (typeof image["sort_order"] === "number" ? image["sort_order"] as number : Number.MAX_SAFE_INTEGER);
  return images
    .map((image, index) => ({ image, index }))
    .sort((a, b) => rank(a.image) - rank(b.image) || order(a.image) - order(b.image) || a.index - b.index)
    .map(({ image }) => ({ full: absoluteHomeUrl(image["cdn_url"] ?? image["thumbnail_cdn_url"]), thumb: absoluteHomeUrl(image["thumbnail_cdn_url"]) }))
    .filter((photo): photo is HomePhoto => photo.full !== null)
    .slice(0, HOME_PHOTO_LIMIT);
}

/** Only fields useful on a search card. Never return card_html, boundaries or pre-rendered map pins. */
export function trimCard(value: unknown): JsonObject {
  const p = object(value);
  const images = Array.isArray(p["images"]) ? p["images"] : [];
  const primary = images.find((item) => object(item)["is_primary"] === true) ?? images[0];
  return {
    id: p["listing_id"] ?? p["id"] ?? p["property_id"],
    url: absoluteHomeUrl(`/property/${String(p["listing_id"] ?? p["id"] ?? p["property_id"] ?? "")}`),
    price: p["latest_price"] ?? p["price"] ?? null,
    rental_frequency: p["rental_frequency"] ?? null,
    address: p["display_address"] ?? p["address"] ?? null,
    postcode: p["postcode"] ?? null,
    bedrooms: p["bedrooms"] ?? null,
    bathrooms: p["bathrooms"] ?? null,
    property_type: p["listing_property_type"] ?? p["property_type"] ?? null,
    status: p["latest_status"] ?? p["status_label"] ?? null,
    tenure: p["ownership"] ?? null,
    new_build: p["is_new_build"] ?? p["new_build"] ?? false,
    new_listing: p["is_new"] ?? false,
    construction_age_band: p["construction_age_band"] ?? null,
    added_date: p["added_date"] ?? null,
    days_listed: p["days_listed"] ?? null,
    reduced_date: p["reduced_date"] ?? null,
    under_offer_date: p["first_offer_date"] ?? null,
    image: absoluteHomeUrl(object(primary)["thumbnail_cdn_url"] ?? object(primary)["cdn_url"] ?? p["main_image"]),
    agent: p["agent_name"] ?? null,
    agent_logo: absoluteHomeUrl(p["agent_logo"] ?? p["agent_logo_url"]),
    coordinates: {
      latitude: p["latitude"] ?? object(p["coordinates"])["latitude"] ?? null,
      longitude: p["longitude"] ?? object(p["coordinates"])["longitude"] ?? null,
    },
  };
}

export class HomeClient {
  private readonly homeBaseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly now: () => Date;
  private readonly logger: (message: string, detail: unknown) => void;
  private readonly cachedHomes: TtlCache<unknown>;
  private readonly cachedAreas: TtlCache<JsonObject>;
  private readonly listingRoutes: TtlCache<EnrichmentRoute>;
  private readonly listingTexts: TtlCache<string | null>;
  private readonly listingLocations: TtlCache<HomeLocation>;
  private readonly publicListingIdentities: TtlCache<PublicListingIdentity>;
  /** Each listing's ordered photos from its last search, for the widget only (never model context). */
  private readonly listingPhotos: TtlCache<HomePhoto[]>;

  constructor(private readonly options: HomeClientOptions) {
    this.homeBaseUrl = (options.homeBaseUrl ?? DEFAULT_HOME_URL).replace(/\/+$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.now = options.now ?? (() => new Date());
    this.logger = options.logger ?? ((message, detail) => console.error(message, detail));
    const ttl = options.enrichmentTtlMs ?? ENRICHMENT_CACHE_TTL_MS;
    const clock = () => this.now().getTime();
    this.cachedHomes = new TtlCache(options.cachedHomes ?? 2_000, ttl, clock);
    this.cachedAreas = new TtlCache(options.cachedAreas ?? 2_000, ttl, clock);
    this.listingRoutes = new TtlCache(4 * (options.cachedHomes ?? 2_000), ttl, clock);
    this.listingTexts = new TtlCache(2_000, LISTING_TEXT_TTL_MS, clock);
    this.listingLocations = new TtlCache(2_000, LISTING_TEXT_TTL_MS, clock);
    this.publicListingIdentities = new TtlCache(2_000, LISTING_TEXT_TTL_MS, clock);
    this.listingPhotos = new TtlCache(2_000, LISTING_TEXT_TTL_MS, clock);
  }

  /** The photos search last saw for a listing, in listing order, if it is still held. */
  photosFor(listingId: string): HomePhoto[] | undefined {
    return this.listingPhotos.peek(listingId);
  }

  /** Hit and miss counts for health. A home hit is one Homedata core lookup not spent. */
  enrichmentCacheStats(): EnrichmentCacheStats {
    return { homes: this.cachedHomes.stats(), areas: this.cachedAreas.stats() };
  }

  /**
   * True when viewing this listing now would spend nothing on Homedata: its
   * enrichment was resolved recently and the facts it resolved to are still held.
   */
  enrichmentCached(listingId: string): boolean {
    const route = this.listingRoutes.peek(listingId);
    if (!route) return false;
    if (route.kind === "home") return this.cachedHomes.peek(route.uprn) !== undefined;
    if (route.kind === "area") return this.cachedAreas.peek(route.postcode) !== undefined;
    return true;
  }

  async search(args: SearchArgs): Promise<JsonObject> {
    if (!text(args.location)) throw new HomeError("location is required");
    if (!(["sale", "rent"] as unknown[]).includes(args.listing_type)) throw new HomeError("listing_type must be sale or rent");
    for (const name of ["min_price", "max_price", "min_beds", "max_beds", "page", "reduced_within_days", "on_market_at_least_days", "new_within_days"] as const) {
      const value = args[name];
      const positive = name === "page" || name.endsWith("_days");
      if (value !== undefined && (!Number.isInteger(value) || value < (positive ? 1 : 0))) throw new HomeError(`${name} must be a whole number${positive ? " starting at 1" : " of zero or greater"}`);
    }
    if ((args.page ?? 1) > 100) throw new HomeError("page must be no more than 100");
    if (args.min_price !== undefined && args.max_price !== undefined && args.min_price > args.max_price) throw new HomeError("min_price cannot exceed max_price");
    if (args.min_beds !== undefined && args.max_beds !== undefined && args.min_beds > args.max_beds) throw new HomeError("min_beds cannot exceed max_beds");
    if (args.property_type && !PROPERTY_TYPES.includes(args.property_type)) throw new HomeError("property_type is not supported");
    if (args.sort && !SORTS.includes(args.sort)) throw new HomeError("sort is not supported");
    const wishes = args.wishes === undefined ? null : Array.isArray(args.wishes) ? [...new Set(args.wishes)] : [];
    if (wishes && (!wishes.length || !wishes.every((wish) => (WISHES as readonly unknown[]).includes(wish)))) {
      throw new HomeError(`wishes must list one or more of ${WISHES.join(", ")}`);
    }
    const route = args.listing_type === "rent" ? "to-rent" : "for-sale";
    const location = encodeURIComponent(args.location.trim());
    const query: Record<string, string> = { page: String(args.page ?? 1), per_page: "20" };
    if (args.min_price !== undefined) query["minprice"] = String(args.min_price);
    if (args.max_price !== undefined) query["maxprice"] = String(args.max_price);
    if (args.min_beds !== undefined) query["minbeds"] = String(args.min_beds);
    if (args.max_beds !== undefined) query["maxbeds"] = String(args.max_beds);
    if (args.property_type) query[args.property_type === "semi_detached" ? "semi" : args.property_type] = "1";
    if (args.new_build) query["is_new_build"] = "1";
    if (args.sort) query["sort"] = args.sort === "newest" ? "date_desc" : args.sort === "oldest" ? "date_asc" : args.sort;
    if (args.reduced_within_days !== undefined) query["reduced_since"] = this.daysAgo(args.reduced_within_days);
    if (args.on_market_at_least_days !== undefined) query["listed_before"] = this.daysAgo(args.on_market_at_least_days);
    if (args.new_within_days !== undefined) query["added_since"] = this.daysAgo(args.new_within_days);
    const raw = object(await this.homeGet(`/api/${route}/${location}/`, query));
    const pagination = object(raw["pagination"]);
    const sourceProperties = Array.isArray(raw["properties"]) ? raw["properties"].map(object) : [];
    // Atlas currently accepts these parameters on this public route without applying
    // them. Keep sending the new contract, but never trust an unfiltered response.
    const signalFilters = args.reduced_within_days !== undefined || args.on_market_at_least_days !== undefined || args.new_within_days !== undefined;
    const properties = signalFilters ? sourceProperties.filter((property) => this.matchesMarketSignals(property, query)) : sourceProperties;
    this.rememberPublicListingIdentities(properties);
    const currentPage = Number(pagination["current_page"] ?? args.page ?? 1);
    const lastPage = Number(pagination["last_page"]);
    const hasMore = signalFilters && sourceProperties.length > 0 && (!Number.isInteger(lastPage) || currentPage < lastPage);
    return {
      location: raw["displayLocation"] ?? args.location,
      listing_type: args.listing_type,
      total: signalFilters ? null : raw["total"] ?? pagination["total"] ?? null,
      page: pagination["current_page"] ?? args.page ?? 1,
      last_page: pagination["last_page"] ?? null,
      ...(signalFilters ? {
        source_total: raw["total"] ?? pagination["total"] ?? null,
        matching_homes_returned: properties.length,
        pages_checked: 1,
        results_limited: hasMore,
        ...(hasMore ? {
          next_page: currentPage + 1,
          note: `Market-signal filters were verified on source page ${currentPage}. More source results remain; call search_homes again with page ${currentPage + 1} and the same filters to continue.`,
        } : {}),
      } : {}),
      ...(wishes ? await this.rankByWishes(properties, wishes, { currentPage, lastPage, signalFilters }) : { homes: properties.map(trimCard) }),
    };
  }

  /**
   * Order one page of homes by how many wishes each listing states in its own
   * description, with the phrase that states it. The search card only carries
   * the first 150 characters, so each listing's full description is read; a
   * listing whose description cannot be read is checked against that summary
   * and says so.
   */
  private async rankByWishes(properties: JsonObject[], wishes: Wish[], page: { currentPage: number; lastPage: number; signalFilters: boolean }): Promise<JsonObject> {
    const texts: Array<{ text: string | null; checked: "full_description" | "summary_only" }> = new Array(properties.length);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(WISH_READS_AT_ONCE, properties.length) }, async () => {
      for (let i = next++; i < properties.length; i = next++) texts[i] = await this.listingText(properties[i]!);
    }));
    const homes = properties.map((property, index) => {
      const { text: description, checked } = texts[index]!;
      const matched = matchWishes(description, wishes);
      return {
        ...trimCard(property),
        wishes_matched: matched,
        wishes_not_stated: wishes.filter((wish) => !matched.some((match) => match.wish === wish)),
        wishes_checked_in: checked,
      };
    });
    // Stable: equal matches keep the source order (newest, cheapest, and so on).
    homes.sort((a, b) => b.wishes_matched.length - a.wishes_matched.length);
    const more = Number.isInteger(page.lastPage) ? page.currentPage < page.lastPage : properties.length > 0;
    return {
      wishes,
      wishes_explained: "Homes are ordered by how many wishes their own listing states, each with the listing's phrase as evidence. A wish under wishes_not_stated is not mentioned in the listing: it is unknown, not absent. Never describe a home as having a wish it does not match.",
      homes_matching_every_wish: homes.filter((home) => home.wishes_not_stated.length === 0).length,
      ...(more && !page.signalFilters ? {
        wishes_checked_on_page: page.currentPage,
        wishes_next_page: page.currentPage + 1,
        wishes_note: `Wishes were checked on source page ${page.currentPage} only. Call search_homes again with page ${page.currentPage + 1} and the same arguments to check more homes.`,
      } : {}),
      homes,
    };
  }

  /** A listing's description as plain text, read from its detail page and kept for an hour. */
  private async listingText(property: JsonObject): Promise<{ text: string | null; checked: "full_description" | "summary_only" }> {
    const id = String(property["listing_id"] ?? property["id"] ?? "");
    const summary = { text: cleanListingDescription(property["description"])?.replace(/\s*(?:\.\.\.|…)$/, "") ?? null, checked: "summary_only" as const };
    if (!UUID.test(id)) return summary;
    const known = this.listingTexts.peek(id);
    if (known !== undefined) return { text: known, checked: "full_description" };
    try {
      const detail = object(await this.homeGet(`/api/property-details/${id}`));
      if (!Object.keys(detail).length) return summary;
      const text = cleanListingDescription(detail["description"]);
      this.listingTexts.set(id, text);
      return { text, checked: "full_description" };
    } catch (error) {
      if (error instanceof HomeUpstreamError) return summary;
      throw error;
    }
  }

  /**
   * Where a saved search should look. atlas's runner ignores free-text
   * `location` and falls back to a national search, so resolve it here the
   * same way search_homes does: a boundary slug when home.co.uk matched a
   * boundary, and its centre and radius as the fallback the runner uses when
   * that slug is unknown to it.
   */
  async savedSearchArea(location: string, rent: boolean): Promise<JsonObject> {
    const place = text(location);
    if (!place) throw new HomeError("search_criteria.location is required");
    const raw = object(await this.homeGet(`/api/${rent ? "to-rent" : "for-sale"}/${encodeURIComponent(place)}/`, { per_page: "1" }));
    const lat = Number(raw["centerLat"]); const lng = Number(raw["centerLng"]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new HomeError(`home.co.uk could not match ${place} to an area; try a town or postcode`);
    const boundary = raw["hasBoundarySearch"] === true;
    const radius = Number(raw["radiusMiles"]);
    return {
      location: place,
      ...(boundary && slug(place) ? { location_slug: slug(place) } : {}),
      lat, lng,
      radius: !boundary && Number.isFinite(radius) && radius > 0 ? Math.min(radius, 50) : 3,
      area_name: text(raw["displayLocation"]) ?? place,
    };
  }

  private daysAgo(days: number): string {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(this.now());
    const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((item) => item.type === type)?.value);
    const date = new Date(Date.UTC(part("year"), part("month") - 1, part("day") - days));
    return date.toISOString().slice(0, 10);
  }

  private matchesMarketSignals(property: JsonObject, query: Record<string, string>): boolean {
    const date = (value: unknown): string | null => {
      const candidate = text(value)?.slice(0, 10) ?? null;
      return candidate && /^\d{4}-\d{2}-\d{2}$/.test(candidate) ? candidate : null;
    };
    if (query["reduced_since"] && (!date(property["reduced_date"]) || date(property["reduced_date"])! < query["reduced_since"]!)) return false;
    if (query["added_since"] && (!date(property["added_date"]) || date(property["added_date"])! < query["added_since"]!)) return false;
    if (query["listed_before"] && (!date(property["added_date"]) || date(property["added_date"])! > query["listed_before"]!)) return false;
    return true;
  }

  async home(listingId: string): Promise<JsonObject> {
    if (!UUID.test(listingId)) throw new HomeError("listing_id must be a UUID returned by search_homes");
    const detail = object(await this.homeGet(`/api/property-details/${listingId}`));
    if (!Object.keys(detail).length) throw new HomeError("Home was not found");
    // The lightweight detail endpoint carries the description and property facts;
    // the postcode search carries the complete photo set, agent and listing dates.
    let postcode = text(detail["postcode"]);
    if (!postcode) postcode = await this.postcodeAt(detail["latitude"], detail["longitude"]);
    const transaction = detail["transaction_type"] === "Rent" || detail["is_for_sale"] === false ? "to-rent" : "for-sale";
    let listing: JsonObject = {};
    if (postcode) {
      const search = object(await this.homeGet(`/api/${transaction}/${encodeURIComponent(postcode)}/`, { per_page: "120" }));
      listing = object((Array.isArray(search["properties"]) ? search["properties"] : []).find((p) => String(object(p)["listing_id"] ?? object(p)["id"]) === listingId));
      if (Object.keys(listing).length) this.rememberPublicListingIdentities([listing]);
    }
    const card = { ...detail, ...listing, listing_id: listingId };
    const address = [detail["building_name"], detail["building_number"], detail["street_name"], detail["locality"], detail["town_name"], postcode]
      .filter((v) => typeof v === "string" && v.trim()).join(", ");
    return {
      ...trimCard(card),
      description: cleanListingDescription(detail["description"]),
      reception_rooms: detail["reception_rooms"] ?? null,
      floor_area_sqm: detail["epc_floor_area"] ?? detail["predicted_floor_area"] ?? null,
      coordinates: { latitude: detail["latitude"] ?? null, longitude: detail["longitude"] ?? null },
      photos: (Array.isArray(listing["images"]) && listing["images"].length
        ? listing["images"].map((image) => object(image)["cdn_url"] ?? object(image)["thumbnail_cdn_url"])
        : Array.isArray(detail["images"]) ? detail["images"] : []).map(absoluteHomeUrl).filter(Boolean),
      agent: {
        name: detail["agent_name"] ?? detail["brand_name"] ?? listing["agent_name"] ?? null,
        branch: detail["branch_name"] ?? listing["branch_name"] ?? null,
        logo: absoluteHomeUrl(detail["brand_logo"] ?? listing["agent_logo"]),
      },
      enrichment: await this.enrich(listingId, detail["property_uprn"], address, postcode, text(detail["building_number"]), text(detail["building_name"])),
    };
  }

  async compare(listingIds: string[]): Promise<JsonObject> {
    return { homes: await Promise.all(listingIds.map((id) => this.home(id))) };
  }

  /**
   * Where one home is, from its property-details page only: no search, no
   * Homedata. Kept for an hour like listing text, so a commute check followed by
   * a viewing plan reads each home once.
   */
  async locate(listingId: string): Promise<HomeLocation> {
    if (!UUID.test(listingId)) throw new HomeError(`${listingId} is not a listing UUID returned by search_homes`);
    const publicIdentity = this.publicListingIdentities.peek(listingId);
    if (!publicIdentity) throw new HomeSearchRequiredError(`Home ${listingId} has no remembered public display address. Run search_homes again before using route tools.`);
    const known = this.listingLocations.peek(listingId);
    if (known) return { ...known, ...publicIdentity };
    const detail = object(await this.homeGet(`/api/property-details/${listingId}`));
    if (!Object.keys(detail).length) throw new HomeError(`Home ${listingId} was not found`);
    const lat = Number(detail["latitude"]); const lng = Number(detail["longitude"]);
    const located = Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
    const location: HomeLocation = {
      listing_id: listingId,
      address: publicIdentity.address,
      postcode: publicIdentity.postcode,
      url: publicIdentity.url,
      coordinates: located ? { latitude: lat, longitude: lng } : null,
    };
    this.listingLocations.set(listingId, location);
    return { ...location };
  }

  /** Route answers may repeat only the public identity search_homes exposed. */
  private rememberPublicListingIdentities(properties: JsonObject[]): void {
    for (const property of properties) {
      const card = trimCard(property);
      const listingId = card["id"];
      const address = card["address"];
      const photos = orderedPhotos(property);
      if (typeof listingId === "string" && UUID.test(listingId) && photos.length) this.listingPhotos.set(listingId, photos);
      if (typeof listingId !== "string" || !UUID.test(listingId)) continue;
      if (typeof address !== "string" || !address.trim()) {
        this.publicListingIdentities.delete(listingId);
        continue;
      }
      this.publicListingIdentities.set(listingId, {
        address,
        postcode: typeof card["postcode"] === "string" ? card["postcode"] : null,
        url: typeof card["url"] === "string" ? card["url"] : null,
      });
    }
  }

  async area(postcode: string): Promise<JsonObject> {
    const compact = postcode.trim().toUpperCase().replace(/\s+/g, "");
    const normalised = compact.length > 3 ? `${compact.slice(0, -3)} ${compact.slice(-3)}` : compact;
    if (!POSTCODE.test(normalised)) throw new HomeError("postcode must be a full UK postcode");
    const cached = this.cachedAreas.get(normalised);
    if (cached) return structuredClone(cached);
    const outcode = normalised.split(/\s+/)[0]!;
    const calls = [
      ["crime", "/crime/", { postcode: normalised }],
      ["schools", "/schools/nearby", { postcode: normalised, limit: "10" }],
      ["broadband", "/broadband/", { postcode: normalised }],
      ["deprivation", "/deprivation/", { postcode: normalised }],
      ["price_growth", `/price-growth/${encodeURIComponent(outcode)}/`, {}],
    ] as const;
    const settled = await Promise.all(calls.map(async ([name, path, query]) => [name, await this.data(path, query)] as const));
    const facts: JsonObject = { postcode: normalised, ...Object.fromEntries(settled) };
    // A part that failed would otherwise stay missing for a day.
    if (!settled.some(([, value]) => isUnavailable(value))) this.cachedAreas.set(normalised, structuredClone(facts));
    return facts;
  }

  /**
   * Recorded sale prices near a postcode, from home.co.uk's sold-properties JSON.
   * A full postcode searches its sector (BA1 1), widening to the district (BA1)
   * when the sector has no boundary or too few sales to be useful. Never a valuation.
   */
  async soldPrices(args: SoldArgs): Promise<JsonObject> {
    const postcode = parsePostcode(args.postcode);
    if (!postcode) throw new HomeError("postcode must be a UK postcode or postcode district, such as BA1 1LZ or BA1");
    const months = args.months ?? 12;
    if (![6, 12, 24].includes(months)) throw new HomeError("months must be 6, 12 or 24");
    for (const name of ["min_price", "max_price", "page"] as const) {
      const value = args[name];
      if (value !== undefined && (!Number.isInteger(value) || value < (name === "page" ? 1 : 0))) throw new HomeError(`${name} must be a non-negative whole number${name === "page" ? " starting at 1" : ""}`);
    }
    if ((args.page ?? 1) > 100) throw new HomeError("page must be no more than 100");
    if (args.min_price !== undefined && args.max_price !== undefined && args.min_price > args.max_price) throw new HomeError("min_price cannot exceed max_price");
    if (args.property_type && !PROPERTY_TYPES.includes(args.property_type)) throw new HomeError("property_type is not supported");
    if (args.sort && !SORTS.includes(args.sort)) throw new HomeError("sort is not supported");
    const query: Record<string, string> = { daterange: `${months}months`, sort: sortParam(args.sort ?? "newest"), page: String(args.page ?? 1) };
    if (args.min_price !== undefined) query["minprice"] = String(args.min_price);
    if (args.max_price !== undefined) query["maxprice"] = String(args.max_price);
    if (args.property_type) query[args.property_type === "semi_detached" ? "semi" : args.property_type] = "1";
    const areas = postcode.full
      ? [{ slug: `${postcode.outcode}-${postcode.full.split(" ")[1]![0]}`.toLowerCase(), scope: "postcode sector", name: postcode.full.slice(0, -2) },
        { slug: postcode.outcode.toLowerCase(), scope: "postcode district", name: postcode.outcode }]
      : [{ slug: postcode.outcode.toLowerCase(), scope: "postcode district", name: postcode.outcode }];
    for (const [index, area] of areas.entries()) {
      const raw = object(await this.homeGet(`/sold-properties/${area.slug}/`, query));
      // An unknown slug redirects to the national page, which also answers JSON:
      // the latest sales anywhere in the country. Never present those as local.
      if (raw["isNationalSearch"] !== false || !object(raw["filters"])["gid"]) continue;
      // A city-centre sector can hold one or two sales a year; widen to the district
      // rather than answer from a handful.
      if (index < areas.length - 1 && Number(raw["total"] ?? 0) < MIN_SECTOR_SALES) continue;
      const pagination = object(raw["pagination"]);
      const target = postcode.full?.replace(/\s+/g, "");
      return {
        area: area.name,
        area_type: area.scope,
        postcode: postcode.full ?? postcode.outcode,
        period: `sales recorded in the last ${months} months`,
        total: raw["total"] ?? pagination["total"] ?? null,
        page: pagination["current_page"] ?? args.page ?? 1,
        last_page: pagination["last_page"] ?? null,
        sales: (Array.isArray(raw["properties"]) ? raw["properties"] : []).map((value) => {
          const sale = object(value);
          return {
            address: sale["display_address"] ?? sale["full_address"] ?? null,
            postcode: sale["postcode"] ?? null,
            price: sale["price"] ?? null,
            sold_date: sale["sold_date"] ?? null,
            property_type: sale["property_type"] ?? null,
            bedrooms: sale["bedrooms"] ?? null,
            ...(target ? { same_postcode: String(sale["postcode"] ?? "").replace(/\s+/g, "").toUpperCase() === target } : {}),
          };
        }),
        source: "Recorded sale prices (HM Land Registry price paid data) as published on home.co.uk",
        not_a_valuation: "These are past sale prices of other homes. They are not a valuation of any home.",
        page_url: absoluteHomeUrl(`/sold-properties/${area.slug}/`),
      };
    }
    throw new HomeError(`home.co.uk has no sold-price area for ${postcode.full ?? postcode.outcode}`);
  }

  /**
   * Agents ranked by how many homes they list in an area right now. home.co.uk's own
   * directory order puts partner agents first; this tool ranks by listings only.
   */
  async agents(location: string, agentType: "sales" | "lettings", limit = 10): Promise<JsonObject> {
    if (!text(location)) throw new HomeError("location is required");
    if (!["sales", "lettings"].includes(agentType)) throw new HomeError("agent_type must be sales or lettings");
    if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new HomeError("limit must be a whole number from 1 to 20");
    const postcode = parsePostcode(location);
    const area = postcode?.full ? slug(postcode.full) : postcode ? postcode.outcode.toLowerCase() : slug(location);
    if (!area) throw new HomeError("location must be a UK town, city or postcode");
    const path = `/api/agents/search/${encodeURIComponent(area)}/${agentType}`;
    let raw: JsonObject;
    try {
      raw = object(await this.homeGet(path, { per_page: String(AGENT_PAGE_SIZE) }));
    } catch (error) {
      // An unknown location redirects through the HTML directory and ends in a 4xx.
      if (error instanceof HomeUpstreamError && error.status !== undefined && error.status < 500) raw = {};
      else throw error;
    }
    // "property" mode counts each agent's listings inside the searched boundary.
    // Any other mode counts an agent's whole stock, which cannot rank an area.
    if (raw["searchMode"] !== "property") throw new HomeError(`home.co.uk could not match ${location.trim()} to an area; try a town or postcode`);
    const ranked = (await this.everyAreaAgent(path, raw))
      .map((agent) => ({ agent, count: Number(agent["boundary_listing_count"] ?? agent["property_count"] ?? 0) }))
      .filter(({ count }) => Number.isFinite(count) && count > 0)
      .sort((a, b) => b.count - a.count || String(a.agent["agent_name"] ?? "").localeCompare(String(b.agent["agent_name"] ?? "")));
    const listed = agentType === "sales" ? "homes_for_sale_here" : "homes_to_let_here";
    return {
      area: raw["boundaryName"] ?? raw["displayLocation"] ?? location.trim(),
      agent_type: agentType,
      ranked_by: `Homes each agent is currently ${agentType === "sales" ? "selling" : "letting"} in this area on home.co.uk`,
      agents_with_listings: ranked.length,
      agents: ranked.slice(0, limit).map(({ agent, count }, index) => ({
        rank: index + 1,
        name: agent["agent_name"] ?? agent["name"] ?? null,
        branch: agent["branch_name"] ?? agent["branch_location"] ?? null,
        [listed]: count,
        office: agent["address_lines"] ?? null,
        office_postcode: agent["postcode"] ?? null,
        website: text(agent["website_url"]),
        profile_url: agent["id"] !== undefined ? absoluteHomeUrl(`/agents/${String(agent["id"])}/${slug(String(agent["agent_name"] ?? "agent")) || "agent"}`) : null,
      })),
      page_url: absoluteHomeUrl(`/agents/search/${area}/${agentType}/`),
    };
  }

  /**
   * Every agent in the searched area, not just the first page: the directory is
   * paginated in partner-first order, so the busiest agent can sit on any page
   * (London sales: 1,845 agents, the top one on page 2). `allPins` carries every
   * agent with its in-area count in one answer; card details come from the pages.
   * If the pins are missing or short of the total, every page is read instead.
   */
  private async everyAreaAgent(path: string, first: JsonObject): Promise<JsonObject[]> {
    const cards = (raw: JsonObject) => (Array.isArray(raw["agents"]) ? raw["agents"] : []).map(object);
    const total = Number(first["total"] ?? object(first["pagination"])["total"] ?? 0);
    const pins = (Array.isArray(first["allPins"]) ? first["allPins"] : []).map(object);
    let agents = cards(first);
    if (pins.length && pins.length >= total) {
      const details = new Map(agents.map((agent) => [String(agent["id"]), agent]));
      return pins.map((pin) => ({ ...pin, ...details.get(String(pin["id"])) }));
    }
    const lastPage = Number(object(first["pagination"])["last_page"] ?? 1);
    if (!Number.isInteger(lastPage) || lastPage > AGENT_MAX_PAGES) {
      this.logger(`Home agent search has too many pages to rank: GET ${path}`, { lastPage, total });
      throw new HomeUpstreamError("Not available right now.");
    }
    for (let page = 2; page <= lastPage; page += 4) {
      const batch = Array.from({ length: Math.min(4, lastPage - page + 1) }, (_, i) => page + i);
      const answers = await Promise.all(batch.map((n) => this.homeGet(path, { per_page: String(AGENT_PAGE_SIZE), page: String(n) })));
      agents = agents.concat(...answers.map((answer) => cards(object(answer))));
    }
    return agents;
  }

  /** Typical asking rents for a postcode district or town, from home.co.uk's JSON API. */
  async rents(location: string): Promise<JsonObject> {
    if (!text(location)) throw new HomeError("location is required");
    const postcode = parsePostcode(location);
    if (!postcode && !slug(location)) throw new HomeError("location must be a UK town, city or postcode");
    let raw: JsonObject;
    try {
      const area = postcode ? location.trim() : slug(location.replace(/['’]/g, ""));
      raw = object(await this.homeGet(`/api/v1/rental-prices/${encodeURIComponent(area)}`));
    } catch (error) {
      if (error instanceof HomeUpstreamError && error.status === 404) raw = {};
      else throw error;
    }
    if (!("homes_to_rent" in raw) || !Object.keys(object(raw["area"])).length) {
      throw new HomeError(`home.co.uk has no rental price data for ${location.trim()}; try a postcode district such as BA1`);
    }
    return {
      ...raw,
      ...(postcode?.full ? { postcode: postcode.full, note: `Figures cover the whole ${text(object(raw["area"])["name"]) ?? postcode.outcode} postcode district.` } : {}),
      not_achieved_rents: "These are asking rents of homes currently advertised, not agreed rents.",
    };
  }

  async calculator(kind: "stamp_duty" | "mortgage", query: Record<string, string>): Promise<unknown> {
    return this.data(`/calculators/${kind === "stamp_duty" ? "stamp-duty" : "mortgage"}/`, query);
  }

  private async enrich(
    listingId: string,
    publishedUprn: unknown,
    address: string,
    postcode: string | null,
    buildingNumber: string | null,
    buildingName: string | null,
  ): Promise<JsonObject> {
    const directUprn = (typeof publishedUprn === "string" || typeof publishedUprn === "number") && /^\d+$/.test(String(publishedUprn))
      ? String(publishedUprn)
      : null;
    if (directUprn) {
      this.listingRoutes.set(listingId, { kind: "home", uprn: directUprn, source: "listing_uprn" });
      return this.propertyEnrichment(directUprn, postcode, "listing_uprn");
    }

    const known = this.listingRoutes.peek(listingId);
    if (known?.kind === "home") return this.propertyEnrichment(known.uprn, postcode, known.source);
    if (known?.kind === "area") return (await this.areaEnrichment(known.postcode)) ?? { ...NO_ENRICHMENT };
    if (known?.kind === "none") return { ...NO_ENRICHMENT };

    // Only a definite answer is remembered: a failed address lookup is retried next time.
    let definite = true;
    if (address && postcode && (buildingNumber || buildingName)) {
      const found = await this.data("/address/match/", { address, postcode });
      if (isUnavailable(found)) definite = false;
      const body = object(found);
      const match = this.sameAddress(body, postcode, buildingNumber, buildingName) ? body : null;
      const matchedUprn = match?.["uprn"];
      if ((typeof matchedUprn === "string" || typeof matchedUprn === "number") && /^\d+$/.test(String(matchedUprn))) {
        this.listingRoutes.set(listingId, { kind: "home", uprn: String(matchedUprn), source: "exact_address_match" });
        return this.propertyEnrichment(String(matchedUprn), postcode, "exact_address_match");
      }
    }

    const area = postcode ? await this.areaEnrichment(postcode) : null;
    if (definite && area?.["scope"] === "area") this.listingRoutes.set(listingId, { kind: "area", postcode: String(area["postcode"]) });
    else if (definite && !area) this.listingRoutes.set(listingId, { kind: "none" });
    return area ?? { ...NO_ENRICHMENT };
  }

  /** Postcode-level facts labelled as such, or null when the postcode is not a full one. */
  private async areaEnrichment(postcode: string): Promise<JsonObject | null> {
    try {
      const area = await this.area(postcode);
      const names = ["crime", "schools", "broadband", "deprivation", "price_growth"];
      const unavailable = names.filter((name) => isUnavailable(area[name]));
      if (unavailable.length === names.length) return { ...UNAVAILABLE, unavailable };
      const facts = buyerPropertyFacts(area);
      for (const name of ["deprivation", "price_growth"] as const) {
        const value = area[name];
        if (!isUnavailable(value) && Object.keys(object(value)).length) facts[name] = value;
      }
      return {
        available: true,
        scope: "area",
        postcode: area["postcode"],
        notice: "These are postcode-level area facts. They are not facts about this home.",
        ...(unavailable.length ? { unavailable } : {}),
        // The standalone area tool keeps the complete source answers. The home
        // widget gets the same small, stable buyer-facing shape as home facts.
        area: facts,
      };
    } catch (error) {
      if (!(error instanceof HomeError)) throw error;
      return null;
    }
  }

  private async propertyEnrichment(uprn: string, postcode: string | null, source: "listing_uprn" | "exact_address_match"): Promise<JsonObject> {
    let property = this.cachedHomes.get(uprn);
    if (property === undefined) {
      const core = await this.data(`/property/${encodeURIComponent(uprn)}/core/`, {});
      if (object(core)["available"] === false) return { ...UNAVAILABLE };
      property = buyerPropertyFacts(core);
      // Keep only the minimised projection in memory, not the private core record.
      this.cachedHomes.set(uprn, structuredClone(property));
    } else property = structuredClone(property);
    return { available: true, scope: "home", source, property };
  }

  private async postcodeAt(latitude: unknown, longitude: unknown): Promise<string | null> {
    const lat = coordinate(latitude); const lng = coordinate(longitude);
    if (!lat || !lng) return null;
    let result: JsonObject;
    try { result = object(await this.homeGet("/api/reverse-geocode", { lat, lng })); }
    catch (error) { if (error instanceof HomeUpstreamError) return null; throw error; }
    if (result["success"] !== true) return null;
    const context = Array.isArray(result["context"]) ? result["context"].map(object) : [];
    const postcodeContext = context.find((item) => text(item["id"])?.startsWith("postcode"));
    const candidate = text(postcodeContext?.["text"])
      ?? text(result["place_name"])?.match(/[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}/i)?.[0]
      ?? null;
    return candidate && POSTCODE.test(candidate) ? candidate : null;
  }

  private sameAddress(candidate: JsonObject, postcode: string, buildingNumber: string | null, buildingName: string | null): boolean {
    const full = text(candidate["full_address"] ?? candidate["display_address"] ?? candidate["address"]) ?? "";
    const candidatePostcode = text(candidate["postcode"]) ?? full.match(/[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\s*$/i)?.[0] ?? null;
    const compact = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!candidatePostcode || compact(candidatePostcode) !== compact(postcode)) return false;
    const sameIdentifier = (expected: string, field: unknown): boolean => {
      const direct = text(field);
      if (direct && compact(direct) === compact(expected)) return true;
      // Address match can return one formatted address rather than split
      // building fields. The first comma-delimited line is the building.
      const building = full.split(",", 1)[0]?.trim() ?? "";
      const escaped = expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`^${escaped}(?:\\s|,|$)`, "i").test(building);
    };
    return buildingNumber
      ? sameIdentifier(buildingNumber, candidate["building_number"])
      : buildingName !== null && sameIdentifier(buildingName, candidate["building_name"]);
  }

  private async data(path: string, query: Record<string, string>): Promise<unknown> {
    const response: ApiResponse = await this.options.homedata.send("GET", path, query);
    if (response.statusCode >= 400) {
      this.logger(`Home Homedata request failed: GET ${path}`, { statusCode: response.statusCode, body: response.body });
      return { ...UNAVAILABLE };
    }
    return response.body;
  }

  private async homeGet(path: string, query: Record<string, string> = {}): Promise<unknown> {
    const url = new URL(this.homeBaseUrl + path);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const headers: Record<string, string> = { Accept: "application/json", "User-Agent": "home-chatgpt-app/1.0" };
      const secret = this.options.listingViewSecret?.trim();
      const trustedListingRequest = Boolean(secret) && url.pathname.startsWith("/api/property-details/");
      if (trustedListingRequest) headers["X-Home-Listing-Secret"] = secret!;
      const response = await this.fetchImpl(url, { headers, signal: controller.signal, ...(trustedListingRequest ? { redirect: "error" } : {}) });
      const raw = await response.text().catch(() => "");
      let value: unknown;
      try { value = raw === "" ? null : JSON.parse(raw); }
      catch {
        this.logger(`Home upstream request returned invalid JSON: GET ${url.pathname}`, { statusCode: response.status, body: raw });
        throw new HomeUpstreamError("Not available right now.", response.status, true);
      }
      if (!response.ok) {
        this.logger(`Home upstream request failed: GET ${url.pathname}`, { statusCode: response.status, body: value });
        throw new HomeUpstreamError("Not available right now.", response.status);
      }
      return value;
    } catch (error) {
      if (error instanceof HomeUpstreamError) throw error;
      this.logger(`Home upstream request failed: GET ${url.pathname}`, error);
      throw new HomeUpstreamError("Not available right now.");
    } finally { clearTimeout(timer); }
  }
}
