import { randomBytes } from "node:crypto";

import type { MovePlan, Situation } from "./plan.js";
import { bookingUrl, SURVEY_SLUGS, type QuoteAnswer } from "./quote.js";

/**
 * Every outcome leads to homemove.com. With a handoff page configured
 * (HOMEMOVE_HANDOFF_URL = https://homemove.com/continue/, built by monty/frontend
 * on 16 Oct 2026; contract agreed with them), the link carries what the
 * person already told us, as base64url JSON (contract v1, below), so the page
 * can show their quote, let them browse, and finish sign-up by adding only
 * their own details. No personal data is ever in it: only the property and
 * the services. The page re-prices on its side; quoted_gbp is for display.
 * Without the page, links open homemove.com's own quote wizard for the service.
 */

export interface HandoffProperty { address?: string; postcode: string; uprn?: string; tenure?: string; bedrooms?: number }
export interface HandoffService {
  product_id?: number;
  /** The website's own service slug (surveySlugToIdMap), so the page can name it without a lookup. */
  slug?: string;
  kind?: "conveyancing" | "removals" | "cleaning";
  clean_type?: "end_of_tenancy" | "deep";
  bedrooms?: number;
  name: string;
  answers?: Record<string, string | number>;
  quoted_gbp?: number;
  transaction?: string; tenure?: string; property_price?: number; funding_type?: string;
  from_postcode?: string; to_postcode?: string; inventory?: Record<string, number>; home_size?: string;
}
export interface HandoffV1 {
  source: "chatgpt";
  /** An opaque random id per handoff for attribution; never a conversation id. */
  ref: string;
  move_date?: string;
  created_at: string;
  situation?: Situation;
  property?: HandoffProperty;
  to_property?: HandoffProperty;
  services: HandoffService[];
}

/** Monty's limits: at most six services, and the encoded data under about 3 KB. */
export const MAX_SERVICES = 6;
export const MAX_ENCODED = 3000;

export function handoffUrl(base: string | undefined, payload: Omit<HandoffV1, "ref"> & { ref?: string }): string | undefined {
  if (!base || !payload.services.length || payload.services.length > MAX_SERVICES) return undefined;
  const d = Buffer.from(JSON.stringify({ ...payload, ref: payload.ref ?? randomBytes(9).toString("base64url") })).toString("base64url");
  if (d.length > MAX_ENCODED) return undefined;
  const url = new URL(base);
  url.searchParams.set("v", "1");
  url.searchParams.set("d", d);
  return url.toString();
}

function serviceOf(answer: QuoteAnswer): HandoffService | undefined {
  if (!("product" in answer)) return undefined;
  const p = answer.product;
  const given = Object.fromEntries((answer.answers ?? []).map((a) => [a.name, a.label]));
  const priced = answer.status === "priced" ? answer.price_gbp : undefined;
  if (p.type === "legal") {
    const legal = "legal" in answer ? answer.legal : undefined;
    return { kind: "conveyancing", name: p.name, transaction: legal?.transaction ?? (p.id === 1063 ? "sale" : "purchase"),
      ...(legal?.tenure ? { tenure: legal.tenure } : {}), ...(legal?.property_price ? { property_price: legal.property_price } : {}),
      ...(legal?.funding_type ? { funding_type: legal.funding_type } : {}), ...(priced ? { quoted_gbp: priced } : {}) };
  }
  if (p.type === "removals") {
    const move = answer.status === "priced" ? answer.move : undefined;
    return { kind: "removals", name: p.name, from_postcode: move?.from ?? answer.postcode, ...(move?.to ? { to_postcode: move.to } : {}), ...(priced ? { quoted_gbp: priced } : {}),
      ...(move?.inventory && Object.keys(move.inventory).length ? { inventory: move.inventory } : {}),
      ...(answer.status === "priced" && answer.indicative ? { home_size: answer.indicative } : {}) };
  }
  if (p.type === "cleaning" && (p.id === 1097 || p.id === 1049)) {
    const beds = Number.parseInt(String(given["beds"] ?? ""), 10);
    return { kind: "cleaning", name: p.name, clean_type: p.id === 1097 ? "end_of_tenancy" : "deep", ...(Number.isFinite(beds) ? { bedrooms: beds } : {}), ...(priced ? { quoted_gbp: priced } : {}) };
  }
  const slug = SURVEY_SLUGS[p.id];
  return { product_id: p.id, ...(slug ? { slug } : {}), name: p.name, ...(Object.keys(given).length ? { answers: given } : {}), ...(priced ? { quoted_gbp: priced } : {}) };
}

function propertyOf(answer: QuoteAnswer): HandoffProperty | undefined {
  if (!("postcode" in answer)) return undefined;
  const prop = "property" in answer ? answer.property : undefined;
  return { postcode: prop?.postcode ?? answer.postcode, ...(prop?.address ? { address: prop.address } : {}), ...(prop?.uprn ? { uprn: prop.uprn } : {}) };
}

/** The link for one quote: the handoff page when configured, else the service's own wizard. */
export function continueUrlForQuote(answer: QuoteAnswer, base: string | undefined, now = new Date()): string {
  const service = serviceOf(answer);
  const property = propertyOf(answer);
  const page = service ? handoffUrl(base, { source: "chatgpt", created_at: now.toISOString(), ...(property ? { property } : {}), services: [service] }) : undefined;
  // Over the limits, or no page yet: the service's own wizard.
  if (page) return page;
  if ("product" in answer && "postcode" in answer) return bookingUrl(answer.product, answer.postcode);
  return "https://homemove.com/";
}

/** The link for a whole move: every service on it, priced or not. */
export function continueUrlForPlan(plan: MovePlan, request: { to_postcode?: string; from_postcode?: string }, base: string | undefined, now = new Date()): string {
  const services = plan.lines.map((l) => serviceOf(l.answer)).filter((s): s is HandoffService => !!s).slice(0, MAX_SERVICES);
  const first = plan.lines.map((l) => propertyOf(l.answer)).find(Boolean);
  const page = handoffUrl(base, {
    source: "chatgpt", created_at: now.toISOString(), situation: plan.situation,
    ...(request.from_postcode ? { property: plan.lines.map((l) => propertyOf(l.answer)).find((p) => p?.postcode?.replace(/\s/g, "") === request.from_postcode!.replace(/\s/g, "")) ?? { postcode: request.from_postcode } } : first ? { property: first } : {}),
    ...(request.to_postcode ? { to_property: plan.lines.map((l) => propertyOf(l.answer)).find((p) => p?.postcode?.replace(/\s/g, "") === request.to_postcode!.replace(/\s/g, "")) ?? { postcode: request.to_postcode } } : {}),
    services,
  });
  return page ?? "https://homemove.com/";
}
