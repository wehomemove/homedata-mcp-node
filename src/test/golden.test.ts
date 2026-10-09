import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { HomedataClient } from "../client.js";
import { checkGoldenSet, type GoldenSet, type ListedTool } from "../golden.js";
import { PROFILES } from "../profile.js";
import { buildServer } from "../server.js";

const SET_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "docs", "chatgpt-app", "golden-prompts.json");
const loadSet = (): GoldenSet => JSON.parse(readFileSync(SET_PATH, "utf8")) as GoldenSet;

/** The tool list the remote endpoint serves, read the way a client reads it. */
async function chatgptTools(): Promise<ListedTool[]> {
  const fetchImpl = (async () => new Response("{}")) as unknown as typeof fetch;
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "golden", version: "1" }, { capabilities: {} });
  await Promise.all([buildServer(new HomedataClient({ apiKey: "golden", fetchImpl }), PROFILES.chatgpt).connect(a), client.connect(b)]);
  const tools = (await client.listTools()).tools as unknown as ListedTool[];
  await client.close();
  return tools;
}

test("the golden prompt set holds against the ChatGPT tool list", async () => {
  assert.deepEqual(checkGoldenSet(loadSet(), await chatgptTools()), []);
});

test("the checker catches a set that drifts from the tools", async () => {
  const tools = await chatgptTools();
  const set = loadSet();
  const broken: GoldenSet = structuredClone(set);
  broken.cases[0]!.expect.calls[1] = { tool: "risks", args: { risk_type: "earthquake" } };
  broken.cases[1]!.expect.calls[0] = { tool: "valuation", args: {} };
  broken.cases[2]!.expect.calls[0]!.args = { postcode: "SW1A 2AA", radius_miles: 2 };
  broken.cases.push({ ...structuredClone(set.cases[0]!), id: "extra-review", prompt: "another" });

  const problems = checkGoldenSet(broken, tools).join("\n");
  assert.match(problems, /risks\.risk_type=earthquake is not allowed/);
  assert.match(problems, /expects valuation, which the endpoint does not list/);
  assert.match(problems, /schools has no argument radius_miles/);
  assert.match(problems, /6 positive cases, OpenAI asks for 5/);
});

test("the checker notices a tool no case exercises", async () => {
  const tools = await chatgptTools();
  const set = loadSet();
  set.cases = set.cases.filter((c) => !c.expect.calls.some((call) => call.tool === "deprivation"));
  assert.match(checkGoldenSet(set, tools).join("\n"), /tool deprivation: no case exercises it/);
});

test("the review packet is exactly five positive and three negative cases", async () => {
  const tools = await chatgptTools();
  const set = loadSet();
  const boundary = set.cases.find((c) => c.kind === "boundary")!;
  boundary.review = true;

  const problems = checkGoldenSet(set, tools).join("\n");
  assert.match(problems, /boundary cases are not part of the review packet/);
  assert.match(problems, /9 cases in all, OpenAI asks for 8/);
});

test("allowed calls are checked like required ones, and negatives allow none", async () => {
  const tools = await chatgptTools();
  const set = loadSet();
  const outside = set.cases.find((c) => c.id === "boundary-outside-uk")!;
  outside.expect.allowed = [{ tool: "address_lookup", args: {} }];
  const negative = set.cases.find((c) => c.kind === "negative")!;
  negative.expect.allowed = [{ tool: "address_match", args: {} }];

  const problems = checkGoldenSet(set, tools).join("\n");
  assert.match(problems, /expects address_lookup, which the endpoint does not list/);
  assert.match(problems, /a negative case must expect and allow no calls/);
});

test("a tool only ever allowed, never required, is not exercised", async () => {
  const tools = await chatgptTools();
  const set = loadSet();
  for (const c of set.cases) {
    if (c.expect.calls.some((call) => call.tool === "broadband")) {
      c.expect.allowed = [...(c.expect.allowed ?? []), ...c.expect.calls];
      c.expect.calls = c.expect.calls.filter((call) => call.tool !== "broadband");
    }
  }
  assert.match(checkGoldenSet(set, tools).join("\n"), /tool broadband: no case exercises it/);
});
