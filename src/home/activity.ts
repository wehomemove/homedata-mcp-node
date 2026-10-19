/**
 * Home tool-call activity for Slack, on the same feed as the Homedata endpoint
 * (src/activity.ts posts it). Home has no sign-in, so a line names a visitor by
 * a short hash of ChatGPT's anonymised openai/subject, with whether they are new
 * and how many distinct visitors there have been today and ever.
 *
 * A line carries what was asked only at area level: a full postcode becomes its
 * district, a town name stays, anything else reads "an address". Never a street,
 * a listing id, a price someone typed or a start point.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

import { HOME_ROUTE_TOOLS, HOME_TOOLS } from "./server.js";
import { ACCOUNT_TOOLS } from "./account.js";
import { WISHES } from "./wishes.js";

const KNOWN = new Set<string>([...HOME_TOOLS, ...HOME_ROUTE_TOOLS, ...ACCOUNT_TOOLS].map((tool) => tool.name));

/** A tool name safe to show: one Home lists, never one the caller made up. */
export function shownToolName(name: unknown): string {
  return typeof name === "string" && KNOWN.has(name) ? name : "unknown tool";
}

const POSTCODE = /^([A-Z]{1,2}\d[A-Z\d]?)\s*\d[A-Z]{2}$/i;
const DISTRICT = /^[A-Z]{1,2}\d[A-Z\d]?$/i;
const TOWN = /^[A-Za-z][A-Za-z .,'&-]{0,39}$/;

/** One call, as the Home server saw it. */
export interface HomeCall { tool: string; outcome: string; ms: number; detail?: string; subject?: unknown }

/** A call's outcome from its result: ok, or which kind of refusal. */
export function outcomeOf(result: { isError?: boolean; structuredContent?: Record<string, unknown>; _meta?: Record<string, unknown> }): string {
  if (!result.isError) return "ok";
  if (result._meta?.["mcp/www_authenticate"]) return "sign-in required";
  const body = result.structuredContent ?? {};
  if (body["error"] === "invalid_request") return "invalid request";
  if (body["error"] === "unknown_tool") return "unknown tool";
  if (body["available"] === false) return "upstream unavailable";
  return "error";
}

/** Area level only: "LS6 4AB" → "LS6", "Leeds" → "Leeds", "12 Acacia Ave" → "an address". */
export function coarsePlace(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const text = value.trim().replace(/\s+/g, " ");
  const postcode = POSTCODE.exec(text);
  if (postcode) return postcode[1]!.toUpperCase();
  if (DISTRICT.test(text)) return text.toUpperCase();
  return TOWN.test(text) ? text : "an address";
}

const money = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value > 0
  ? `£${value >= 1_000_000 ? `${+(value / 1_000_000).toFixed(2)}m` : value >= 1000 ? `${Math.round(value / 1000)}k` : Math.round(value)}`
  : undefined;
const count = (value: unknown) => Array.isArray(value) ? value.length : undefined;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** What a call was about and what it found, at area level. */
export function callDetail(tool: string, args: Record<string, unknown>, body: Record<string, unknown> | undefined): string | undefined {
  const parts: string[] = [];
  const add = (part: string | undefined | false) => { if (part) parts.push(part); };
  switch (tool) {
    case "search_homes": {
      add(coarsePlace(args["location"]));
      add(args["listing_type"] === "rent" ? "to rent" : args["listing_type"] === "sale" ? "to buy" : undefined);
      add(typeof args["min_beds"] === "number" && args["min_beds"] > 0 ? `${args["min_beds"]}+ beds` : undefined);
      const max = money(args["max_price"]);
      add(max && `up to ${max}`);
      add(Array.isArray(args["wishes"]) && args["wishes"].length ? `wishes: ${args["wishes"].filter((w) => (WISHES as readonly unknown[]).includes(w)).slice(0, 4).join(", ")}` : undefined);
      const found = count(body?.["homes"]);
      add(found !== undefined ? `→ ${plural(found, "home")}` : undefined);
      break;
    }
    case "area_insights": add(coarsePlace(args["postcode"])); break;
    case "sold_prices": { add(coarsePlace(args["postcode"])); const n = count(body?.["sales"]); add(n !== undefined ? `→ ${plural(n, "sale")}` : undefined); break; }
    case "find_agents": add(coarsePlace(args["location"])); add(args["agent_type"] === "sales" || args["agent_type"] === "lettings" ? args["agent_type"] : undefined); break;
    case "typical_rents": add(coarsePlace(args["location"])); break;
    case "compare_homes": { const n = count(args["listing_ids"]); add(n ? `${n} homes` : undefined); break; }
    case "render_home_listings": { const n = count(args["homes"]); add(n ? plural(n, "card") : undefined); break; }
    case "commute_filter": add(typeof args["minutes"] === "number" && typeof args["mode"] === "string" ? `${args["minutes"]} min ${args["mode"]}` : undefined); break;
    case "plan_viewings": { const n = count(args["listing_ids"]); add(n ? `${n} stops` : undefined); break; }
  }
  return parts.length ? parts.join(", ") : undefined;
}

type Saved = { day: string; today: string[]; seen: string[] };
const londonDay = (ms: number) => new Date(ms).toLocaleDateString("en-CA", { timeZone: "Europe/London" });

/**
 * Distinct visitors, by a 6-character hash of openai/subject (itself OpenAI's
 * anonymised id). Kept in a small JSON file when one is given, so a deploy does
 * not reset the counts.
 */
export class HomeVisitors {
  private day: string;
  private today = new Set<string>();
  private seen = new Set<string>();

  constructor(private readonly file?: string, private readonly now: () => number = Date.now) {
    this.day = londonDay(now());
    if (!file) return;
    try {
      const saved = JSON.parse(readFileSync(file, "utf8")) as Saved;
      this.seen = new Set(saved.seen);
      if (saved.day === this.day) this.today = new Set(saved.today);
    } catch {
      // No file yet, or unreadable: start counting afresh.
    }
  }

  /** "visitor 3f9a2c (new · 4 today · 57 ever)", or a fixed label when the client sent no subject. */
  label(subject: unknown): string {
    if (typeof subject !== "string" || !subject.trim()) return "visitor (no ChatGPT id)";
    const tag = createHash("sha256").update(subject.trim()).digest("hex").slice(0, 6);
    const day = londonDay(this.now());
    if (day !== this.day) { this.day = day; this.today.clear(); }
    const isNew = !this.seen.has(tag);
    const changed = isNew || !this.today.has(tag);
    this.seen.add(tag); this.today.add(tag);
    if (changed) this.save();
    return `visitor ${tag} (${isNew ? "new · " : ""}${this.today.size} today · ${this.seen.size} ever)`;
  }

  private save(): void {
    if (!this.file) return;
    try {
      writeFileSync(this.file, JSON.stringify({ day: this.day, today: [...this.today], seen: [...this.seen] } satisfies Saved));
    } catch {
      // Counting is best effort and never reaches a tool call.
    }
  }
}
