import { AddressNotMatched, type PropertyFacts, type PropertyLookup } from "./property.js";
import { MotusRefusal, type MotusClient, type MotusProduct, type PricingInput } from "./motus.js";

/**
 * One quote: find the product, fill what the address can tell us, ask motus
 * for the price, and say plainly what is still needed. Nothing here invents a
 * price: a figure only ever comes from motus's get_quote.
 */

export const PROPERTY_PRICE_KEY = 13;

/** The words people use, for products whose catalogue name they would not type. */
const ALIASES: Array<[RegExp, RegExp]> = [
  [/\b(home ?buyers?|level ?2|l2|rics ?2|condition report)\b/i, /^level 2 survey$/i],
  [/\b(level ?3|l3|full structural|building survey)\b/i, /^level 3 survey$/i],
  [/\bsnag/i, /^snagging survey$/i],
  [/\b(end of tenancy|move ?out clean|moving clean|deep clean)\b/i, /^end of tenancy clean$/i],
  [/\b(removal|remover|moving company|movers?)\b/i, /^removals$/i],
  [/\b(man (and|&) van|man with a van)\b/i, /^man & van$/i],
  [/\b(epc|energy performance)\b/i, /^epc assessment$/i],
  [/\b(gas safe|gas safety|cp12)\b/i, /^gas cp12 +safety certificate$/i],
  [/\b(eicr|electrical (safety|condition|certificate|report))\b/i, /^electrical installation condition report$/i],
  [/\b(damp|timber|woodworm|rot)\b/i, /^damp & timber survey$/i],
  [/\b(drone)\b/i, /^drone roof survey$/i],
  [/\b(asbestos)\b/i, /^asbestos survey$/i],
  [/\b(structural engineer)\b/i, /^structural engineer report$/i],
  [/\b(probate)\b/i, /^probate valuation$/i],
  [/\b(divorce|matrimonial)\b/i, /^matrimonial valuation$/i],
  [/\b(help ?to ?buy|htb)\b.*\bvaluation\b|\bvaluation\b.*\b(help ?to ?buy|htb)\b/i, /^help-to-buy valuation$/i],
  [/\b(shared ownership)\b/i, /^shared ownership valuation$/i],
  [/\b(thermal|thermographic|heat loss)\b/i, /^thermographic survey$/i],
  [/\b(carpet)\b/i, /^carpet cleaning$/i],
  [/\b(packing service|pack (my|our|the) (things|stuff|house))\b/i, /^full packing service$/i],
];

/** Plain-English questions for the pricing keys a person is asked. */
const QUESTIONS: Record<string, string> = {
  beds: "How many bedrooms does the home have?",
  property_price: "Roughly what is the home worth, or what are you paying for it?",
  snagging_type: "Is the snagging inspection before completion or after you've moved in?",
  asb_type: "Is it a management survey, or a refurbishment and demolition survey?",
  matrimonial_witness: "Will the valuer need to act as an expert witness in court?",
  structural_survey_type: "Which kind of structural survey do you need?",
  roof_type: "What kind of roof is it?",
  roof_survey_type: "Do you need a drone survey, a roof inspection or a full roof survey?",
  thermographic_type: "What is the thermal survey for?",
};

export function questionFor(input: PricingInput): string {
  return QUESTIONS[input.name] ?? `Which ${input.name.replace(/_/g, " ")}?`;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9+]+/g, " ").trim();

