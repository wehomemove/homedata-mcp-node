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

export async function removals(request: QuoteRequest & { to_postcode?: string; items?: MovingItem[]; inventory?: Record<string, number> }, motus: MotusClient): Promise<QuoteAnswer> {
  const product = { id: 1054, name: "Removals", type: "removals" as const };
  const rooms = await motus.removalsPicker();
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

  const questions = [];
  if (!request.to_postcode) questions.push({ name: "to_postcode", question: "What's the postcode you're moving to?", options: [] as string[] });
  if (!Object.keys(inventory).length) questions.push({ name: "inventory", question: "What are you moving? List the main furniture and roughly how many boxes, or pick room by room.", options: [] as string[] });
  if (questions.length) {
    return { status: "needs_answers", product, postcode: request.postcode, assumed: [], answers: [], questions, picker: rooms, ...(unmatched.length ? { unmatched } : {}) };
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
        from: q.from_postcode ?? request.postcode, to: q.to_postcode ?? request.to_postcode!, distance_km: q.distance_km ?? null,
        cubic_meters: q.cubic_meters ?? null, van_type: q.van_type ?? null, num_vans: q.num_vans ?? null, crew_size: q.crew_size ?? null, estimated_hours: q.estimated_hours ?? null,
        items: Object.entries(inventory).map(([id, qty]) => ({ name: names.get(id) ?? `Item ${id}`, quantity: qty })),
      },
      ...(unmatched.length ? { unmatched } : {}),
    };
  } catch (error) {
    if (error instanceof MotusRefusal && error.code === "quote_unavailable") return { status: "quoted_by_hand", product, postcode: request.postcode, answers: [] };
    throw error;
  }
}
