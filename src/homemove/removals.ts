import { MotusRefusal, type MotusClient, type PickerItem, type PickerRoom } from "./motus.js";
import type { QuoteAnswer, QuoteRequest } from "./quote.js";

/**
 * Removals are priced from what is moving, like homemove.com's marketplace
 * guide price: the inventory's volume, the driving distance and the origin's
 * region (motus get_removals_quote). Nothing is priced from a guessed
 * inventory: without one, the answer is the website's item picker.
 */

export const REMOVALS = /\b(removals?|removal (company|firm|men)|movers?|moving (company|firm|van)|man (and|&|with a) van|move my (stuff|things|furniture)|house move)\b/i;

/** Words people use for picker items ("sofa" is a three-seater unless they say otherwise). */
const SAYINGS: Array<[RegExp, string]> = [
  [/\b(king|kingsize|king size) bed/i, "Kingsize Bed & Mattress"],
  [/\bdouble bed|\bbed\b/i, "Double Bed & Mattress"],
  [/\bsingle bed|kids'? bed|child'?s bed/i, "Single Bed & Mattress"],
  [/\b(two|2)[- ]?seat(er)? sofa|loveseat/i, "Two Seater Sofa"],
  [/\b(four|4)[- ]?seat(er)? sofa|corner sofa/i, "Four Seater Sofa"],
  [/\bsofa|settee|couch/i, "Three Seater Sofa"],
  [/\barm ?chair/i, "Armchair"],
  [/\bsingle wardrobe/i, "Single Wardrobe"],
  [/\bwardrobe box/i, "Wardrobe Box"],
  [/\bwardrobe/i, "Double Wardrobe"],
  [/\b(chest of drawers|drawers|dresser)\b/i, "Chest Of Drawers"],
  [/\bbedside/i, "Bedside Table"],
  [/\bfridge|freezer/i, "Fridge Freezer"],
  [/\bwashing machine|washer\b/i, "Washing Machine"],
  [/\btumble ?dryer|dryer/i, "Tumble Dryer"],
  [/\bdish ?washer/i, "Dishwasher"],
  [/\bmicrowave/i, "Microwave Oven"],
  [/\bcooker|oven/i, "Cooker"],
  [/\b(big|large) (tv|telly|television)|\btv\b|\btelly\b|television/i, "Large Television/TV (Greater than 40\")"],
  [/\bdining table/i, "6 Seater Dining Table"],
  [/\bdining chairs?|\bchairs?\b/i, "Dining Chair"],
  [/\bdesk\b/i, "Desk"],
  [/\boffice chair/i, "Office Chair"],
  [/\bbook ?(case|shelf|shelves)/i, "Bookcase"],
  [/\bcoffee table/i, "Coffee Table"],
  [/\bbikes?|bicycles?/i, "Bicycle"],
  [/\b(lawn ?mower|mower)/i, "Lawn Mower"],
  [/\bsuitcases?/i, "Suitcase"],
  [/\b(large|big) box/i, "Large Box"],
  [/\bsmall box/i, "Small Box"],
  [/\bbox(es)?|cartons?/i, "Medium Box"],
  [/\bbags?\b/i, "Bag"],
];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function findItem(rooms: PickerRoom[], said: string): PickerItem | undefined {
  const items = rooms.flatMap((r) => r.items);
  const exact = items.find((i) => norm(i.name) === norm(said));
  if (exact) return exact;
  const saying = SAYINGS.find(([re]) => re.test(said));
  if (saying) return items.find((i) => i.name === saying[1]);
  const words = norm(said).split(" ").filter((w) => w.length > 2);
  const scored = items.map((i) => ({ i, n: words.filter((w) => norm(i.name).includes(w)).length })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n);
  return scored[0] && (scored.length === 1 || scored[0].n > scored[1]!.n) ? scored[0].i : undefined;
}

export interface MovingItem { item: string; quantity?: number }

/**
 * A typical household by home size, from the website's own picker items, for an
 * indicative guide price before anyone lists their things. Always labelled as
 * "a typical N-bedroom home"; the room-by-room picker and homemove.com refine it.
 */
const ONE_BED: Array<[string, number]> = [["Double Bed & Mattress", 1], ["Double Wardrobe", 1], ["Chest Of Drawers", 1], ["Bedside Table", 2], ["Two Seater Sofa", 1], ["Coffee Table", 1],
  ["Large Television/TV (Greater than 40\")", 1], ["TV Stand", 1], ["Fridge Freezer", 1], ["Washing Machine", 1], ["4 Seater Dining Table", 1], ["Dining Chair", 4], ["Medium Box", 15], ["Large Box", 5], ["Suitcase", 2]];
