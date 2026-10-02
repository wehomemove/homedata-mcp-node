import { HomedataClient, type ApiResponse } from "../client.js";

const DEFAULT_HOME_URL = "https://home.co.uk";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const POSTCODE = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i;

export class HomeError extends Error {}
export class HomeUpstreamError extends Error {}

export interface HomeClientOptions {
  homeBaseUrl?: string;
  homedata: HomedataClient;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  now?: () => Date;
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
};

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function coordinate(value: unknown): string | null {
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(numeric) ? String(numeric) : null;
}

function absoluteHomeUrl(value: unknown): string | null {
  const path = text(value);
  if (!path) return null;
  try { return new URL(path, DEFAULT_HOME_URL).toString(); } catch { return null; }
}

/** Only fields useful on a search card. Never return card_html, boundaries or map pins. */
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
    construction_age_band: p["construction_age_band"] ?? null,
    added_date: p["added_date"] ?? null,
    days_listed: p["days_listed"] ?? null,
    reduced_date: p["reduced_date"] ?? null,
    under_offer_date: p["first_offer_date"] ?? null,
    image: absoluteHomeUrl(object(primary)["thumbnail_cdn_url"] ?? object(primary)["cdn_url"] ?? p["main_image"]),
    agent: p["agent_name"] ?? null,
  };
}

export class HomeClient {
  private readonly homeBaseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly now: () => Date;

