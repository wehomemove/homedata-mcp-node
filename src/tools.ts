/**
 * Tool implementations shared by the MCP server and the CLI.
 * Each function takes a HomedataClient and the relevant inputs, returns a
 * structured response. No MCP-specific dependencies — both surfaces import these.
 */

import type { HomedataClient, HomedataResponse } from "./client.js";

// Canonical singular route. The deprecated plural `/api/properties/{uprn}/`
// is being sunset; the `base` tier is its true superset successor.
export const lookup_property = (c: HomedataClient, uprn: string) =>
  c.get(`/api/property/${encodeURIComponent(uprn)}/base/`);

// Property tiers — strict supersets: address ⊂ base ⊂ core ⊂ complete.
export type PropertyTier = "address" | "base" | "core" | "complete";
export const get_property_tier = (c: HomedataClient, uprn: string, tier: PropertyTier = "base") =>
  c.get(`/api/property/${encodeURIComponent(uprn)}/${encodeURIComponent(tier)}/`);

// Valuation estimate — sale or rent. bedrooms / property_type are optional
// overrides; the engine falls back to the property record when omitted.
export const estimate_valuation = (
  c: HomedataClient,
  uprn: string,
  type: "sale" | "rent" = "sale",
  bedrooms?: number,
  property_type?: string,
) => c.get(`/api/valuations/estimate/`, { uprn, type, bedrooms, property_type });

// Council tax band only — cheaper than the full council_tax bundle.
export const lookup_council_tax_band = (c: HomedataClient, uprn: string) =>
  c.get(`/api/council_tax_band/${encodeURIComponent(uprn)}/`);

export const lookup_epc = (c: HomedataClient, uprn: string) =>
  c.get(`/api/epc-checker/${encodeURIComponent(uprn)}/`);

export const lookup_flood_risk = (c: HomedataClient, uprn: string) =>
  c.get(`/api/flood-risk/`, { uprn });

export const get_property_sales = (c: HomedataClient, uprn: string) =>
  c.get(`/api/property_sales/`, { uprn });

export const search_property_listings = (c: HomedataClient, uprn: string) =>
  c.get(`/api/property_listings/`, { uprn });

export const get_comparables = (c: HomedataClient, uprn: string, count = 20) =>
  c.get(`/api/comparables/${encodeURIComponent(uprn)}/`, { count });

export const get_planning_applications = (c: HomedataClient, uprn: string) =>
  c.get(`/api/planning/search/`, { uprn });

export const get_schools = (c: HomedataClient, uprn: string, radius_m = 1000) =>
  c.get(`/api/schools/`, { uprn, radius_m });

export const get_transport = (c: HomedataClient, uprn: string, radius_m = 800) =>
  c.get(`/api/transport/`, { uprn, radius_m });

export const get_crime = (c: HomedataClient, postcode: string, date?: string) =>
  c.get(`/api/crime/`, { postcode, date });

export const get_demographics = (c: HomedataClient, postcode: string) =>
  c.get(`/api/demographics/`, { postcode });

export const get_broadband = (c: HomedataClient, postcode: string) =>
  c.get(`/api/broadband/`, { postcode });

export const get_postcode_profile = (c: HomedataClient, postcode: string) =>
  c.get(`/api/postcode-profile/`, { postcode });

export const search_address = (c: HomedataClient, query: string, postcode?: string) =>
  c.get(`/api/address/find/`, { q: query, postcode });

export const batch_property_lookup = (c: HomedataClient, uprns: string[]) =>
  c.post(`/api/property/batch/`, { uprns });

// Full council tax bundle (band + charges). Live since the council_tax split —
// the old 503 "coming soon" stub was removed in 0.2.0.
export const lookup_council_tax = (c: HomedataClient, uprn: string): Promise<HomedataResponse> =>
  c.get(`/api/council_tax/${encodeURIComponent(uprn)}/`);
