/**
 * Tool implementations shared by the MCP server and the CLI.
 * Each function takes a HomedataClient and the relevant inputs, returns a
 * structured response. No MCP-specific dependencies — both surfaces import these.
 */

import type { HomedataClient, HomedataResponse } from "./client.js";

export const lookup_property = (c: HomedataClient, uprn: string) =>
  c.get(`/api/properties/${encodeURIComponent(uprn)}/`);

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

export const lookup_council_tax = (_c: HomedataClient, _uprn: string): Promise<HomedataResponse> =>
  // Short-circuit — endpoint is documented "coming soon" and 404s today.
  // Matches the Python 0.1.1 fix; keeps behaviour aligned across SDKs.
  Promise.resolve({
    error: "in_development",
    status_code: 503,
    detail: "Council tax band is in development. See https://homedata.co.uk/changelog",
  });
