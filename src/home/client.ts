import { HomedataClient, type ApiResponse } from "../client.js";

const DEFAULT_HOME_URL = "https://home.co.uk";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const POSTCODE = /\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i;

export class HomeError extends Error {}

export interface HomeClientOptions {
  homeBaseUrl?: string;
  homedata: HomedataClient;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
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
};

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
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

  constructor(private readonly options: HomeClientOptions) {
    this.homeBaseUrl = (options.homeBaseUrl ?? DEFAULT_HOME_URL).replace(/\/+$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  async search(args: SearchArgs): Promise<JsonObject> {
    if (!text(args.location)) throw new HomeError("location is required");
    if (!(["sale", "rent"] as unknown[]).includes(args.listing_type)) throw new HomeError("listing_type must be sale or rent");
    for (const name of ["min_price", "max_price", "min_beds", "max_beds", "page"] as const) {
      const value = args[name];
      if (value !== undefined && (!Number.isInteger(value) || value < (name === "page" ? 1 : 0))) throw new HomeError(`${name} must be a non-negative whole number${name === "page" ? " starting at 1" : ""}`);
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
    const raw = object(await this.homeGet(`/api/${route}/${location}/`, query));
    const pagination = object(raw["pagination"]);
    return {
      location: raw["displayLocation"] ?? args.location,
      listing_type: args.listing_type,
      total: raw["total"] ?? pagination["total"] ?? null,
      page: pagination["current_page"] ?? args.page ?? 1,
      last_page: pagination["last_page"] ?? null,
      homes: (Array.isArray(raw["properties"]) ? raw["properties"] : []).map(trimCard),
    };
  }

  async home(listingId: string): Promise<JsonObject> {
    if (!UUID.test(listingId)) throw new HomeError("listing_id must be a UUID returned by search_homes");
    const detail = object(await this.homeGet(`/api/property-details/${listingId}`));
    if (!Object.keys(detail).length) throw new HomeError("Home was not found");
    // The lightweight detail endpoint carries the description and property facts;
    // the postcode search carries the complete photo set, agent and listing dates.
    const postcode = text(detail["postcode"]);
    const transaction = detail["transaction_type"] === "Rent" || detail["is_for_sale"] === false ? "to-rent" : "for-sale";
    let listing: JsonObject = {};
    if (postcode) {
      const search = object(await this.homeGet(`/api/${transaction}/${encodeURIComponent(postcode)}/`, { per_page: "120" }));
      listing = object((Array.isArray(search["properties"]) ? search["properties"] : []).find((p) => String(object(p)["listing_id"] ?? object(p)["id"]) === listingId));
    }
    const combined = { ...listing, ...detail, listing_id: listingId };
    const address = [detail["building_name"], detail["building_number"], detail["street_name"], detail["locality"], detail["town_name"], detail["postcode"]]
      .filter((v) => typeof v === "string" && v.trim()).join(", ");
    return {
      ...trimCard(combined),
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
      enrichment: await this.enrich(address, postcode),
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

  private async enrich(address: string, postcode: string | null): Promise<JsonObject> {
    if (!address) return { available: false, reason: "This listing does not publish an address that can be matched." };
    const found = await this.data("/address/find/", { q: address });
    const body = object(found);
    const candidates = Array.isArray(body["results"]) ? body["results"] : Array.isArray(found) ? found : [];
    const first = object(candidates[0]);
    const uprn = first["uprn"];
    if ((typeof uprn !== "string" && typeof uprn !== "number") || !/^\d+$/.test(String(uprn))) {
      return { available: false, reason: "No exact UPRN match was found for the published address." };
    }
    const core = await this.data(`/property/${encodeURIComponent(String(uprn))}/core/`, {});
    return { available: true, uprn: String(uprn), postcode, property: core };
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
      if (!response.ok) throw new HomeError(`home.co.uk returned HTTP ${response.status}`);
      return value;
    } finally { clearTimeout(timer); }
  }
}