const EXTRA_DOUBLE: Array<[string, number]> = [["Double Bed & Mattress", 1], ["Double Wardrobe", 1], ["Chest Of Drawers", 1], ["Bedside Table", 2], ["Medium Box", 10], ["Large Box", 3]];
const EXTRA_SINGLE: Array<[string, number]> = [["Single Bed & Mattress", 1], ["Single Wardrobe", 1], ["Chest Of Drawers", 1], ["Medium Box", 8], ["Large Box", 2]];
const FAMILY: Array<[string, number]> = [["Three Seater Sofa", 1], ["Armchair", 1], ["Bookcase", 1], ["Tumble Dryer", 1], ["Dishwasher", 1], ["Desk", 1], ["Office Chair", 1], ["Garden Table", 1], ["Garden Chair", 4], ["Lawn Mower", 1], ["Bicycle", 2]];
export const HOME_SIZES: Record<string, { label: string; items: Array<[string, number]> }> = {
  studio: { label: "a typical studio flat", items: ONE_BED.filter(([n]) => !/Dining|Two Seater/.test(n)).concat([["Two Seater Sofa", 1]]).map(([n, q]) => [n, n === "Medium Box" ? 10 : q] as [string, number]) },
  "1_bed": { label: "a typical 1-bedroom home", items: ONE_BED },
  "2_bed": { label: "a typical 2-bedroom home", items: [...ONE_BED, ...EXTRA_DOUBLE] },
  "3_bed": { label: "a typical 3-bedroom home", items: [...ONE_BED, ...EXTRA_DOUBLE, ...EXTRA_SINGLE, ...FAMILY] },
  "4_bed": { label: "a typical 4-bedroom home", items: [...ONE_BED, ...EXTRA_DOUBLE, ...EXTRA_DOUBLE, ...EXTRA_SINGLE, ...FAMILY, ["Sideboard", 1], ["Armchair", 1]] },
  "5_bed": { label: "a typical 5-bedroom home", items: [...ONE_BED, ...EXTRA_DOUBLE, ...EXTRA_DOUBLE, ...EXTRA_SINGLE, ...EXTRA_SINGLE, ...FAMILY, ["Sideboard", 1], ["Armchair", 2], ["Display Cabinet", 1]] },
};
export const HOME_SIZE_OPTIONS = ["Studio", "1 bedroom", "2 bedrooms", "3 bedrooms", "4 bedrooms", "5+ bedrooms"];
export function homeSizeKey(said: unknown): string | undefined {
  if (said === undefined || said === null || said === "") return undefined;
  const text = String(said).toLowerCase();
  if (/studio/.test(text)) return "studio";
  const n = Number.parseInt(text, 10);
  return Number.isFinite(n) && n > 0 ? `${Math.min(5, n)}_bed` : undefined;
}

export async function removals(request: QuoteRequest & { to_postcode?: string; items?: MovingItem[]; inventory?: Record<string, number>; home_size?: string }, motus: MotusClient): Promise<QuoteAnswer> {
  const product = { id: 1054, name: "Removals", type: "removals" as const };
  // Without motus's removals pricing (an outage, or before it is deployed) the honest answer is
  // homemove.com's own removals form, never an error and never a guessed price.
  let rooms: PickerRoom[];
  try { rooms = await motus.removalsPicker(); }
  catch { return { status: "quoted_by_hand", product, postcode: request.postcode, answers: [] }; }
  const inventory: Record<string, number> = {};
  const unmatched: string[] = [];
  for (const [id, qty] of Object.entries(request.inventory ?? {})) {
    if (/^\d+$/.test(id) && Number.isInteger(qty) && qty > 0) inventory[id] = Math.min(100, qty);
  }
  for (const { item, quantity } of request.items ?? []) {
    const found = findItem(rooms, item);
    if (!found) { unmatched.push(item); continue; }
    inventory[String(found.id)] = Math.min(100, (inventory[String(found.id)] ?? 0) + Math.max(1, Math.round(quantity ?? 1)));
  }

  // No list of things yet: a home size gives an indicative price from a typical household.
  const size = homeSizeKey(request.home_size ?? request.answers?.["home_size"] ?? (request.bedrooms ? String(request.bedrooms) : undefined));
  let indicative: string | undefined;
  if (!Object.keys(inventory).length && size) {
    for (const [name, qty] of HOME_SIZES[size]!.items) {
      const found = rooms.flatMap((r) => r.items).find((i) => i.name === name);
      if (found) inventory[String(found.id)] = (inventory[String(found.id)] ?? 0) + qty;
    }
    indicative = HOME_SIZES[size]!.label;
  }
  const questions = [];
  if (!request.to_postcode) questions.push({ name: "to_postcode", question: "What's the postcode you're moving to?", options: [] as string[] });
  if (!Object.keys(inventory).length) questions.push({ name: "home_size", question: "How big is the home you're moving out of?", options: HOME_SIZE_OPTIONS });
  if (questions.length) {
    // The destination already given travels with the questions, so the card's re-ask keeps it.
    return { status: "needs_answers", product, postcode: request.postcode, ...(request.to_postcode ? { to_postcode: request.to_postcode } : {}), assumed: [], answers: [], questions, picker: rooms, ...(unmatched.length ? { unmatched } : {}) };
  }

  try {
    const q = await motus.removalsQuote({ from: request.postcode, to: request.to_postcode!, inventory });
    if (!q.price_gbp) return { status: "quoted_by_hand", product, postcode: request.postcode, answers: [] };
    const names = new Map(rooms.flatMap((r) => r.items).map((i) => [String(i.id), i.name]));
    return {
      status: "priced", product, price_gbp: q.price_gbp, postcode: request.postcode, assumed: [],
      answers: [{ name: "to_postcode", label: request.to_postcode! }],
      booking_url: `https://homemove.com/removals/quote/?pc=${encodeURIComponent(request.postcode.replace(/\s+/g, "").toUpperCase())}`,
      breakdown: [],
      move: {
        // As the person wrote them (motus echoes them without the space).
        from: request.postcode.toUpperCase(), to: request.to_postcode!.toUpperCase(), distance_km: q.distance_km ?? null,
        cubic_meters: q.cubic_meters ?? null, van_type: q.van_type ?? null, num_vans: q.num_vans ?? null, crew_size: q.crew_size ?? null, estimated_hours: q.estimated_hours ?? null,
        items: Object.entries(inventory).map(([id, qty]) => ({ name: names.get(id) ?? `Item ${id}`, quantity: qty })),
        inventory,
      },
      ...(unmatched.length ? { unmatched } : {}),
      ...(indicative ? { indicative } : {}),
    };
  } catch (error) {
    if (error instanceof MotusRefusal && error.code === "quote_unavailable") return { status: "quoted_by_hand", product, postcode: request.postcode, answers: [] };
    throw error;
  }
}
