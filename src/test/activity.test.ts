import assert from "node:assert/strict";
import { test } from "node:test";

import { formatLine, SlackActivity, type ToolCallEvent } from "../activity.js";
import { checkSlack, ConfigError } from "../http.js";

const EVENT: ToolCallEvent = { organisation: "Acme Estates", tool: "crime", outcome: "ok", ms: 412.6 };

test("a line is organisation, tool, outcome and duration, with Slack markup shown as text", () => {
  assert.equal(formatLine(EVENT), ":white_check_mark: *Acme Estates* · `crime` · ok · 413 ms");
  assert.equal(
    formatLine({ organisation: "<!channel> & co", tool: "epc", outcome: "API error 404", ms: 2345 }),
    ":warning: *&lt;!channel&gt; &amp; co* · `epc` · API error 404 · 2.3 s",
  );
});

test("posts as the bot to the channel and returns before Slack answers", async () => {
  const sent: Array<{ url: string; init: RequestInit }> = [];
  let answer!: (r: Response) => void;
  const slack = (async (url: string, init: RequestInit) => {
    sent.push({ url, init });
    return new Promise<Response>((resolve) => (answer = resolve));
  }) as unknown as typeof fetch;

  new SlackActivity({ token: "xoxb-test", channel: "#homedata-chatgpt" }, slack).report(EVENT);
  // report() has returned while the post is still waiting on Slack.
  assert.equal(sent.length, 1);
  assert.equal(sent[0]!.url, "https://slack.com/api/chat.postMessage");
  assert.equal((sent[0]!.init.headers as Record<string, string>)["Authorization"], "Bearer xoxb-test");
  assert.ok(sent[0]!.init.signal, "the post has a timeout");
  const body = JSON.parse(String(sent[0]!.init.body));
  assert.equal(body.channel, "#homedata-chatgpt");
  assert.equal(body.text, formatLine(EVENT));
  answer(new Response(JSON.stringify({ ok: true })));
});

test("a failing Slack is logged once per reason and never thrown", async () => {
  const logs: string[] = [];
  const down = (async () => {
    throw new Error("ECONNREFUSED");
  }) as unknown as typeof fetch;
  const activity = new SlackActivity({ token: "xoxb-secret", channel: "#c" }, down, Date.now, (m) => logs.push(m));
  activity.report(EVENT);
  activity.report(EVENT);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(logs.length, 1);
  assert.match(logs[0]!, /unreachable/);
  assert.doesNotMatch(logs[0]!, /xoxb/);
});

test("posts are capped per minute; the overflow is counted on the next line", async () => {
  let now = 0;
  const texts: string[] = [];
  const slack = (async (_url: string, init: RequestInit) => {
    texts.push(JSON.parse(String(init.body)).text);
    return new Response(JSON.stringify({ ok: true }));
  }) as unknown as typeof fetch;
  const activity = new SlackActivity({ token: "xoxb-t", channel: "#c" }, slack, () => now);
  for (let i = 0; i < 65; i++) {
    activity.report(EVENT);
    await new Promise((r) => setImmediate(r));
  }
  assert.equal(texts.length, 60);
  now += 61_000;
  activity.report(EVENT);
  await new Promise((r) => setImmediate(r));
  assert.match(texts.at(-1)!, /\+5 earlier calls not posted/);
});

test("Slack is optional, posts to #homedata-chatgpt by default, and takes only a bot token", () => {
  assert.equal(checkSlack({}), null);
  assert.deepEqual(checkSlack({ SLACK_API_TOKEN: "xoxb-1" }), { token: "xoxb-1", channel: "#homedata-chatgpt" });
  assert.deepEqual(checkSlack({ SLACK_API_TOKEN: "xoxb-1", SLACK_ACTIVITY_CHANNEL: "C123" }), { token: "xoxb-1", channel: "C123" });
  for (const token of ["xoxp-personal", "xoxe-1", "https://hooks.slack.com/x"]) {
    assert.throws(() => checkSlack({ SLACK_API_TOKEN: token }), ConfigError, token);
  }
});
