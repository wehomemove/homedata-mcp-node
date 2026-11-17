/**
 * Tool-call activity for the remote endpoint, posted to Slack as it happens.
 *
 * One short line per tool call: organisation, tool, outcome and duration.
 * Never an argument value: addresses, postcodes and UPRNs stay out of Slack.
 *
 * Posts go out as the Homedata Slack app (a bot token, xoxb-), never a person's
 * user token, so a post cannot read as someone speaking. Posting is fire and
 * forget with a short timeout: a slow or failing Slack never delays or fails a
 * tool call. Unsigned calls are not rate-capped by the endpoint, so posts are
 * capped here, and a burst over the cap is counted on the next line instead of
 * flooding the channel.
 *
 * Calls that name a visitor (the Home and Homemove apps) are grouped: the first call
 * posts straight away, and later calls from the same visitor, each within 5 minutes
 * of the one before, update that same message (chat.update) into one rolling line,
 * so a scheduled ChatGPT task checking 14 villages reads as one line, not 28. Rewrites are
 * coalesced (one per visitor every 10 s, 30 a minute in all), a 429 is retried after Slack's
 * Retry-After with the latest text, and a run whose first post failed is posted afresh.
 */
import { MinuteLimiter } from "./limiter.js";

export interface ToolCallEvent {
  /** Who made the call, already safe to show: an organisation name or a fixed label. */
  organisation: string;
  /** A manifest tool name, or "unknown tool"; never a name the caller made up. */
  tool: string;
  /** "ok", "API error 404", "invalid arguments", "sign-in required", "failed", ... */
  outcome: string;
  ms: number;
  /** What the call was about, already reduced to what is safe to show (area level, counts). */
  detail?: string;
  /** A visitor's anonymous tag; calls that share one within the window fold into one message. */
  visitor?: string;
  /** The same detail in parts, so a group of calls can be summed up. Already safe to show. */
  facts?: CallFacts;
}

/** What a call was about, in parts: area-level place, filter labels, and what it found. */
export interface CallFacts { place?: string; filters?: string[]; found?: number; unit?: string }

export type ActivitySink = (event: ToolCallEvent) => void;

export const DEFAULT_SLACK_CHANNEL = "#homedata-chatgpt";
const POST_URL = "https://slack.com/api/chat.postMessage";
const UPDATE_URL = "https://slack.com/api/chat.update";
/** A visitor's call folds into their open message when it comes this soon after their last one. */
export const BURST_GAP_MS = 5 * 60_000;
/** A message stops taking calls after this long, so a busy visitor still gets a fresh line now and then. */
const BURST_MAX_MS = 60 * 60_000;
const MAX_BURSTS = 1000;
const TIMEOUT_MS = 3000;
const POSTS_PER_MINUTE = 60;
const MAX_IN_FLIGHT = 10;

export interface SlackSettings {
  token: string;
  channel: string;
}

