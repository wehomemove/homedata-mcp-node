import { HomeError, HomeSearchRequiredError, HomeUpstreamError, parsePostcode, type HomeClient, type HomeLocation } from "./client.js";

/**
 * Commute and viewing-day answers from Mapbox, server side only. The token is
 * the public pk. browser token the widget already uses; it is sent to Mapbox
 * only and never appears in a tool answer or a log line.
 */
const DEFAULT_MAPBOX_URL = "https://api.mapbox.com";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const TRAVEL_MODES = ["walk", "cycle", "drive"] as const;
export type TravelMode = typeof TRAVEL_MODES[number];
export const PLACE_KINDS = ["station", "school", "office", "postcode", "address"] as const;
export type PlaceKind = typeof PLACE_KINDS[number];

const PROFILE: Record<TravelMode, string> = { walk: "mapbox/walking", cycle: "mapbox/cycling", drive: "mapbox/driving" };
const MODE_WORDS: Record<TravelMode, string> = { walk: "walk", cycle: "cycle", drive: "drive" };
/**
 * How far, in metres, Mapbox may simplify the outline. Unsimplified, a 30-minute
 * drive is over 6,000 points; these keep any outline to a few hundred. A home
 * within this distance of the line is flagged near_edge rather than trusted.
 */
const GENERALIZE_METRES: Record<TravelMode, number> = { walk: 25, cycle: 75, drive: 150 };
/** Categories tried first for a station or a school, before an open search. */
const CATEGORIES: Partial<Record<PlaceKind, string>> = {
  station: "railway_station,light_rail_station,public_transportation_station",
  school: "school,elementary_school,high_school,education",
};
/** Words that name a kind of place, not which one; they cannot make a match on their own. */
const GENERIC_WORDS = new Set(["the", "a", "an", "of", "and", "near", "in", "at", "on", "uk", "station", "railway", "rail", "train", "tube", "school", "primary", "secondary", "academy", "office", "offices", "hq", "head", "building"]);
/**
 * Kind words that must still be true of the answer, in its name, street or
 * Mapbox category: Bath Spa station is "Bath Spa" in the transport category,
 * and Bath Road in Bridgwater is no answer to "Station Road, Bath".
 */
