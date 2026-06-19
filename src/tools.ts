/**
 * Tool implementations shared by the MCP server and the CLI.
 * Each function takes a HomedataClient and the relevant inputs, returns a
 * structured response. No MCP-specific dependencies — both surfaces import these.
 */

import type { HomedataClient, HomedataResponse } from "./client.js";

// Booleans go on the wire as "true"/"false" strings (Loki parses truthy strings).
const bool = (v: boolean | undefined): string | undefined =>
  v === undefined ? undefined : v ? "true" : "false";

// ── Property ────────────────────────────────────────────────────────────────

// Canonical singular route. The deprecated plural `/api/properties/{uprn}/` is
// being sunset; the `base` tier is its true superset successor.
export const lookup_property = (c: HomedataClient, uprn: string) =>
  c.get(`/api/property/${encodeURIComponent(uprn)}/base/`);

// Property tiers — strict supersets: address ⊂ base ⊂ core ⊂ complete.
export type PropertyTier = "address" | "base" | "core" | "complete";
export const get_property_tier = (c: HomedataClient, uprn: string, tier: PropertyTier = "base") =>
  c.get(`/api/property/${encodeURIComponent(uprn)}/${encodeURIComponent(tier)}/`);

// Discovery menu — which slugs/tiers are available for a UPRN, and per-slug cost.
// Call BEFORE picking a tier so you don't pay for data the property doesn't have.
export const discover_property = (c: HomedataClient, uprn: string) =>
  c.get(`/api/property/${encodeURIComponent(uprn)}/`);

// Custom à-la-carte bundle — only the slugs you ask for.
export const get_property_custom = (c: HomedataClient, uprn: string, slugs: string[]) =>
  c.get(`/api/property/${encodeURIComponent(uprn)}/`, { with: slugs.join(",") });

export const batch_property_lookup = (c: HomedataClient, uprns: string[]) =>
  c.post(`/api/property/batch/`, { uprns });

// ── EPC / council tax ─────────────────────────────────────────────────────────

export const lookup_epc = (c: HomedataClient, uprn: string) =>
  c.get(`/api/epc-checker/${encodeURIComponent(uprn)}/`);

// Full council tax bundle (band + charges + authority). Live since the
// council_tax split — the old 503 "coming soon" stub was removed in 0.2.0.
export const lookup_council_tax = (c: HomedataClient, uprn: string): Promise<HomedataResponse> =>
  c.get(`/api/council_tax/${encodeURIComponent(uprn)}/`);

// Council tax band only — cheaper than the full council_tax bundle.
export const lookup_council_tax_band = (c: HomedataClient, uprn: string) =>
  c.get(`/api/council_tax_band/${encodeURIComponent(uprn)}/`);

// ── Valuation / AVM ───────────────────────────────────────────────────────────

// Valuation estimate — sale or rent. bedrooms / property_type are optional
// overrides; the engine falls back to the property record when omitted.
export const estimate_valuation = (
  c: HomedataClient,
  uprn: string,
  type: "sale" | "rent" = "sale",
  bedrooms?: number,
  property_type?: string,
) => c.get(`/api/valuations/estimate/`, { uprn, type, bedrooms, property_type });

// AVM comparable-evidence set behind the valuation.
export const get_avm_comparables = (c: HomedataClient, uprn: string, count = 20) =>
  c.get(`/api/avm/`, { uprn, count });

// ── Sales / listings / comparables ────────────────────────────────────────────

export const get_property_sales = (c: HomedataClient, uprn: string) =>
  c.get(`/api/property_sales/`, { uprn });

export const get_lr_sales = (c: HomedataClient, uprn: string) =>
  c.get(`/api/lr-sales/`, { uprn });

export const search_property_listings = (c: HomedataClient, uprn: string) =>
  c.get(`/api/property_listings/`, { uprn });