  constructor(private readonly options: HomeClientOptions) {
    this.homeBaseUrl = (options.homeBaseUrl ?? DEFAULT_HOME_URL).replace(/\/+$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.now = options.now ?? (() => new Date());
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
    if (args.property_type && !["detached", "semi_detached", "terraced", "flat"].includes(args.property_type)) throw new HomeError("property_type is not supported");
    if (args.sort && !["newest", "oldest", "price_asc", "price_desc"].includes(args.sort)) throw new HomeError("sort is not supported");
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
    const signalFilters = args.reduced_within_days !== undefined || args.on_market_at_least_days !== undefined || args.new_within_days !== undefined;
    const firstPage = args.page ?? 1;
    const maxPages = signalFilters ? 3 : 1;
    const cards: JsonObject[] = [];
    let firstRaw: JsonObject = {};
    let lastPage: number | null = null;
    let pagesScanned = 0;
    let lastSourcePageHadResults = false;
    let nextPage: number | null = null;
    for (let offset = 0; offset < maxPages && cards.length < 20; offset += 1) {
      const currentPage = firstPage + offset;
      query["page"] = String(currentPage);
      const raw = object(await this.homeGet(`/api/${route}/${location}/`, query));
      if (offset === 0) firstRaw = raw;
      const pagination = object(raw["pagination"]);
      const parsedLastPage = Number(pagination["last_page"]);
      if (Number.isInteger(parsedLastPage) && parsedLastPage >= 1) lastPage = parsedLastPage;
      pagesScanned += 1;
      const properties = Array.isArray(raw["properties"]) ? raw["properties"] : [];
      lastSourcePageHadResults = properties.length > 0;
      const matches = properties.filter((property) => this.matchesMarketSignals(object(property), args)).map(trimCard);
      // A source page is the smallest safe continuation unit. If adding it
      // would cross the response cap, leave the entire page for the next call
      // so no matching home is duplicated or skipped.
      if (cards.length > 0 && cards.length + matches.length > 20) {
        nextPage = currentPage;
        break;
      }
      cards.push(...matches);
      if (!signalFilters || properties.length === 0 || (lastPage !== null && currentPage >= lastPage)) break;
    }
    const lastScannedPage = firstPage + pagesScanned - 1;
    if (signalFilters && nextPage === null && lastSourcePageHadResults) {
      const sourceHasMore = lastPage !== null ? lastScannedPage < lastPage : true;
      if (sourceHasMore && (cards.length >= 20 || pagesScanned === maxPages)) nextPage = lastScannedPage + 1;
    }
    const morePages = nextPage !== null;
    const homes = cards;
    const pagination = object(firstRaw["pagination"]);
    return {
      location: firstRaw["displayLocation"] ?? args.location,
      listing_type: args.listing_type,
      total: signalFilters ? null : firstRaw["total"] ?? pagination["total"] ?? null,
      page: pagination["current_page"] ?? firstPage,
      last_page: pagination["last_page"] ?? null,
      ...(signalFilters ? {
        source_total: firstRaw["total"] ?? pagination["total"] ?? null,
        matching_homes_returned: homes.length,
        pages_scanned: pagesScanned,
        results_limited: morePages,
        ...(nextPage !== null ? {
          next_page: nextPage,
          note: `Market-signal filters checked ${pagesScanned} source page${pagesScanned === 1 ? "" : "s"} from page ${firstPage}. More source results remain; call search_homes again with page ${nextPage} and the same filters to continue.`,
        } : {}),
      } : {}),
      homes,
    };
  }

  private matchesMarketSignals(property: JsonObject, args: SearchArgs): boolean {
    if (args.on_market_at_least_days !== undefined) {
      const days = Number(property["days_listed"]);
      if (!Number.isFinite(days) || days < args.on_market_at_least_days) return false;
    }
    const withinDays = (value: unknown, maximumDays: number | undefined): boolean => {
      if (maximumDays === undefined) return true;
      const date = text(value);
      if (!date) return false;
      const calendarParts = (input: Date): [number, number, number] | null => {
        if (!Number.isFinite(input.getTime())) return null;
        const parts = new Intl.DateTimeFormat("en-GB", {
          timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit",
        }).formatToParts(input);
        const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((item) => item.type === type)?.value);
        const values: [number, number, number] = [part("year"), part("month"), part("day")];
        return values.every(Number.isInteger) ? values : null;
      };
      const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
      const listed = dateOnly
        ? [Number(dateOnly[1]), Number(dateOnly[2]), Number(dateOnly[3])] as [number, number, number]
        : calendarParts(new Date(date));
      const today = calendarParts(this.now());
      if (!listed || !today) return false;
      const ordinal = ([year, month, day]: [number, number, number]) => Date.UTC(year, month - 1, day) / 86_400_000;
      const ageInCalendarDays = ordinal(today) - ordinal(listed);
      return ageInCalendarDays >= 0 && ageInCalendarDays <= maximumDays;
    };
    return withinDays(property["reduced_date"], args.reduced_within_days)
      && withinDays(property["added_date"], args.new_within_days);
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
    }
    const card = { ...detail, ...listing, listing_id: listingId };
    const address = [detail["building_name"], detail["building_number"], detail["street_name"], detail["locality"], detail["town_name"], postcode]
      .filter((v) => typeof v === "string" && v.trim()).join(", ");
    return {
      ...trimCard(card),
      description: detail["description"] ?? null,
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
      enrichment: await this.enrich(detail["uprn"], address, postcode, text(detail["building_number"]), text(detail["building_name"])),
    };
  }

  async compare(listingIds: string[]): Promise<JsonObject> {
    return { homes: await Promise.all(listingIds.map((id) => this.home(id))) };
  }

  async area(postcode: string): Promise<JsonObject> {
    const compact = postcode.trim().toUpperCase().replace(/\s+/g, "");
    const normalised = compact.length > 3 ? `${compact.slice(0, -3)} ${compact.slice(-3)}` : compact;
    if (!POSTCODE.test(normalised)) throw new HomeError("postcode must be a full UK postcode");
    const outcode = normalised.split(/\s+/)[0]!;
    const calls = [
      ["crime", "/crime/", { postcode: normalised }],
      ["schools", "/schools/nearby", { postcode: normalised, limit: "10" }],
      ["broadband", "/broadband/", { postcode: normalised }],
      ["deprivation", "/deprivation/", { postcode: normalised }],
      ["price_growth", `/price-growth/${encodeURIComponent(outcode)}/`, {}],
    ] as const;
    const settled = await Promise.all(calls.map(async ([name, path, query]) => [name, await this.data(path, query)] as const));
    return { postcode: normalised, ...Object.fromEntries(settled) };
  }

  async calculator(kind: "stamp_duty" | "mortgage", query: Record<string, string>): Promise<unknown> {
    return this.data(`/calculators/${kind === "stamp_duty" ? "stamp-duty" : "mortgage"}/`, query);
  }

  private async enrich(
    publishedUprn: unknown,
    address: string,
    postcode: string | null,
    buildingNumber: string | null,
    buildingName: string | null,
  ): Promise<JsonObject> {
    const directUprn = (typeof publishedUprn === "string" || typeof publishedUprn === "number") && /^\d+$/.test(String(publishedUprn))
      ? String(publishedUprn)
      : null;
    if (directUprn) return this.propertyEnrichment(directUprn, postcode, "listing_uprn");

    if (address && postcode && (buildingNumber || buildingName)) {
      const found = await this.data("/address/find/", { q: address });
      const body = object(found);
      const candidates = Array.isArray(body["results"]) ? body["results"] : Array.isArray(found) ? found : [];
      const match = candidates.map(object).find((candidate) => this.sameAddress(candidate, postcode, buildingNumber, buildingName));
      const matchedUprn = match?.["uprn"];
      if ((typeof matchedUprn === "string" || typeof matchedUprn === "number") && /^\d+$/.test(String(matchedUprn))) {
        return this.propertyEnrichment(String(matchedUprn), postcode, "exact_address_match");
      }
    }

    if (postcode) {
      try {
        const area = await this.area(postcode);
        return {
          available: true,
          scope: "area",
          postcode: area["postcode"],
          notice: "These are postcode-level area facts. They are not facts about this home.",
          area,
        };
      } catch (error) {
        if (!(error instanceof HomeError)) throw error;
      }
    }
    return { available: false, reason: "No UPRN or valid full postcode was published for enrichment." };
  }

  private async propertyEnrichment(uprn: string, postcode: string | null, source: "listing_uprn" | "exact_address_match"): Promise<JsonObject> {
    const core = await this.data(`/property/${encodeURIComponent(uprn)}/core/`, {});
    return { available: true, scope: "home", source, uprn, postcode, property: core };
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
      // Address find commonly returns one formatted address rather than split
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
    if (response.statusCode >= 400) return { unavailable: true, status_code: response.statusCode, detail: response.body };
    return response.body;
  }

  private async homeGet(path: string, query: Record<string, string> = {}): Promise<unknown> {
    const url = new URL(this.homeBaseUrl + path);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(url, { headers: { Accept: "application/json", "User-Agent": "home-chatgpt-app/1.0" }, signal: controller.signal });
      const value = await response.json().catch(() => null);
      if (!response.ok) throw new HomeUpstreamError(`home.co.uk returned HTTP ${response.status}`);
      return value;
    } finally { clearTimeout(timer); }
  }
}
