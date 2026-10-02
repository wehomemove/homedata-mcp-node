/**
 * The Bath scenarios recorded by scripts/home-record-routes.mjs and replayed by
 * home.test.ts. Listing IDs are real home.co.uk listings in Bath on the
 * recording date; the replay never reaches the network.
 */
export const BATH_HOMES = {
  paragon: "4f91b30b-99c9-4f23-bd3a-3fa842ce6014",
  hallFloor: "8d060aea-00ac-40fd-9cd6-7f182d135d68",
  oldfieldPark: "e00bc8f0-7f18-4a22-9506-39db58508669",
  twerton: "e8e714fb-cbb4-407c-a5e7-6798764868d4",
  upperWeston: "639e066f-95f7-485b-b0b9-778db067566d",
  peasedown: "b9f9c51d-987e-41f6-88cb-ffe1d8f2e01b",
  kensingtonPlace: "36d23aa4-ae79-48a8-901b-733491863e67",
  avondaleRoad: "16d50fe0-5b66-4ad1-a9df-c176e71ff85c",
} as const;

const H = BATH_HOMES;
export const BATH_ROUTE_SCENARIOS = [
  { id: "walk-bath-spa", tool: "commute_filter", args: { place: "Bath Spa station", place_kind: "station", minutes: 15, mode: "walk", listing_ids: [H.paragon, H.hallFloor, H.oldfieldPark, H.twerton, H.upperWeston, H.peasedown] } },
  { id: "drive-school", tool: "commute_filter", args: { place: "King Edward's School, Bath", place_kind: "school", minutes: 10, mode: "drive", listing_ids: [H.paragon, H.twerton, H.upperWeston, H.peasedown] } },
  { id: "cycle-postcode-area-only", tool: "commute_filter", args: { place: "BA1 1SU", minutes: 20, mode: "cycle" } },
  { id: "viewings-from-postcode", tool: "plan_viewings", args: { listing_ids: [H.kensingtonPlace, H.avondaleRoad, H.oldfieldPark, H.paragon], start: "BA1 1SU" } },
  { id: "viewings-no-start", tool: "plan_viewings", args: { listing_ids: [H.kensingtonPlace, H.avondaleRoad, H.oldfieldPark, H.paragon, H.upperWeston] } },
  // The same homes in another order, so the quickest last stop and the loop's longest leg are not the first ones tried.
  { id: "viewings-from-postcode-reordered", tool: "plan_viewings", args: { listing_ids: [H.paragon, H.oldfieldPark, H.avondaleRoad, H.kensingtonPlace], start: "BA1 1SU" } },
  { id: "viewings-no-start-reordered", tool: "plan_viewings", args: { listing_ids: [H.oldfieldPark, H.upperWeston, H.paragon, H.avondaleRoad, H.kensingtonPlace] } },
] as const;

/** A request's replay key: host, path and sorted query, without the token. */
export function routeFixtureKey(url: URL): string {
  const query = [...url.searchParams].filter(([key]) => key !== "access_token").sort(([a], [b]) => a.localeCompare(b));
  return `${url.host}${url.pathname}${query.length ? `?${new URLSearchParams(query)}` : ""}`;
}