export const get_comparables = (c: HomedataClient, uprn: string, count = 20) =>
  c.get(`/api/comparables/${encodeURIComponent(uprn)}/`, { count });

export interface LiveListingFilters {
  uprn?: string;
  transaction_type?: "Sale" | "Rental";
  min_bedrooms?: number;
  max_bedrooms?: number;
  min_price?: number;
  max_price?: number;
  property_type?: string; // comma-separated
  postcode?: string; // comma-separated
  new_builds_only?: boolean;
  reduced_only?: boolean;
  min_epc_band?: string;
  max_epc_band?: string;
  has_garden?: boolean;
  has_parking?: boolean;
  page?: number;
  page_size?: number;
  sort?: string;
}
export const search_live_listings = (c: HomedataClient, f: LiveListingFilters) =>
  c.get(`/api/live-listings/search/`, {
    uprn: f.uprn,
    transaction_type: f.transaction_type,
    min_bedrooms: f.min_bedrooms,
    max_bedrooms: f.max_bedrooms,
    min_price: f.min_price,
    max_price: f.max_price,
    property_type: f.property_type,
    postcode: f.postcode,
    new_builds_only: bool(f.new_builds_only),
    reduced_only: bool(f.reduced_only),
    min_epc_band: f.min_epc_band,
    max_epc_band: f.max_epc_band,
    has_garden: bool(f.has_garden),
    has_parking: bool(f.has_parking),
    page: f.page,
    page_size: f.page_size,
    sort: f.sort,
  });

// ── Address ───────────────────────────────────────────────────────────────────

export const search_address = (c: HomedataClient, query: string, postcode?: string) =>
  c.get(`/api/address/find/`, { q: query, postcode });

export const get_addresses_at_postcode = (c: HomedataClient, postcode: string) =>
  c.get(`/api/address/postcode/${encodeURIComponent(postcode)}/`);

// ── Local / area (postcode) ───────────────────────────────────────────────────

export const get_planning_applications = (c: HomedataClient, uprn: string) =>
  c.get(`/api/planning/search/`, { uprn });

export const get_schools = (
  c: HomedataClient,
  uprn: string,
  radius_km = 3,
  phase?: string,
  ofsted?: string,
) => c.get(`/api/schools/`, { uprn, radius_km, phase, ofsted });

export const get_transport = (c: HomedataClient, postcode: string, radius_km = 1) =>
  c.get(`/api/transport/`, { postcode, radius_km });

export const get_crime = (c: HomedataClient, postcode: string, date?: string, category?: string) =>
  c.get(`/api/crime/`, { postcode, date, category });

export const get_demographics = (c: HomedataClient, postcode: string) =>
  c.get(`/api/demographics/`, { postcode });

export const get_deprivation = (c: HomedataClient, postcode: string) =>
  c.get(`/api/deprivation/`, { postcode });

export const get_broadband = (c: HomedataClient, postcode: string) =>
  c.get(`/api/broadband/`, { postcode });

export const get_postcode_profile = (c: HomedataClient, postcode: string) =>
  c.get(`/api/postcode-profile/`, { postcode });

export const get_conservation_areas = (c: HomedataClient, postcode: string, radius_km?: number, limit?: number) =>
  c.get(`/api/conservation-areas/`, { postcode, radius_km, limit });

export const get_listed_buildings = (c: HomedataClient, postcode: string, radius_km?: number, grade?: string, limit?: number) =>
  c.get(`/api/listed-buildings/`, { postcode, radius_km, grade, limit });

export const get_planning_designations = (c: HomedataClient, postcode: string, radius_km?: number, type?: string, limit?: number) =>
  c.get(`/api/planning-designations/`, { postcode, radius_km, type, limit });

// ── Amenities / POIs (uprn OR lat+lng) ────────────────────────────────────────

