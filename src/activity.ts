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
 * so a scheduled ChatGPT task checking 14 villages reads as one line, not 28.
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

interface Burst {
  startedAt: number;
  lastAt: number;
  calls: ToolCallEvent[];
  /** Where Slack put the first post: chat.update needs its channel id, not the #name. */
  ts: Promise<Posted | undefined>;
  suffix: string;
  updating: boolean;
  dirty: boolean;
}

export class SlackActivity {
  private readonly bursts = new Map<string, Burst>();
  private readonly pending = new Set<Promise<unknown>>();
  private readonly limiter: MinuteLimiter;
  private dropped = 0;
  private inFlight = 0;
  private readonly logged = new Set<string>();

  constructor(
    private readonly settings: SlackSettings,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
    private readonly log: (message: string) => void = (m) => console.error(m),
  ) {
    this.limiter = new MinuteLimiter(POSTS_PER_MINUTE, now);
  }

  /** Never throws and never waits: returns before Slack has answered. */
  readonly report: ActivitySink = (event) => {
    try {
      const at = this.now();
      const open = event.visitor ? this.bursts.get(event.visitor) : undefined;
      if (open && at - open.lastAt <= BURST_GAP_MS && at - open.startedAt <= BURST_MAX_MS) {
        open.calls.push(event);
        open.lastAt = at;
        this.update(open);
        return;
      }
      if (this.inFlight >= MAX_IN_FLIGHT || !this.limiter.take()) {
        this.dropped++;
        return;
      }
      let suffix = "";
      if (this.dropped > 0) {
        suffix = ` _(+${this.dropped} earlier ${this.dropped === 1 ? "call" : "calls"} not posted)_`;
        this.dropped = 0;
      }
      this.inFlight++;
      const ts = this.post(POST_URL, { text: formatLine(event) + suffix });
      this.track(ts.finally(() => this.inFlight--));
      if (event.visitor) {
        if (this.bursts.size >= MAX_BURSTS) this.prune(at);
        this.bursts.set(event.visitor, { startedAt: at, lastAt: at, calls: [event], ts, suffix, updating: false, dirty: false });
      }
    } catch {
      // A reporting bug must never reach the tool call.
    }
  };

  /** Resolves once every post and update started so far has finished (for tests and shutdown). */
  async settled(): Promise<void> {
    while (this.pending.size) await Promise.allSettled([...this.pending]);
  }

  private track(work: Promise<unknown>): void {
    this.pending.add(work);
    void work.finally(() => this.pending.delete(work));
  }

  /** Rewrites the burst's message with every call so far; one update in flight per burst, the last text wins. */
  private update(burst: Burst): void {
    if (burst.updating) { burst.dirty = true; return; }
    burst.updating = true;
    this.track((async () => {
      try {
        const posted = await burst.ts;
        if (!posted) return; // The first post failed, so there is nothing to update.
        do {
          burst.dirty = false;
          await this.post(UPDATE_URL, { ...posted, text: formatBurst(burst.calls, burst.lastAt - burst.startedAt) + burst.suffix });
        } while (burst.dirty);
      } finally {
        burst.updating = false;
      }
    })());
  }

  private prune(at: number): void {
    for (const [key, burst] of this.bursts) if (at - burst.lastAt > BURST_GAP_MS) this.bursts.delete(key);
    if (this.bursts.size >= MAX_BURSTS) this.bursts.clear();
  }

  /** Where Slack put the message, when it took it. */
  private async post(url: string, fields: { text: string; ts?: string; channel?: string }): Promise<Posted | undefined> {
    try {
      const response = await this.fetchImpl(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.settings.token}`, "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({ channel: this.settings.channel, ...fields, unfurl_links: false, unfurl_media: false }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const answer = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string; ts?: string; channel?: string };
      if (!answer.ok) this.logOnce(answer.error ?? `http_${response.status}`);
      return answer.ok && typeof answer.ts === "string" ? { ts: answer.ts, channel: typeof answer.channel === "string" ? answer.channel : this.settings.channel } : undefined;
    } catch (err) {
      this.logOnce((err as Error)?.name === "TimeoutError" ? "timeout" : "unreachable");
      return undefined;
    }
  }

  /** Each failure reason once per process: enough to notice, never a log flood. Never the token. */
  private logOnce(reason: string): void {
    if (this.logged.has(reason)) return;
    this.logged.add(reason);
    this.log(`[homedata-mcp-http] Slack activity post failed (${reason}); tool calls are unaffected.`);
  }
}