/** Slack mrkdwn treats &, < and > as markup (<!channel>, links); show them as text. */
export function slackEscape(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function formatLine(event: ToolCallEvent): string {
  const seconds = event.ms < 1000 ? `${Math.round(event.ms)} ms` : `${(event.ms / 1000).toFixed(1)} s`;
  const icon = event.outcome === "ok" ? ":white_check_mark:" : ":warning:";
  return `${icon} *${slackEscape(event.organisation)}* · \`${slackEscape(event.tool)}\` · ${slackEscape(event.outcome)} · ${seconds}${event.detail ? ` · ${slackEscape(event.detail)}` : ""}`;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const tally = (values: string[]) => {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts];
};

/**
 * One line for a visitor's run of calls: "search_homes ×28 · 14 places (Fulbourn, Duxford, Sawston, …)
 * · to buy, 3+ beds, new in last 1 day · 2 homes found". A single call reads as formatLine does.
 */
export function formatBurst(calls: ToolCallEvent[], spanMs = 0): string {
  const first = calls[0]!;
  if (calls.length === 1) return formatLine(first);
  const tools = tally(calls.map((c) => c.tool)).map(([tool, n]) => (n === 1 ? tool : `${tool} ×${n}`)).join(", ");
  const outcomes = tally(calls.map((c) => c.outcome));
  const allOk = outcomes.length === 1 && outcomes[0]![0] === "ok";
  const outcome = allOk ? "ok" : outcomes.map(([o, n]) => `${n} ${o}`).join(", ");
  const parts: string[] = [];
  const places = [...new Set(calls.map((c) => c.facts?.place).filter((p): p is string => !!p))];
  if (places.length === 1) parts.push(places[0]!);
  else if (places.length > 1) parts.push(`${places.length} places (${places.slice(0, 3).join(", ")}${places.length > 3 ? ", …" : ""})`);
  const filters = [...new Set(calls.filter((c) => c.facts).map((c) => (c.facts!.filters ?? []).join(", ")).filter(Boolean))];
  if (filters.length === 1) parts.push(filters[0]!);
  else if (filters.length > 1) parts.push(`${filters[0]} (filters vary)`);
  const found = new Map<string, number>();
  for (const c of calls) if (c.facts?.found !== undefined && c.facts.unit) found.set(c.facts.unit, (found.get(c.facts.unit) ?? 0) + c.facts.found);
  if (found.size) parts.push(`${[...found].map(([unit, n]) => plural(n, unit)).join(", ")} found`);
  // Calls that came without parts (Homemove) show their own detail, a few at most.
  const details = [...new Set(calls.filter((c) => !c.facts && c.detail).map((c) => c.detail!))];
  if (details.length) parts.push(details.slice(0, 3).join(" | ") + (details.length > 3 ? ` (+${details.length - 3} more)` : ""));
  const minutes = spanMs >= 60_000 ? ` · over ${Math.round(spanMs / 60_000)} min` : "";
  const icon = allOk ? ":white_check_mark:" : ":warning:";
  return `${icon} *${slackEscape(first.organisation)}* · \`${slackEscape(tools)}\` · ${slackEscape(outcome)}${minutes}${parts.length ? ` · ${slackEscape(parts.join(" · "))}` : ""}`;
}

interface Posted { ts: string; channel: string }
interface Answer { posted?: Posted; retryAfterMs?: number }

interface Burst {
  startedAt: number;
  lastAt: number;
  calls: ToolCallEvent[];
  suffix: string;
  /** Where Slack put the message: chat.update needs its channel id, not the #name. */
  posted?: Posted;
  /** A failed first post: the next call posts the whole run afresh. */
  failed: boolean;
  /** How many calls the message on Slack already shows. */
  shown: number;
  lastSentAt: number;
  notBefore: number;
  retries: number;
  timer: boolean;
  sending: boolean;
}

/** A visitor's message is rewritten at most this often; calls in between are coalesced. */
export const UPDATE_EVERY_MS = 10_000;
/** All rolling updates together, well under Slack's chat.update allowance (Tier 3, about 50 a minute). */
const UPDATES_PER_MINUTE = 30;
const BUSY_RETRY_MS = 5_000;
const DEFAULT_RETRY_AFTER_MS = 30_000;
const MAX_UPDATE_RETRIES = 5;

export type Later = (run: () => void, ms: number) => void;
const unrefTimeout: Later = (run, ms) => { setTimeout(run, ms).unref?.(); };

export class SlackActivity {
  private readonly bursts = new Map<string, Burst>();
  private readonly pending = new Set<Promise<unknown>>();
  private readonly limiter: MinuteLimiter;
  private readonly updates: MinuteLimiter;
  private dropped = 0;
  private inFlight = 0;
  private readonly logged = new Set<string>();

  constructor(
    private readonly settings: SlackSettings,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
    private readonly log: (message: string) => void = (m) => console.error(m),
    private readonly later: Later = unrefTimeout,
  ) {
    this.limiter = new MinuteLimiter(POSTS_PER_MINUTE, now);
    this.updates = new MinuteLimiter(UPDATES_PER_MINUTE, now);
  }

  /** Never throws and never waits: returns before Slack has answered. */
  readonly report: ActivitySink = (event) => {
    try {
      const at = this.now();
      const open = event.visitor ? this.bursts.get(event.visitor) : undefined;
      if (open && at - open.lastAt <= BURST_GAP_MS && at - open.startedAt <= BURST_MAX_MS) {
        open.calls.push(event);
        open.lastAt = at;
        // A run whose first post failed is posted again whole, once Slack and the cap allow.
        if (open.failed) this.start(event.visitor!, open.calls, open.startedAt, at, false);
        else this.schedule(open);
        return;
      }
      this.start(event.visitor, [event], at, at, true);
    } catch {
      // A reporting bug must never reach the tool call.
    }
  };

  /** Resolves once every post and update started so far has finished (for tests and shutdown). */
  async settled(): Promise<void> {
    while (this.pending.size) await Promise.allSettled([...this.pending]);
  }

  /** Posts a new message for these calls; a visitor's calls then fold into it. */
  private start(visitor: string | undefined, calls: ToolCallEvent[], startedAt: number, at: number, countDrop: boolean): void {
    if (this.inFlight >= MAX_IN_FLIGHT || !this.limiter.take()) {
      if (countDrop) this.dropped++;
      return;
    }
    let suffix = "";
    if (this.dropped > 0) {
      suffix = ` _(+${this.dropped} earlier ${this.dropped === 1 ? "call" : "calls"} not posted)_`;
      this.dropped = 0;
    }
    const burst: Burst = { startedAt, lastAt: at, calls, suffix, failed: false, shown: calls.length, lastSentAt: at, notBefore: 0, retries: 0, timer: false, sending: true };
    if (visitor) {
      if (this.bursts.size >= MAX_BURSTS) this.prune(at);
      this.bursts.set(visitor, burst);
    }
    this.inFlight++;
    this.track(this.post(POST_URL, { text: formatBurst(calls, at - startedAt) + suffix }).then((answer) => {
      burst.sending = false;
      if (!answer.posted?.ts) { burst.failed = true; return; }
      burst.posted = answer.posted;
      this.schedule(burst);
    }).finally(() => this.inFlight--));
  }

  private track(work: Promise<unknown>): void {
    this.pending.add(work);
    void work.finally(() => this.pending.delete(work));
  }

  /** Queues one rewrite of the burst's message, no sooner than UPDATE_EVERY_MS after the last. */
  private schedule(burst: Burst): void {
    if (burst.timer || burst.sending || !burst.posted || burst.calls.length <= burst.shown) return;
    burst.timer = true;
    const wait = Math.max(0, burst.lastSentAt + UPDATE_EVERY_MS - this.now(), burst.notBefore - this.now());
    this.later(() => { burst.timer = false; this.flush(burst); }, wait);
  }

  /** Sends the latest text; on a busy cap or Slack's 429 it keeps that text and tries again later. */
  private flush(burst: Burst): void {
    try {
      if (!burst.posted || burst.calls.length <= burst.shown) return;
      if (this.inFlight >= MAX_IN_FLIGHT || !this.updates.take()) {
        burst.notBefore = this.now() + BUSY_RETRY_MS;
        return this.schedule(burst);
      }
      const count = burst.calls.length;
      burst.sending = true;
      this.inFlight++;
      this.track(this.post(UPDATE_URL, { ...burst.posted, text: formatBurst(burst.calls, burst.lastAt - burst.startedAt) + burst.suffix }).then((answer) => {
        burst.lastSentAt = this.now();
        if (answer.posted) {
          burst.shown = count; burst.retries = 0;
        } else if (answer.retryAfterMs !== undefined && ++burst.retries <= MAX_UPDATE_RETRIES) {
          burst.notBefore = this.now() + answer.retryAfterMs; // keep `shown`, so the latest text is retried
        } else {
          burst.shown = count; burst.retries = 0; // give up on this text; a later call tries again
        }
      }).finally(() => {
        burst.sending = false;
        this.inFlight--;
        this.schedule(burst);
      }));
    } catch {
      // Never reaches a tool call.
    }
  }

  private prune(at: number): void {
    for (const [key, burst] of this.bursts) if (at - burst.lastAt > BURST_GAP_MS) this.bursts.delete(key);
    if (this.bursts.size >= MAX_BURSTS) this.bursts.clear();
  }

  /** Where Slack put the message when it took it; how long to wait when it was rate limited. */
  private async post(url: string, fields: { text: string; ts?: string; channel?: string }): Promise<Answer> {
    try {
      const response = await this.fetchImpl(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.settings.token}`, "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({ channel: this.settings.channel, ...fields, unfurl_links: false, unfurl_media: false }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const answer = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string; ts?: string; channel?: string };
      if (answer.ok) {
        return { posted: { ts: typeof answer.ts === "string" ? answer.ts : fields.ts ?? "", channel: typeof answer.channel === "string" ? answer.channel : fields.channel ?? this.settings.channel } };
      }
      this.logOnce(answer.error ?? `http_${response.status}`);
      if (response.status === 429 || answer.error === "ratelimited") {
        const seconds = Number(response.headers.get("retry-after"));
        return { retryAfterMs: Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 300) * 1000 : DEFAULT_RETRY_AFTER_MS };
      }
      return {};
    } catch (err) {
      this.logOnce((err as Error)?.name === "TimeoutError" ? "timeout" : "unreachable");
      return {};
    }
  }

  /** Each failure reason once per process: enough to notice, never a log flood. Never the token. */
  private logOnce(reason: string): void {
    if (this.logged.has(reason)) return;
    this.logged.add(reason);
    this.log(`[homedata-mcp-http] Slack activity post failed (${reason}); tool calls are unaffected.`);
  }
}