/** The product a request names: its id, an alias, or the closest catalogue name. */
export function resolveProduct(products: MotusProduct[], service: string | number): { product?: MotusProduct; candidates: MotusProduct[] } {
  const live = products.filter((p) => !p.is_addon || /clean|packing|box|bubble|wardrobe|porter|dismantle|waiver/i.test(p.name));
  if (typeof service === "number" || /^\d+$/.test(String(service))) {
    const product = products.find((p) => p.id === Number(service));
    return { product, candidates: product ? [product] : [] };
  }
  const text = String(service);
  for (const [said, name] of ALIASES) {
    if (said.test(text)) {
      const product = live.find((p) => name.test(p.name.trim()));
      if (product) return { product, candidates: [product] };
    }
  }
  const words = norm(text).split(" ").filter((w) => w.length > 2 && !["survey", "quote", "price", "cost", "much", "how", "the", "for", "get"].includes(w));
  const scored = live
    .map((p) => ({ p, score: words.filter((w) => norm(p.name).includes(w)).length + (norm(p.name) === norm(text) ? 10 : 0) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  if (!scored.length) return { candidates: [] };
  const best = scored.filter((x) => x.score === scored[0]!.score).map((x) => x.p);
  return best.length === 1 ? { product: best[0], candidates: best } : { candidates: best.slice(0, 6) };
}

/** An answer as the person gave it ("Post-Completion", "after", "2") to the option value motus expects. */
export function matchOption(input: PricingInput, given: unknown): string | undefined {
  if (given === undefined || given === null || given === "") return undefined;
  const text = norm(String(given));
  const exact = input.options.find((o) => o.value === String(given) || norm(o.label) === text);
  if (exact) return exact.value;
  if (input.name === "beds") {
    const n = Number.parseInt(text, 10);
    if (Number.isFinite(n) && n > 0) {
      const values = input.options.map((o) => Number(o.value)).filter(Number.isFinite);
      return String(Math.min(n, Math.max(...values)));
    }
  }
  const partial = input.options.filter((o) => norm(o.label).includes(text) || text.includes(norm(o.label)));
  return partial.length === 1 ? partial[0]!.value : undefined;
}

export interface QuoteRequest {
  service: string | number;
  postcode: string;
  address?: string;
  property_price?: number;
  bedrooms?: number;
  answers?: Record<string, unknown>;
}

export type QuoteAnswer =
  | { status: "priced"; product: ProductView; price_gbp: number; postcode: string; property?: PropertyView; assumed: Assumption[]; answers: AnswerView[]; band?: { min: number; max: number }; booking_url: string; breakdown?: Array<{ label: string; amount_gbp: number }>; extras?: Array<{ label: string; amount_gbp: number }> }
  | { status: "needs_answers"; product: ProductView; postcode: string; property?: PropertyView; assumed: Assumption[]; answers: AnswerView[]; questions: QuestionView[] }
  | { status: "quoted_by_hand"; product: ProductView; postcode: string; property?: PropertyView; answers: AnswerView[] }
  | { status: "choose_service"; options: ProductView[] }
  | { status: "unknown_service"; service: string }
  | { status: "address_not_found"; reason: string; postcode: string };

export interface ProductView { id: number; name: string; type: string | null }

/**
 * Where a customer books what they were quoted: homemove.com's own quote wizard for that
 * product, opened on the product with the postcode filled in. Slugs are the website's
 * (motus resources/js/Website/Forms/configs/surveys.config.ts surveySlugToIdMap).
 */
const SURVEY_SLUGS: Record<number, string> = {
  2: "rics-level-2", 4: "rics-level-3", 1039: "snagging", 1045: "building", 1: "help-to-buy-valuation",
  6: "shared-ownership-valuation", 1043: "structural", 1044: "roof", 1040: "probate-valuation",
  1041: "matrimonial-valuation", 1042: "thermographic", 1038: "asbestos", 1081: "epc-assessment",
  1085: "gas-cp12-safety-certificate", 1083: "epc-assessment-floorplan", 1055: "drone-roof-survey",
  1087: "electrical-installation-condition-report",
};

export function bookingUrl(product: ProductView, postcode: string): string {
  const pc = encodeURIComponent(postcode.replace(/\s+/g, "").toUpperCase());
  const slug = SURVEY_SLUGS[product.id];
  if (slug) return `https://homemove.com/quote/surveys/${slug}?pc=${pc}`;
  if (product.type === "surveys") return `https://homemove.com/quote/surveys/?pc=${pc}`;
  if (product.type === "removals") return `https://homemove.com/removals/quote/?pc=${pc}`;
  if (product.type === "cleaning") return "https://homemove.com/quote/cleaning/";
  if (product.type === "legal") return `https://homemove.com/legal/quote/?pc=${pc}`;
  return "https://homemove.com/";
}
export interface PropertyView { address: string; postcode: string; uprn: string }
export interface Assumption { name: string; value: string; source: string }
export interface AnswerView { name: string; label: string }
export interface QuestionView { name: string; question: string; options: string[] }

const view = (p: MotusProduct): ProductView => ({ id: p.id, name: p.name.trim(), type: p.type });

/** Conveyancing is priced by Atlas (motus get_legal_quote), not from a product grid. */
export const CONVEYANCING = /\b(convey\w*|solicitors?|legal (fees?|work|costs?)|legals|lawyers?)\b/i;

const LEGAL_QUESTIONS = {
  transaction: { question: "Are you buying or selling?", options: ["Buying", "Selling"] },
  tenure: { question: "Is the home freehold or leasehold?", options: ["Freehold", "Leasehold"] },
  funding_purchase: { question: "Are you buying with a mortgage or in cash?", options: ["Mortgage", "Cash"] },
  funding_sale: { question: "Is there a mortgage to pay off on the home you're selling?", options: ["Yes, a mortgage", "No mortgage"] },
} as const;

function pick(given: unknown, options: Record<string, RegExp>): string | undefined {
  if (given === undefined || given === null || given === "") return undefined;
  const text = String(given);
  return Object.entries(options).find(([, re]) => re.test(text))?.[0];
}

async function conveyancing(request: QuoteRequest, deps: { motus: MotusClient; property: PropertyLookup }): Promise<QuoteAnswer> {
  const given = Object.fromEntries(Object.entries(request.answers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  const transaction = pick(given["transaction"] ?? (/\bsell/i.test(String(request.service)) ? "selling" : /\bbuy|purchas/i.test(String(request.service)) ? "buying" : undefined), { purchase: /buy|purchas/i, sale: /sell|sale/i }) as "purchase" | "sale" | undefined;
  const product: ProductView = transaction === "sale" ? { id: 1063, name: "Conveyancing (selling)", type: "legal" } : { id: 1062, name: transaction ? "Conveyancing (buying)" : "Conveyancing", type: "legal" };
  let facts: PropertyFacts | undefined;
  if (request.address?.trim()) {
    try { facts = await deps.property.find(request.address, request.postcode); } catch (error) {
      if (error instanceof AddressNotMatched) return { status: "address_not_found", reason: error.reason, postcode: request.postcode };
      throw error;
    }
  }
  const property = facts ? { address: facts.address, postcode: facts.postcode, uprn: facts.uprn } : undefined;
  const assumed: Assumption[] = [];
  let tenure = pick(given["tenure"], { freehold: /free/i, leasehold: /lease|flat/i }) as "freehold" | "leasehold" | undefined;
  if (!tenure && facts?.tenure) { tenure = facts.tenure; assumed.push({ name: "tenure", value: facts.tenure === "freehold" ? "Freehold" : "Leasehold", source: "the Land Registry title" }); }
  const funding = pick(given["funding_type"], { cash: /cash|no mortgage|outright|^no\b/i, mortgage: /mortgage|^yes\b/i }) as "mortgage" | "cash" | undefined;
  let price = request.property_price;
  if (!price && facts) {
    const estimate = await deps.property.estimatedValue(facts);
    if (estimate) { price = estimate; assumed.push({ name: "property_price", value: "", source: "Homedata's estimate for this home" }); }
  }
  const shown: AnswerView[] = [
    ...(transaction ? [{ name: "transaction", label: transaction === "sale" ? "Selling" : "Buying" }] : []),
    ...(tenure && given["tenure"] ? [{ name: "tenure", label: tenure === "freehold" ? "Freehold" : "Leasehold" }] : []),
    ...(funding ? [{ name: "funding_type", label: funding === "cash" ? (transaction === "sale" ? "No mortgage" : "Cash") : (transaction === "sale" ? "Yes, a mortgage" : "Mortgage") }] : []),
  ];
  const questions: QuestionView[] = [];
  if (!transaction) questions.push({ name: "transaction", ...LEGAL_QUESTIONS.transaction, options: [...LEGAL_QUESTIONS.transaction.options] });
  if (!price) questions.push({ name: "property_price", question: "What's the price of the home?", options: [] });
  if (!tenure) questions.push({ name: "tenure", ...LEGAL_QUESTIONS.tenure, options: [...LEGAL_QUESTIONS.tenure.options] });
  if (!funding) {
    const q = transaction === "sale" ? LEGAL_QUESTIONS.funding_sale : LEGAL_QUESTIONS.funding_purchase;
    questions.push({ name: "funding_type", question: q.question, options: [...q.options] });
  }
  if (questions.length) return { status: "needs_answers", product, postcode: request.postcode, property, assumed: assumed.filter((a) => a.name !== "property_price"), answers: shown, questions };

  try {
    const legal = await deps.motus.legalQuote({ transaction: transaction!, tenure: tenure!, propertyPrice: price!, fundingType: funding });
    for (const a of assumed) if (a.name === "property_price") a.value = `about ${bandLabel({ min: Math.floor(price! / 50000) * 50000 + 1, max: Math.ceil(price! / 50000) * 50000 })}`;
    return {
      status: "priced", product, price_gbp: legal.total_gbp, postcode: request.postcode, property, assumed, answers: shown,
      booking_url: bookingUrl(product, request.postcode),
      breakdown: [{ label: "Legal fees", amount_gbp: legal.legal_fee_gbp }, ...legal.disbursements],
      ...(legal.search_pack_gbp ? { extras: [{ label: "Search pack", amount_gbp: legal.search_pack_gbp }] } : {}),
    };
  } catch (error) {
    if (error instanceof MotusRefusal) return { status: "quoted_by_hand", product, postcode: request.postcode, property, answers: shown };
    throw error;
  }
}

export async function quote(request: QuoteRequest, deps: { motus: MotusClient; property: PropertyLookup }): Promise<QuoteAnswer> {
  // The widget re-asks with the product id; 1062/1063 are the conveyancing legs, priced by Atlas.
  const legalId = /^(1062|1063)$/.test(String(request.service)) ? String(request.service) : undefined;
  if (legalId) return conveyancing({ ...request, service: legalId === "1063" ? "conveyancing selling" : "conveyancing buying" }, deps);
  if (typeof request.service === "string" && CONVEYANCING.test(request.service)) return conveyancing(request, deps);
  const products = await deps.motus.products();
  const { product, candidates } = resolveProduct(products, request.service);
  if (!product) {
    return candidates.length ? { status: "choose_service", options: candidates.map(view) } : { status: "unknown_service", service: String(request.service) };
  }

  let facts: PropertyFacts | undefined;
  let postcode = request.postcode;
  if (request.address?.trim()) {
    try {
      facts = await deps.property.find(request.address, request.postcode);
      postcode = facts.postcode || postcode;
    } catch (error) {
      if (error instanceof AddressNotMatched) return { status: "address_not_found", reason: error.reason, postcode };
      throw error;
    }
  }
  const property = facts ? { address: facts.address, postcode: facts.postcode, uprn: facts.uprn } : undefined;

  const assumed: Assumption[] = [];
  const answers: Record<string, string> = {};
  const shown: AnswerView[] = [];
  const given = Object.fromEntries(Object.entries(request.answers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  for (const input of product.inputs) {
    if (input.key === PROPERTY_PRICE_KEY) continue;
    let value = matchOption(input, given[input.name] ?? given[String(input.key)]);
    if (value === undefined && input.name === "beds") {
      if (request.bedrooms) value = matchOption(input, request.bedrooms);
      else if (facts?.bedrooms) {
        value = matchOption(input, facts.bedrooms);
        if (value) assumed.push({ name: "beds", value: input.options.find((o) => o.value === value)!.label, source: facts.bedrooms_source === "recorded" ? "the property record" : "Homedata's estimate for this home" });
      }
    }
    if (value !== undefined) {
      answers[String(input.key)] = value;
      shown.push({ name: input.name, label: input.options.find((o) => o.value === value)?.label ?? value });
    }
  }

  let propertyPrice = request.property_price;
  const needsValue = product.inputs.some((i) => i.key === PROPERTY_PRICE_KEY);
  if (needsValue && !propertyPrice && facts) {
    const estimate = await deps.property.estimatedValue(facts);
    if (estimate) {
      propertyPrice = estimate;
      assumed.push({ name: "property_price", value: "", source: "Homedata's estimate for this home" });
    }
  }

  try {
    const result = await deps.motus.quote({ productId: product.id, postcode, propertyPrice, answers });
    const band = result.property_price_band ? { min: result.property_price_band.min, max: result.property_price_band.max } : undefined;
    for (const a of assumed) if (a.name === "property_price" && band) a.value = bandLabel(band);
    if (result.price_gbp && !result.from && result.needs.length === 0) {
      return { status: "priced", product: view(product), price_gbp: result.price_gbp, postcode: result.postcode, property, assumed, answers: shown, band, booking_url: bookingUrl(view(product), result.postcode) };
    }
    const questions = (result.needs.length ? result.needs : product.inputs.filter((i) => i.key === PROPERTY_PRICE_KEY))
      .map((input) => ({ name: input.name, question: questionFor(input), options: input.key === PROPERTY_PRICE_KEY ? [] : input.options.map((o) => o.label) }));
    return { status: "needs_answers", product: view(product), postcode: result.postcode, property, assumed: assumed.filter((a) => a.name !== "property_price"), answers: shown, questions };
  } catch (error) {
    if (error instanceof MotusRefusal && error.code === "quote_unavailable") return { status: "quoted_by_hand", product: view(product), postcode, property, answers: shown };
    throw error;
  }
}

export function bandLabel(band: { min: number; max: number }): string {
  const f = (n: number) => (n >= 1_000_000 ? `£${(n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0)}m` : `£${Math.round(n / 1000)}k`);
  return band.min <= 1 ? `up to ${f(band.max)}` : `${f(band.min - 1)}–${f(band.max)}`;
}