const KIND_FAMILIES: Array<[PlaceKind, RegExp, RegExp]> = [
  ["station", /^(?:station|railway|rail|train|tube)$/, /station|railway|rail/],
  ["school", /^(?:school|primary|secondary|academy)$/, /school|education|academy/],
];
const words = (value: string) => value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/['’]/g, "").split(/[^a-z0-9]+/).filter((word) => word.length > 1);

/** "Edward's" and "Edwards", "Hospital" and "Hospitals" are one word here. */
const stems = (value: string) => new Set(words(value).map((word) => word.length > 3 ? word.replace(/s$/, "") : word));

/**
 * Search Box always answers with something: "zzqxv nowhere" comes back as a
 * council office in Norwich, and "King Edward's School, Bath" sits among Bath
 * Theatre School and Bath Guitar School. So every word of the query that says
 * which place (kind words such as "school" never count) must be in the
 * candidate's name or its surroundings (street, town, postcode), and one of
 * them must be in the name alone. A town only qualifies the search: "Bath"
 * cannot make Bath Theatre School into King Edward's, and "Malmesbury" cannot
 * make any office there into Dyson's. A candidate whose whole name is query
 * words, such as the town of Bath itself, also counts.
 */
export function namesPlace(query: string, candidate: { name: string; where: string; categories?: string[] }, kind?: PlaceKind): boolean {
  const name = stems(candidate.name); const where = stems(candidate.where);
  const categories = (candidate.categories ?? []).join(" ");
  for (const word of stems(query)) {
    const family = KIND_FAMILIES.find(([, words]) => words.test(word));
    if (!family || name.has(word) || where.has(word)) continue;
    // Only a search for that kind may lean on the category: a bus stop called
    // Bath Road is filed as a transport station, but "Station Road" is a road.
    if (family[0] !== kind || !family[2].test(categories)) return false;
  }
  const asked = [...stems(query)].filter((word) => !GENERIC_WORDS.has(word));
  if (!asked.length || !asked.every((word) => name.has(word) || where.has(word))) return false;
  return asked.some((word) => name.has(word) && !where.has(word)) || extraWords(query, candidate.name) === 0;
}

/** Words in a candidate's name that the query did not ask for: "Bounce Luggage Storage - Bath Spa Station" has three for "Bath Spa station". */
export function extraWords(query: string, name: string): number {
  const asked = stems(query);
  return [...stems(name)].filter((word) => !GENERIC_WORDS.has(word) && !asked.has(word)).length;
}

/** The candidate's surroundings, which qualify a query but never name the place. */
function surroundings(properties: JsonObject): string {
  const context = object(properties["context"]);
  return [properties["address"], properties["place_formatted"], ...Object.values(context).map((part) => object(part)["name"])]
    .filter((value): value is string => typeof value === "string").join(" ");
}

const MAX_COMMUTE_HOMES = 20;
const LOCATE_AT_ONCE = 5;

export interface Place {
  query: string;
  name: string;
  address: string | null;
  type: string | null;
  coordinates: { latitude: number; longitude: number };
}

export interface MapboxRoutesOptions {
  token: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** Sent as Referer, so a URL restriction added to the token later still admits this server. */
  referer?: string;
  logger?: (message: string, detail: unknown) => void;
}

export type CommuteArgs = { place?: unknown; place_kind?: unknown; minutes?: unknown; mode?: unknown; listing_ids?: unknown };
export type ViewingArgs = { listing_ids?: unknown; start?: unknown; start_kind?: unknown };

type JsonObject = Record<string, unknown>;
type Position = [number, number];
type Ring = Position[];
type Trip = { order: number[]; legs: Array<{ duration: number; distance: number }>; duration: number; distance: number; geometry: unknown };

const object = (value: unknown): JsonObject => value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
const text = (value: unknown): string | null => typeof value === "string" && value.trim() ? value.trim() : null;
const round = (value: number, places = 5) => Number(value.toFixed(places));
const minutes = (seconds: number) => Math.round(seconds / 60);
const km = (metres: number) => round(metres / 1000, 1);

function listingIds(value: unknown, min: number, max: number, name: string): string[] {
  const range = min === max ? `${min}` : `${min} to ${max}`;
  if (!Array.isArray(value) || value.length < min || value.length > max || !value.every((id) => typeof id === "string")) {
    throw new HomeError(`${name} must contain ${range} listing UUIDs returned by search_homes`);
  }
  const ids = value.map((id: string) => id.trim());
  const bad = ids.find((id) => !UUID.test(id));
  if (bad !== undefined) throw new HomeError(`${bad || "an empty string"} is not a listing UUID returned by search_homes`);
  if (new Set(ids.map((id) => id.toLowerCase())).size !== ids.length) throw new HomeError(`${name} lists the same home twice`);
  return ids;
}

function placeKind(value: unknown, name: string): PlaceKind | undefined {
  if (value === undefined) return undefined;
  if (!(PLACE_KINDS as readonly unknown[]).includes(value)) throw new HomeError(`${name} must be one of ${PLACE_KINDS.join(", ")}`);
  return value as PlaceKind;
}

/** Ray casting on longitude and latitude, which is exact enough at town scale. */
function inRing([x, y]: Position, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!; const [xj, yj] = ring[j]!;
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Polygons as lists of rings, the first the outline and the rest holes. */
function polygons(geometry: JsonObject): Ring[][] {
  const coordinates = geometry["coordinates"];
  if (geometry["type"] === "Polygon" && Array.isArray(coordinates)) return [coordinates as Ring[]];
  if (geometry["type"] === "MultiPolygon" && Array.isArray(coordinates)) return coordinates as Ring[][];
  return [];
}

export function insideArea(point: Position, geometry: JsonObject): boolean {
  return polygons(geometry).some(([outline, ...holes]) => outline !== undefined && inRing(point, outline) && !holes.some((hole) => inRing(point, hole)));
}

/** Metres from a point to the nearest edge of the area, on a local flat projection. */
export function metresToEdge([lng, lat]: Position, geometry: JsonObject): number {
  const mx = 111_320 * Math.cos((lat * Math.PI) / 180); const my = 110_574;
  let best = Infinity;
  for (const ring of polygons(geometry).flat()) {
    for (let i = 1; i < ring.length; i++) {
      const ax = (ring[i - 1]![0] - lng) * mx, ay = (ring[i - 1]![1] - lat) * my;
      const bx = (ring[i]![0] - lng) * mx, by = (ring[i]![1] - lat) * my;
      const dx = bx - ax, dy = by - ay; const length = dx * dx + dy * dy;
      const t = length ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / length)) : 0;
      best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
    }
  }
  return best;
}

