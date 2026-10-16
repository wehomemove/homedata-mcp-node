import type { HomedataClient } from "../client.js";
import type { MotusClient } from "./motus.js";
import type { PropertyLookup } from "./property.js";
import { quote, type QuoteAnswer, type QuoteRequest } from "./quote.js";

/**
 * A whole move, priced line by line. Each line is an ordinary homemove_quote,
 * so a figure appears only where motus (or Atlas through motus) priced it; a
 * line that needs more answers says so and is left out of the total. Stamp
 * duty is HMRC's tax from Homedata's calculator, shown apart from Homemove's
 * fees and never added to them.
 */

export type Situation = "buying" | "selling" | "buying_and_selling" | "renting" | "landlord";

export interface PlanRequest {
  situation: Situation;
  /** The home being bought or moved into. */
  to_postcode?: string;
  to_address?: string;
  /** The home being sold or moved out of. */
  from_postcode?: string;
  from_address?: string;
  /** Price of the home being bought (or sold, when only selling). */
  property_price?: number;
  sale_price?: number;
  first_time_buyer?: boolean;
  additional_property?: boolean;
  mortgage?: boolean;
  bedrooms?: number;
  items?: Array<{ item: string; quantity?: number }>;
}

export interface PlanLine {
  step: string;
  /** The postcode this step was quoted at, as the plan asked (not motus's echo). */
  postcode: string;
  why: string;
  service: string;
  answer: QuoteAnswer;
}

export interface MovePlan {
  situation: Situation;
  lines: PlanLine[];
  /** Homemove's priced lines only. */
  total_gbp: number;
  priced: number;
  unpriced: string[];
  stamp_duty?: { total_tax: number; note: string; jurisdiction: string; thresholds_from: string };
}

type Need = { step: string; why: string; request: QuoteRequest };

export function linesFor(plan: PlanRequest): Need[] {
  const buyAt = plan.to_postcode ?? "", sellAt = plan.from_postcode ?? "";
  const buying = plan.situation === "buying" || plan.situation === "buying_and_selling";
  const selling = plan.situation === "selling" || plan.situation === "buying_and_selling";
  const funding = plan.mortgage === undefined ? undefined : plan.mortgage ? "Mortgage" : "Cash";
  const needs: Need[] = [];
  if (selling && sellAt) {
    needs.push({ step: "Get an EPC", why: "You need a valid Energy Performance Certificate to market a home.", request: { service: "EPC", postcode: sellAt, address: plan.from_address } });
    needs.push({ step: "Instruct a conveyancer for the sale", why: "Handles the contract, title and redemption of any mortgage.", request: { service: "conveyancing selling", postcode: sellAt, address: plan.from_address, property_price: plan.sale_price, answers: { transaction: "Selling", ...(plan.mortgage !== undefined ? { funding_type: plan.mortgage ? "Yes, a mortgage" : "No mortgage" } : {}) } } });
  }
  if (buying && buyAt) {
    needs.push({ step: "Instruct a conveyancer for the purchase", why: "Searches, contracts, the transfer and the SDLT return.", request: { service: "conveyancing buying", postcode: buyAt, address: plan.to_address, property_price: plan.property_price, answers: { transaction: "Buying", ...(funding ? { funding_type: funding } : {}) } } });
    needs.push({ step: "Book a survey", why: "A Level 2 survey suits most homes in normal condition; older or altered homes may need a Level 3.", request: { service: "level 2 survey", postcode: buyAt, address: plan.to_address, property_price: plan.property_price } });
  }
  if (plan.situation === "landlord" && buyAt) {
    for (const [service, step, why] of [
      ["gas safety certificate", "Gas safety certificate (CP12)", "Landlords need one every year where there are gas appliances."],
      ["EICR", "Electrical safety report (EICR)", "Landlords in England need one at least every five years."],
      ["EPC", "EPC", "Needed before letting."],
    ] as const) needs.push({ step, why, request: { service, postcode: buyAt, address: plan.to_address } });
  }
  const from = sellAt || (plan.situation === "renting" ? sellAt : "");
  if (from && buyAt && plan.situation !== "landlord") {
    needs.push({ step: "Book removals", why: "Priced from what you're moving and how far.", request: { service: "removals", postcode: from, to_postcode: buyAt, items: plan.items, bedrooms: plan.bedrooms } as QuoteRequest });
  }
  if (plan.situation === "renting" && sellAt) {
    needs.push({ step: "End of tenancy clean", why: "A professional clean of the place you're leaving, before you hand back the keys.", request: { service: "end of tenancy clean", postcode: sellAt, address: plan.from_address, bedrooms: plan.bedrooms } });
  } else if (selling && sellAt) {
    needs.push({ step: "Moving-out clean", why: "Leaves the home ready for the buyers.", request: { service: "end of tenancy clean", postcode: sellAt, address: plan.from_address, bedrooms: plan.bedrooms } });
  }
  return needs;
}

export async function planMove(plan: PlanRequest, deps: { motus: MotusClient; property: PropertyLookup; homedata: HomedataClient }): Promise<MovePlan> {
  const needs = linesFor(plan);
  const answers = await Promise.all(needs.map(async (n) => {
    try { return await quote(n.request, deps); }
    catch { return { status: "quoted_by_hand", product: { id: 0, name: n.step, type: null }, postcode: n.request.postcode, answers: [] } as QuoteAnswer; }
  }));
  const lines = needs.map((n, i) => ({ step: n.step, postcode: n.request.postcode, why: n.why, service: String(n.request.service), answer: answers[i]! }));
  const priced = lines.filter((l) => l.answer.status === "priced");
  const total = priced.reduce((sum, l) => sum + (l.answer.status === "priced" ? l.answer.price_gbp : 0), 0);

  let stamp_duty: MovePlan["stamp_duty"];
  const buying = plan.situation === "buying" || plan.situation === "buying_and_selling";
  if (buying && plan.property_price) {
    const buyer = plan.additional_property ? "additional" : plan.first_time_buyer ? "first_time" : "standard";
    const sd = await deps.homedata.send("GET", "/calculators/stamp-duty/", { price: String(Math.round(plan.property_price)), buyer_type: buyer });
    const body = sd.body as { total_tax?: unknown; note?: unknown; jurisdiction?: unknown; thresholds_from?: unknown } | null;
    if (sd.statusCode < 400 && typeof body?.total_tax === "number") {
      stamp_duty = { total_tax: body.total_tax, note: String(body.note ?? ""), jurisdiction: String(body.jurisdiction ?? ""), thresholds_from: String(body.thresholds_from ?? "") };
    }
  }
  return {
    situation: plan.situation,
    lines,
    total_gbp: Math.round(total * 100) / 100,
    priced: priced.length,
    unpriced: lines.filter((l) => l.answer.status !== "priced").map((l) => l.step),
    ...(stamp_duty ? { stamp_duty } : {}),
  };
}
