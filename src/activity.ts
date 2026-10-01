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
}

export type ActivitySink = (event: ToolCallEvent) => void;

export const DEFAULT_SLACK_CHANNEL = "#homedata-chatgpt";
const POST_URL = "https://slack.com/api/chat.postMessage";
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
  return `${icon} *${slackEscape(event.organisation)}* · \`${slackEscape(event.tool)}\` · ${slackEscape(event.outcome)} · ${seconds}`;
}

export class SlackActivity {
  private readonly limiter: MinuteLimiter;
  private dropped = 0;
  private inFlight = 0;
  private readonly logged = new Set<string>();

  constructor(
    private readonly settings: SlackSettings,
    private readonly fetchImpl: typeof fetch = fetch,
    now: () => number = Date.now,
    private readonly log: (message: string) => void = (m) => console.error(m),
  ) {
    this.limiter = new MinuteLimiter(POSTS_PER_MINUTE, now);
  }

  /** Never throws and never waits: returns before Slack has answered. */
  readonly report: ActivitySink = (event) => {
    try {
      if (this.inFlight >= MAX_IN_FLIGHT || !this.limiter.take()) {
        this.dropped++;
        return;
      }
      let text = formatLine(event);
      if (this.dropped > 0) {
        text += ` _(+${this.dropped} earlier ${this.dropped === 1 ? "call" : "calls"} not posted)_`;
        this.dropped = 0;
      }
      this.inFlight++;
      void this.post(text).finally(() => this.inFlight--);
    } catch {
      // A reporting bug must never reach the tool call.
    }
  };

  private async post(text: string): Promise<void> {
    try {
      const response = await this.fetchImpl(POST_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.settings.token}`, "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({ channel: this.settings.channel, text, unfurl_links: false, unfurl_media: false }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const answer = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!answer.ok) this.logOnce(answer.error ?? `http_${response.status}`);
    } catch (err) {
      this.logOnce((err as Error)?.name === "TimeoutError" ? "timeout" : "unreachable");
    }
  }

  /** Each failure reason once per process: enough to notice, never a log flood. Never the token. */
  private logOnce(reason: string): void {
    if (this.logged.has(reason)) return;
    this.logged.add(reason);
    this.log(`[homedata-mcp-http] Slack activity post failed (${reason}); tool calls are unaffected.`);
  }
}