function roundGeometry(value: unknown): unknown {
  if (typeof value === "number") return round(value);
  return Array.isArray(value) ? value.map(roundGeometry) : value;
}

function card(home: HomeLocation): JsonObject {
  return { listing_id: home.listing_id, address: home.address, postcode: home.postcode, url: home.url, coordinates: home.coordinates };
}

export class MapboxRoutes {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly logger: (message: string, detail: unknown) => void;

  constructor(private readonly options: MapboxRoutesOptions) {
    if (!options.token?.startsWith("pk.")) throw new Error("MapboxRoutes needs a Mapbox pk. token");
    this.baseUrl = (options.baseUrl ?? DEFAULT_MAPBOX_URL).replace(/\/+$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.logger = options.logger ?? ((message, detail) => console.error(message, detail));
  }

  /** The area reachable from a place in a time, and which of the given homes are inside it. */
  async commute(client: HomeClient, args: CommuteArgs): Promise<JsonObject> {
    const query = text(args.place);
    if (!query) throw new HomeError("place is required: a station, office, school, address or full UK postcode");
    const kind = placeKind(args.place_kind, "place_kind");
    const mode = args.mode;
    if (!(TRAVEL_MODES as readonly unknown[]).includes(mode)) throw new HomeError("mode must be walk, cycle or drive");
    const limit = args.minutes;
    if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > 60) throw new HomeError("minutes must be a whole number from 1 to 60");
    const ids = args.listing_ids === undefined ? [] : listingIds(args.listing_ids, 1, MAX_COMMUTE_HOMES, "listing_ids");

    const located = await this.locateSome(client, ids);
    const homes = located.filter((home): home is HomeLocation & { coordinates: NonNullable<HomeLocation["coordinates"]> } => "coordinates" in home && home.coordinates !== null);
    const place = await this.place(query, kind, homes.map((home) => home.coordinates));
    const travel = mode as TravelMode;
    const answer = object(await this.mapbox(`/isochrone/v1/${PROFILE[travel]}/${place.coordinates.longitude},${place.coordinates.latitude}`, {
      contours_minutes: String(limit), polygons: "true", denoise: "1", generalize: String(GENERALIZE_METRES[travel]),
    }));
    if (answer["code"] === "NoSegment") throw new HomeError(`Mapbox has no ${travel === "drive" ? "road" : "road or path"} near ${place.name}, so it cannot measure a ${MODE_WORDS[travel]} from there; try a nearby address or postcode`);
    const feature = object((Array.isArray(answer["features"]) ? answer["features"] : [])[0]);
    const geometry = roundGeometry(object(feature["geometry"])) as JsonObject;
    if (!polygons(geometry).length) {
      this.logger("Home Mapbox isochrone returned no area", { code: answer["code"], message: answer["message"] });
      throw new HomeUpstreamError("Not available right now.");
    }

    const inside: JsonObject[] = []; const outside: JsonObject[] = [];
    for (const home of homes) {
      const point: Position = [home.coordinates.longitude, home.coordinates.latitude];
      const nearEdge = metresToEdge(point, geometry) <= GENERALIZE_METRES[travel];
      (insideArea(point, geometry) ? inside : outside).push({ ...card(home), ...(nearEdge ? { near_edge: true } : {}) });
    }
    const notChecked = located.filter((home) => !("coordinates" in home) || home.coordinates === null)
      .map((home) => ({ listing_id: home.listing_id, reason: "reason" in home ? home.reason : "The listing publishes no map position." }));
    const journey = `${limit} minutes' ${travel === "walk" ? "walk" : travel === "cycle" ? "cycle" : "drive"}`;
    return {
      place,
      mode: travel,
      minutes: limit,
      ...(ids.length ? {
        summary: `${inside.length} of ${homes.length} ${homes.length === 1 ? "home is" : "homes are"} within ${journey} of ${place.name}.`,
        homes_inside: inside,
        homes_outside: outside,
        ...(notChecked.length ? { homes_not_checked: notChecked } : {}),
      } : {}),
      reachable_area: { type: "Feature", properties: { mode: travel, minutes: limit }, geometry },
      note: `The area is Mapbox's estimate of where a ${journey} from ${place.name} reaches on ${travel === "drive" ? "roads without traffic" : travel === "cycle" ? "roads and cycle paths" : "streets and paths"}. It is a typical journey, not a timetable${travel === "drive" ? " or rush-hour time" : ""}. A home marked near_edge is within ${GENERALIZE_METRES[travel]} metres of the line, so treat it as borderline.`,
    };
  }

