import assert from "node:assert/strict";
import { test } from "node:test";

import { BURST_GAP_MS, formatBurst, formatLine, type Later, SlackActivity, type ToolCallEvent, UPDATE_EVERY_MS } from "../activity.js";
import { callDetail, callFacts } from "../home/activity.js";
import { checkSlack, ConfigError } from "../http.js";

const EVENT: ToolCallEvent = { app: "Homedata", organisation: "Acme Estates", tool: "crime", outcome: "ok", ms: 412.6 };

test("a Homedata line is app, organisation, tool, outcome and duration, with Slack markup shown as text", () => {
  assert.equal(formatLine(EVENT), ":white_check_mark: *Homedata* · Acme Estates · `crime` · ok · 413 ms");
  assert.equal(
    formatLine({ app: "Homedata", organisation: "<!channel> & co", tool: "epc", outcome: "API error 404", ms: 2345 }),
    ":warning: *Homedata* · &lt;!channel&gt; &amp; co · `epc` · API error 404 · 2.3 s",
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

/**
 * A fake Slack that records every request and answers like Slack does: postMessage gives a ts and the
 * channel id. `answer` can override a reply (a throw, a 429) for the next requests.
 */
function fakeSlack() {
  const sent: Array<{ url: string; body: Record<string, unknown> }> = [];
  const overrides: Array<(url: string) => Response> = [];
  let n = 0;
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    sent.push({ url, body });
    const override = overrides.shift();
    if (override) return override(url);
    return new Response(JSON.stringify(url.endsWith("postMessage") ? { ok: true, ts: `1700000000.${++n}`, channel: "C0CHATGPT" } : { ok: true }));
  }) as unknown as typeof fetch;
  return { sent, fetchImpl, overrides, posts: () => sent.filter((s) => s.url.endsWith("chat.postMessage")), updates: () => sent.filter((s) => s.url.endsWith("chat.update")) };
}

/** A clock and timer queue the test drives, so throttled updates run without waiting. */
function fakeTime(start = Date.parse("2026-11-17T08:00:00Z")) {
  const clock = { now: start };
  const queue: Array<{ at: number; run: () => void }> = [];
  const later: Later = (run, ms) => { queue.push({ at: clock.now + ms, run }); };
  /** Runs every timer due by `until` (default: all of them), moving the clock as it goes. */
  const drain = async (activity: SlackActivity, until = Infinity) => {
    for (;;) {
      await activity.settled();
      queue.sort((a, b) => a.at - b.at);
      if (!queue.length || queue[0]!.at > until) break;
      const next = queue.shift()!;
      clock.now = Math.max(clock.now, next.at);
      next.run();
    }
    if (until !== Infinity) clock.now = Math.max(clock.now, until);
  };
  return { clock, queue, later, drain };
}

// Visitor 9575ff, a ChatGPT scheduled task, checks 14 Cambridgeshire villages twice each around 08:00 (Louis, 17 Nov).
const VILLAGES = ["Fulbourn", "Duxford", "Sawston", "Linton", "Great Shelford", "Histon", "Cottenham", "Comberton", "Bassingbourn", "Melbourn", "Willingham", "Waterbeach", "Girton", "Milton"];
const villageCall = (place: string, found: number): ToolCallEvent => {
  const args = { location: place, listing_type: "sale", min_beds: 3, max_price: 1_200_000, new_within_days: 1 };
  const body = { homes: Array.from({ length: found }, () => ({})) };
  return { organisation: "Home · visitor 9575ff (3 today · 40 ever)", tool: "search_homes", outcome: "ok", ms: 300, visitor: "home:9575ff", detail: callDetail("search_homes", args, body), facts: callFacts("search_homes", args, body) };
};
const newActivity = (slack: ReturnType<typeof fakeSlack>, time: ReturnType<typeof fakeTime>, channel = "#homedata-chatgpt") =>
  new SlackActivity({ token: "xoxb-t", channel }, slack.fetchImpl, () => time.clock.now, () => {}, time.later);

test("a visitor's burst of calls is one Slack message: posted at once, then updated in place", async () => {
  const time = fakeTime();
  const slack = fakeSlack();
  const activity = newActivity(slack, time);
  const calls = [...VILLAGES, ...VILLAGES].map((place, i) => villageCall(place, i === 3 || i === 20 ? 1 : 0));
  activity.report(calls[0]!);
  assert.equal(slack.posts().length, 1, "the first call posts straight away");
  assert.equal(slack.posts()[0]!.body["text"], formatLine(calls[0]!));
  for (const call of calls.slice(1)) {
    await time.drain(activity, time.clock.now + 4_000);
    activity.report(call);
  }
  await time.drain(activity);
  assert.equal(slack.posts().length, 1, "28 calls make one message, not 28");
  const updates = slack.updates();
  assert.ok(updates.length <= Math.ceil((27 * 4_000) / UPDATE_EVERY_MS) + 1, `updates are coalesced, at most one per ${UPDATE_EVERY_MS / 1000} s (${updates.length})`);
  const last = updates.at(-1)!.body;
  assert.equal(last["ts"], "1700000000.1", "updates the first post");
  assert.equal(last["channel"], "C0CHATGPT", "chat.update takes the channel id Slack gave, not the #name");
  assert.equal(last["text"],
    ":white_check_mark: *Home · visitor 9575ff (3 today · 40 ever)* · `search_homes ×28` · ok · over 2 min · 14 places (Fulbourn, Duxford, Sawston, …) · to buy, 3+ beds, up to £1.2m, new in last 1 day · 2 homes found");
  assert.equal(last["text"], formatBurst(calls, 27 * 4_000));
});

test("a call after the 5-minute gap starts a new message; other visitors and untagged calls never fold in", async () => {
  const time = fakeTime();
  const slack = fakeSlack();
  const activity = newActivity(slack, time, "#c");
  activity.report(villageCall("Fulbourn", 0));
  await time.drain(activity, time.clock.now + 60_000);
  activity.report(villageCall("Duxford", 0));
  activity.report({ ...villageCall("Histon", 0), visitor: "home:aaaaaa", organisation: "Home · visitor aaaaaa (new · 4 today · 41 ever)" });
  activity.report(EVENT);
  await time.drain(activity);
  assert.equal(slack.posts().length, 3, "9575ff once, aaaaaa once, the untagged call once");
  assert.equal(slack.updates().length, 1);
  time.clock.now += BURST_GAP_MS + 1;
  activity.report(villageCall("Sawston", 0));
  await time.drain(activity);
  assert.equal(slack.posts().length, 4, "after the window a new message starts");
  assert.match(String(slack.posts().at(-1)!.body["text"]), /· `search_homes` · ok · .* · Sawston, to buy/);
  time.clock.now += 1_000;
  activity.report(villageCall("Linton", 1));
  await time.drain(activity);
  assert.equal(slack.updates().at(-1)!.body["ts"], "1700000000.4", "and later calls fold into the new one");
  assert.match(String(slack.updates().at(-1)!.body["text"]), /×2`.* 2 places \(Sawston, Linton\) .* 1 home found$/);
});

test("a burst with refusals says how many", () => {
  assert.match(formatBurst([villageCall("Fulbourn", 0), { ...villageCall("Duxford", 0), outcome: "rate limited", facts: undefined, detail: undefined }]),
    /^:warning: .* · `search_homes ×2` · 1 ok, 1 rate limited · Fulbourn · /);
});

test("a first post that fails once is recovered: the next call posts the whole run, and later calls update it", async () => {
  const time = fakeTime();
  const slack = fakeSlack();
  slack.overrides.push(() => { throw new Error("ECONNRESET"); });
  const activity = newActivity(slack, time);
  activity.report(villageCall("Fulbourn", 0));
  await time.drain(activity);
  time.clock.now += 4_000;
  activity.report(villageCall("Duxford", 1));
  await time.drain(activity);
  assert.equal(slack.posts().length, 2, "Slack is back, so the run is posted again");
  assert.match(String(slack.posts()[1]!.body["text"]), /`search_homes ×2` · ok · 2 places \(Fulbourn, Duxford\) .* 1 home found$/, "with the call the failed post would have shown");
  time.clock.now += 4_000;
  activity.report(villageCall("Sawston", 0));
  await time.drain(activity);
  assert.equal(slack.posts().length, 2);
  assert.equal(slack.updates().length, 1);
  assert.equal(slack.updates()[0]!.body["ts"], "1700000000.1", "the recovered post is the one updated");
  assert.match(String(slack.updates()[0]!.body["text"]), /×3` .* 3 places/);
});

test("updates are bounded across visitors, and a final update refused with 429 is retried after Retry-After", async () => {
  const time = fakeTime();
  const slack = fakeSlack();
  const activity = newActivity(slack, time);
  // 100 calls from one visitor in one minute: one post, and updates coalesced to one per UPDATE_EVERY_MS.
  activity.report(villageCall("Fulbourn", 0));
  for (let i = 1; i < 100; i++) { await time.drain(activity, time.clock.now + 600); activity.report(villageCall(VILLAGES[i % 14]!, 0)); }
  await time.drain(activity);
  assert.equal(slack.posts().length, 1);
  assert.ok(slack.updates().length <= 8, `one visitor's 100 calls in a minute make at most 8 updates (${slack.updates().length})`);
  assert.match(String(slack.updates().at(-1)!.body["text"]), /×100`/, "the last update shows every call");

  // 40 visitors at once: no more than 30 updates go out in that minute; the rest wait and still land.
  const busy = fakeSlack();
  const many = newActivity(busy, time);
  for (let v = 0; v < 40; v++) { many.report({ ...villageCall("Fulbourn", 0), visitor: `home:${v}` }); await many.settled(); }
  assert.equal(busy.posts().length, 40);
  await time.drain(many, time.clock.now + 61_000);
  for (let v = 0; v < 40; v++) many.report({ ...villageCall("Duxford", 0), visitor: `home:${v}` });
  const minuteStart = time.clock.now;
  await time.drain(many, minuteStart + 59_000);
  assert.ok(busy.updates().length <= 30, `updates are capped per minute (${busy.updates().length})`);
  await time.drain(many);
  assert.equal(new Set(busy.updates().map((u) => u.body["ts"])).size, 40, "every visitor's message is updated in the end");

  // A final update answered 429: kept and sent again after Slack's Retry-After, with the latest text.
  const limited = fakeSlack();
  const one = newActivity(limited, time);
  one.report(villageCall("Fulbourn", 0));
  await time.drain(one);
  limited.overrides.push(() => new Response(JSON.stringify({ ok: false, error: "ratelimited" }), { status: 429, headers: { "Retry-After": "20" } }));
  one.report(villageCall("Duxford", 1));
  const refusedAt = time.clock.now + UPDATE_EVERY_MS;
  await time.drain(one, refusedAt);
  assert.equal(limited.updates().length, 1, "the update went out and was refused");
  await time.drain(one, refusedAt + 19_000);
  assert.equal(limited.updates().length, 1, "nothing is resent before Retry-After");
  await time.drain(one);
  assert.equal(limited.updates().length, 2, "then the update is retried");
  assert.match(String(limited.updates()[1]!.body["text"]), /×2` .* 1 home found$/);
});

test("search_homes detail shows its date and type filters, so 0 homes reads as nothing new today", () => {
  assert.equal(callDetail("search_homes", { location: "Fulbourn", listing_type: "sale", min_beds: 3, max_price: 1_200_000, new_within_days: 1 }, { homes: [] }),
    "Fulbourn, to buy, 3+ beds, up to £1.2m, new in last 1 day, → 0 homes");
  assert.equal(callDetail("search_homes", { location: "CB21 5AB", property_type: "semi_detached", new_build: true, reduced_within_days: 7, on_market_at_least_days: 30 }, { homes: [{}] }),
    "CB21, semi-detached, new builds only, reduced in last 7 days, on market 30 days+, → 1 home");
  assert.equal(callDetail("search_homes", { location: "Bath", property_type: "castle", new_within_days: "1", new_build: "yes" }, undefined), "Bath", "values outside the schema are never shown");
});

test("Homedata labels cannot be mistaken for app names, in single calls or bursts", () => {
  for (const organisation of ["Homemove", "Home", "server key (test wallet)", "not signed in"]) {
    const event: ToolCallEvent = { ...EVENT, organisation };
    assert.equal(formatLine(event), `:white_check_mark: *Homedata* · ${organisation} · \`crime\` · ok · 413 ms`);
    assert.equal(formatBurst([event, event]), `:white_check_mark: *Homedata* · ${organisation} · \`crime ×2\` · ok`);
  }
  for (const app of ["Home", "Homemove"]) {
    const event: ToolCallEvent = { organisation: `${app} · visitor abc123`, tool: "search", outcome: "ok", ms: 10 };
    assert.equal(formatLine(event), `:white_check_mark: *${app} · visitor abc123* · \`search\` · ok · 10 ms`);
    assert.equal(formatBurst([event, event]), `:white_check_mark: *${app} · visitor abc123* · \`search ×2\` · ok`);
  }
});