export interface NearbyAnchor {
  uprn?: string;
  lat?: number;
  lng?: number;
  radius_km?: number;
  limit?: number;
  include_tags?: boolean;
}
export const get_amenities = (c: HomedataClient, a: NearbyAnchor) =>
  c.get(`/api/amenities/`, { uprn: a.uprn, lat: a.lat, lng: a.lng, radius_km: a.radius_km, limit: a.limit, include_tags: bool(a.include_tags) });

export const get_fuel_stations = (c: HomedataClient, a: NearbyAnchor) =>
  c.get(`/api/fuel-stations/`, { uprn: a.uprn, lat: a.lat, lng: a.lng, radius_km: a.radius_km, limit: a.limit, include_tags: bool(a.include_tags) });

export const get_healthcare = (c: HomedataClient, a: NearbyAnchor) =>
  c.get(`/api/healthcare/`, { uprn: a.uprn, lat: a.lat, lng: a.lng, radius_km: a.radius_km, limit: a.limit });

// ── Environment / risk (uprn OR lat+lng / title) ──────────────────────────────

export const lookup_flood_risk = (c: HomedataClient, uprn: string) =>
  c.get(`/api/flood-risk/`, { uprn });

export type RiskType =
  | "noise" | "flood" | "radon" | "landfill" | "coal_mining"
  | "invasive_plants" | "air_quality_today" | "all";
export const get_risks = (c: HomedataClient, risk_type: RiskType, uprn: string) =>
  c.get(`/api/risks/${encodeURIComponent(risk_type)}/`, { uprn });

export const get_energy = (c: HomedataClient, a: { uprn?: string; title_no?: string; lat?: number; lng?: number; radius_m?: number }) =>
  c.get(`/api/energy/`, { uprn: a.uprn, title_no: a.title_no, lat: a.lat, lng: a.lng, radius_m: a.radius_m });

export const get_brownfield = (c: HomedataClient, a: { uprn?: string; title_no?: string; lat?: number; lng?: number; radius_m?: number; include_historic?: boolean }) =>
  c.get(`/api/brownfield/`, { uprn: a.uprn, title_no: a.title_no, lat: a.lat, lng: a.lng, radius_m: a.radius_m, include_historic: bool(a.include_historic) });

export const get_boreholes = (c: HomedataClient, a: { uprn?: string; lat?: number; lng?: number; radius_m?: number }) =>
  c.get(`/api/boreholes/`, { uprn: a.uprn, lat: a.lat, lng: a.lng, radius_m: a.radius_m });

export const get_environment_report = (c: HomedataClient, a: { uprn?: string; title_no?: string; lat?: number; lng?: number }) =>
  c.get(`/api/environment-report/`, { uprn: a.uprn, title_no: a.title_no, lat: a.lat, lng: a.lng });

export const get_rights_of_way = (c: HomedataClient, a: { uprn?: string; lat?: number; lng?: number; radius_m?: number }) =>
  c.get(`/api/rights-of-way/`, { uprn: a.uprn, lat: a.lat, lng: a.lng, radius_m: a.radius_m });

export const get_solar_assessment = (c: HomedataClient, uprn: string) =>
  c.get(`/api/solar-assessment/${encodeURIComponent(uprn)}/`);

// ── Pricing trends (outcode) ──────────────────────────────────────────────────

export const get_price_trends = (c: HomedataClient, outcode: string) =>
  c.get(`/api/price_trends/${encodeURIComponent(outcode)}/`);

export const get_price_distribution = (c: HomedataClient, outcode: string) =>
  c.get(`/api/price_distributions/${encodeURIComponent(outcode)}/`);

export const get_price_growth = (c: HomedataClient, outcode: string) =>
  c.get(`/api/price-growth/${encodeURIComponent(outcode)}/`);

// ── Agent stats ───────────────────────────────────────────────────────────────

export const get_agent_stats = (c: HomedataClient, uprn: string) =>
  c.get(`/api/agent_stats/${encodeURIComponent(uprn)}/`);