  /** The quickest driving order for a viewing day, with each leg, the total and the route line. */
  async viewings(client: HomeClient, args: ViewingArgs): Promise<JsonObject> {
    const ids = listingIds(args.listing_ids, 2, 6, "listing_ids");
    const startQuery = args.start === undefined ? null : text(args.start);
    if (args.start !== undefined && !startQuery) throw new HomeError("start must be a place, such as an address, station or full UK postcode, or left out");
    const startKind = placeKind(args.start_kind, "start_kind");
    const homes = await Promise.all(ids.map((id) => client.locate(id)));
    const unplaced = homes.find((home) => home.coordinates === null);
    if (unplaced) throw new HomeError(`Home ${unplaced.listing_id} publishes no map position, so it cannot be put on a route; plan without it`);
    const points = homes.map((home) => [home.coordinates!.longitude, home.coordinates!.latitude] as Position);
    const start = startQuery ? await this.place(startQuery, startKind, homes.map((home) => home.coordinates!)) : null;

    let trip: Trip; let homeOrder: number[]; let method: string;
    if (start) {
      // An open path from a fixed start: Mapbox needs a fixed end too, so try
      // every home as the last stop and keep the quickest.
      const origin: Position = [start.coordinates.longitude, start.coordinates.latitude];
      const tries = await Promise.all(points.map(async (_, last) => {
        const middle = points.map((_, i) => i).filter((i) => i !== last);
        const stops = [-1, ...middle, last];
        const found = await this.trip(stops.map((i) => i < 0 ? origin : points[i]!), { roundtrip: "false", source: "first", destination: "last" });
        return { trip: found, homes: found.order.map((at) => stops[at]!).filter((i) => i >= 0) };
      }));
      const best = tries.reduce((a, b) => b.trip.duration < a.trip.duration ? b : a);
      trip = best.trip; homeOrder = best.homes;
      method = `Mapbox's optimisation service, trying each home as the last stop from ${start.name} and keeping the quickest.`;
    } else {
      // No start: find the quickest loop, open it at its longest leg, then let
      // Mapbox order the stops between those two ends.
      const loop = await this.trip(points, { roundtrip: "true" });
      let longest = 0;
      loop.legs.forEach((leg, i) => { if (leg.duration > loop.legs[longest]!.duration) longest = i; });
      const first = loop.order[(longest + 1) % loop.order.length]!; const last = loop.order[longest]!;
      const stops = [first, ...points.map((_, i) => i).filter((i) => i !== first && i !== last), last];
      trip = await this.trip(stops.map((i) => points[i]!), { roundtrip: "false", source: "first", destination: "last" });
      homeOrder = trip.order.map((at) => stops[at]!);
      method = "Mapbox's optimisation service: the quickest loop through the homes, opened at its longest leg so no drive is wasted returning.";
    }

    let elapsed = 0;
    const stops = homeOrder.map((index, stop) => {
      const leg = start ? trip.legs[stop] : stop ? trip.legs[stop - 1] : undefined;
      elapsed += leg?.duration ?? 0;
      return {
        stop: stop + 1,
        ...card(homes[index]!),
        ...(leg ? { drive_from_previous_minutes: minutes(leg.duration), drive_from_previous_km: km(leg.distance) } : {}),
        driving_minutes_so_far: minutes(elapsed),
      };
    });
    return {
      start,
      stops,
      total_driving_minutes: minutes(trip.duration),
      total_km: km(trip.distance),
      route: roundGeometry(trip.geometry),
      order_found_by: method,
      note: "Driving times are Mapbox estimates without live traffic. They leave out parking and the time spent at each viewing; book viewings with time to spare and confirm each slot with its agent.",
    };
  }

  /** Each home's position; one that cannot be read is reported rather than failing the rest. */
  private async locateSome(client: HomeClient, ids: string[]): Promise<Array<HomeLocation | { listing_id: string; reason: string }>> {
    const found: Array<HomeLocation | { listing_id: string; reason: string }> = new Array(ids.length);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(LOCATE_AT_ONCE, ids.length) }, async () => {
      for (let i = next++; i < ids.length; i = next++) {
        try { found[i] = await client.locate(ids[i]!); }
        catch (error) {
          if (error instanceof HomeSearchRequiredError) found[i] = { listing_id: ids[i]!, reason: error.message };
          else if (error instanceof HomeError) found[i] = { listing_id: ids[i]!, reason: "This home was not found on home.co.uk." };
          else if (error instanceof HomeUpstreamError) found[i] = { listing_id: ids[i]!, reason: "Not available right now." };
          else throw error;
        }
      }
    }));
    return found;
  }

  /**
   * A place in the UK from free text. A full postcode goes to the postcode
   * index; a station or school tries its category first; anything else, or a
   * category with no match, is an open search. Results near the homes win.
   */
  async place(query: string, kind: PlaceKind | undefined, near: Array<{ latitude: number; longitude: number }> = []): Promise<Place> {
    const postcode = parsePostcode(query);
    if (kind === "postcode" && !postcode?.full) throw new HomeError(`${query} is not a full UK postcode, such as BA1 1SU`);
    if (!postcode?.full && words(query).every((word) => GENERIC_WORDS.has(word))) {
      throw new HomeError(`"${query}" does not say which place; name it with its town, such as "Bath Spa station" or "King Edward's School, Bath"`);
    }
    const base: Record<string, string> = { country: "gb", limit: "5", language: "en" };
    if (near.length) {
      const lng = near.reduce((sum, p) => sum + p.longitude, 0) / near.length;
      const lat = near.reduce((sum, p) => sum + p.latitude, 0) / near.length;
      base["proximity"] = `${round(lng)},${round(lat)}`;
    }
    // "Paddington station" with no kind is still a station: without the category,
    // the open search near Bath answers Paddington Play Station in Tidworth. Only
    // a kind word that ends a part of the query counts: "Station Road, Bath" is a road.
    const ends = query.split(",").map((part) => words(part).at(-1));
    const inferred = kind ?? (ends.some((word) => word === "station") ? "station" : ends.some((word) => word === "school") ? "school" : undefined);
    const attempts: Array<Record<string, string>> = [];
    if (postcode?.full) attempts.push({ ...base, q: postcode.full, types: "postcode" });
    else {
      const category = inferred ? CATEGORIES[inferred] : undefined;
      if (category) {
        attempts.push({ ...base, q: query, types: "poi", poi_category: category });
        // The category index names a station "Bath Spa", not "Bath Spa station".
        const bare = query.replace(inferred === "station" ? /\s*\b(?:(?:railway|rail|train|tube|underground)\s+)?station\s*(?=,|$)/gi : /\s*\bschool\s*(?=,|$)/gi, "").replace(/\s+/g, " ").trim();
        if (bare && bare.toLowerCase() !== query.toLowerCase()) attempts.push({ ...base, q: bare, types: "poi", poi_category: category });
      }
      attempts.push({ ...base, q: query });
    }
    for (const attempt of attempts) {
      const features = object(await this.mapbox("/search/searchbox/v1/forward", attempt))["features"];
      const candidates = (Array.isArray(features) ? features : []).map(object).flatMap((feature) => {
        const point = object(feature["geometry"])["coordinates"];
        if (!Array.isArray(point) || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) return [];
        const properties = object(feature["properties"]);
        const name = String(properties["name"] ?? "");
        // An unknown postcode comes back as a different one ("BA1 9ZZ" as "GU2 9ZZ").
        const matches = attempt["types"] === "postcode"
          ? name.replace(/\s+/g, "").toUpperCase() === postcode!.full!.replace(/\s+/g, "")
          : namesPlace(query, { name, where: surroundings(properties), categories: Array.isArray(properties["poi_category_ids"]) ? properties["poi_category_ids"].map(String) : [] }, inferred);
        return matches ? [{ properties, point: point as Position, extra: attempt["types"] === "postcode" ? 0 : extraWords(query, name) }] : [];
      });
      // The closest name wins, then Mapbox's own order: Bath Spa station over the luggage shop beside it.
      const best = candidates.reduce<typeof candidates[number] | undefined>((a, b) => !a || b.extra < a.extra ? b : a, undefined);
      if (!best) continue;
      return {
        query,
        name: text(best.properties["name"]) ?? query,
        address: text(best.properties["full_address"]) ?? text(best.properties["place_formatted"]),
        type: text(best.properties["feature_type"]),
        coordinates: { latitude: round(Number(best.point[1])), longitude: round(Number(best.point[0])) },
      };
    }
    if (postcode?.full) throw new HomeError(`Mapbox does not know the postcode ${postcode.full}; check it, or give an address or place instead`);
    throw new HomeError(`Mapbox found no place in the UK matching "${query}"; add the town, or give an address or full postcode`);
  }

  private async trip(points: Position[], query: Record<string, string>): Promise<Trip> {
    const answer = object(await this.mapbox(`/optimized-trips/v1/mapbox/driving/${points.map(([lng, lat]) => `${lng},${lat}`).join(";")}`, {
      ...query, geometries: "geojson", overview: "simplified",
    }));
    const code = answer["code"];
    if (code === "NoTrips" || code === "NoRoute" || code === "NoSegment") {
      throw new HomeError("Mapbox found no driving route that reaches every home; check that each home's map position is on the mainland road network, or plan without the outlying one");
    }
    const found = object((Array.isArray(answer["trips"]) ? answer["trips"] : [])[0]);
    const waypoints = Array.isArray(answer["waypoints"]) ? answer["waypoints"].map(object) : [];
    const legs = (Array.isArray(found["legs"]) ? found["legs"] : []).map(object).map((leg) => ({ duration: Number(leg["duration"]), distance: Number(leg["distance"]) }));
    const order = waypoints.map((point, input) => ({ input, at: Number(point["waypoint_index"]) })).sort((a, b) => a.at - b.at).map(({ input }) => input);
    const expectedLegs = query["roundtrip"] === "true" ? points.length : points.length - 1;
    if (code !== "Ok" || waypoints.length !== points.length || new Set(order).size !== points.length || legs.length !== expectedLegs ||
        legs.some((leg) => !Number.isFinite(leg.duration) || !Number.isFinite(leg.distance)) || !Number.isFinite(Number(found["duration"]))) {
      this.logger("Home Mapbox optimisation returned an unusable trip", { code, message: answer["message"] });
      throw new HomeUpstreamError("Not available right now.");
    }
    return { order, legs, duration: Number(found["duration"]), distance: Number(found["distance"]), geometry: found["geometry"] ?? null };
  }

  /** One Mapbox GET. Refusals, outages and non-JSON answers are upstream failures; the token is never logged. */
  private async mapbox(path: string, query: Record<string, string>): Promise<unknown> {
    const url = new URL(this.baseUrl + path);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    url.searchParams.set("access_token", this.options.token);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const where = `GET ${new URL(this.baseUrl + path).pathname.split("/").slice(0, 4).join("/")}`;
    try {
      const response = await this.fetchImpl(url, {
        headers: { Accept: "application/json", "User-Agent": "home-chatgpt-app/1.0", ...(this.options.referer ? { Referer: this.options.referer } : {}) },
        signal: controller.signal,
      });
      const raw = await response.text().catch(() => "");
      let value: unknown;
      try { value = JSON.parse(raw); } catch {
        this.logger(`Home Mapbox request returned invalid JSON: ${where}`, { statusCode: response.status });
        throw new HomeUpstreamError("Not available right now.", response.status, true);
      }
      if (!response.ok) {
        this.logger(`Home Mapbox request failed: ${where}`, { statusCode: response.status, message: object(value)["message"] });
        throw new HomeUpstreamError("Not available right now.", response.status);
      }
      return value;
    } catch (error) {
      if (error instanceof HomeUpstreamError) throw error;
      this.logger(`Home Mapbox request failed: ${where}`, error instanceof Error ? error.message : error);
      throw new HomeUpstreamError("Not available right now.");
    } finally { clearTimeout(timer); }
  }
}
