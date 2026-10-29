import assert from "node:assert/strict";
import { test } from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { HomedataClient, errorGuidance } from "../client.js";
import { staticTools, tools } from "../manifest.js";
import { buildServer } from "../server.js";
import { PROFILES, type Profile } from "../profile.js";

interface Sent {
  method: string;
  path: string;
  query: Record<string, string>;
  body?: unknown;
  headers?: Record<string, string>;
}

async function connect(opts: { response?: () => Response; withKey?: boolean; profile?: Profile } = {}) {
  const sent: Sent[] = [];
  const fetchImpl = (async (...args: Parameters<typeof fetch>) => {
    const [input, init] = args;
    const url = new URL(String(input));
    sent.push({
      method: init?.method ?? "GET",
      path: url.pathname,
      query: Object.fromEntries(url.searchParams.entries()),
      ...(init?.body ? { body: JSON.parse(String(init.body)), headers: Object.fromEntries(new Headers(init.headers).entries()) } : {}),
    });
    return opts.response?.() ?? new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  const homedata = opts.withKey === false ? null : new HomedataClient({ apiKey: "parity-test", fetchImpl });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1" }, { capabilities: {} });
  await Promise.all([(opts.profile ? buildServer(homedata, opts.profile) : buildServer(homedata)).connect(a), client.connect(b)]);
  return { client, sent };
}

test("Homedata refusals and outages tell the model what to say; validation errors keep only their detail", () => {
  assert.match(String(errorGuidance(429)), /Tell the user Homedata is busy.*Do not retry straight away/);
  assert.match(String(errorGuidance(503)), /try again shortly.*Do not invent/);
  for (const status of [400, 401, 404, 422]) assert.equal(errorGuidance(status), undefined, String(status));
});

test("the server offers exactly the manifest", async () => {
  const { client } = await connect();
  const listed = (await client.listTools()).tools.map((t) => t.name).sort();
  const expected = [...tools().map((t) => t.name), ...staticTools().map((t) => t.name)].sort();
  assert.deepEqual(listed, expected);
  await client.close();
});

test("without a key only the helpers are offered", async () => {
  const { client } = await connect({ withKey: false });
  const listed = (await client.listTools()).tools.map((t) => t.name).sort();
  assert.deepEqual(listed, staticTools().map((t) => t.name).sort());
  await client.close();
});

test("invalid arguments never reach the API", async () => {
  const { client, sent } = await connect();
  for (const args of [{ uprn: "not-digits" }, { uprn: -1 }, { uprn: 1.5 }, { uprn: true }, { uprn: false }, {}, { uprn: "1", nope: "x" }]) {
    const result = await client.callTool({ name: "property_core", arguments: args });
    assert.equal(result.isError, true, JSON.stringify(args));
  }
  const badEnum = await client.callTool({ name: "risks", arguments: { risk_type: "volcano", uprn: "1" } });
  assert.equal(badEnum.isError, true);
  assert.deepEqual(sent, [], "a rejected call still reached the API");
  await client.close();
});

test("a call reports what it cost", async () => {
  const { client } = await connect({
    response: () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json", "X-Tokens-Charged": "25", "X-Tokens-Balance": "975" },
      }),
  });
  const result = await client.callTool({ name: "property_core", arguments: { uprn: "100023336956" } });
  assert.deepEqual(result._meta, { homedata: { tokens_charged: "25", tokens_balance: "975" } });
  await client.close();
});

test("an API error is reported as an error", async () => {
  const { client } = await connect({
    response: () => new Response(JSON.stringify({ error: "insufficient_tokens" }), { status: 402, headers: { "Content-Type": "application/json" } }),
  });
  const result = await client.callTool({ name: "property_core", arguments: { uprn: "100023336956" } });
  assert.equal(result.isError, true);
  await client.close();
});

test("the stdio server passes a low-balance refusal through as the API sent it", async () => {
  const body = {
    error: { code: "insufficient_tokens", required: 25, available: 3, topup_url: "https://homedata.co.uk/subscription" },
  };
  const { client } = await connect({
    response: () => new Response(JSON.stringify(body), { status: 402, headers: { "Content-Type": "application/json" } }),
  });
  const result = await client.callTool({ name: "property_core", arguments: { uprn: "100023336956" } });
  assert.equal(result.isError, true);
  assert.deepEqual(result.structuredContent, { error: "api_error", status_code: 402, message: errorGuidance(402), detail: body });
  assert.match(String(errorGuidance(402)), /Tell the user their Homedata balance needs topping up/);
  await client.close();
});

test("the helpers spend nothing", async () => {
  // Watches both routes out: the client the server was given, and the global fetch a
  // helper could reach for directly. Recording only the injected client would miss that.
  const { client, sent } = await connect();
  const realFetch = globalThis.fetch;
  const globalCalls: string[] = [];
  globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
    globalCalls.push(String(args[0]));
    return realFetch(...args);
  }) as typeof fetch;
  try {
    for (const helper of staticTools()) await client.callTool({ name: helper.name, arguments: {} });
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.deepEqual(sent, [], "a helper called the API through the client");
  assert.deepEqual(globalCalls, [], "a helper called the API through global fetch");
  await client.close();
});

test("every tool sends one request to its manifest endpoint", async () => {
  const { client, sent } = await connect();
  for (const spec of tools()) {
    const args: Record<string, unknown> = {};
    spec.params.forEach((param, index) => {
      if (param.enum) args[param.name] = param.enum[0];
      else if (param.type === "number") args[param.name] = index + 2;
      else if (param.pattern === "^\\d+$") args[param.name] = "100023336956";
      else args[param.name] = `${param.name}-sample`;
    });
    sent.length = 0;
    const result = await client.callTool({ name: spec.name, arguments: args });
    assert.notEqual(result.isError, true, `${spec.name}: ${JSON.stringify(result.content)}`);
    assert.equal(sent.length, 1, `${spec.name} sent ${sent.length} requests`);
    assert.equal(sent[0]!.method, spec.method);
    const expectedQuery = Object.fromEntries(
      spec.params.filter((p) => p.in === "query").map((p) => [p.name, String(args[p.name])]),
    );
    assert.deepEqual(sent[0]!.query, expectedQuery, spec.name);
    if (spec.params.some((p) => p.in === "body")) {
      assert.deepEqual(sent[0]!.body, Object.fromEntries(spec.params.filter((p) => p.in === "body").map((p) => [p.name, String(args[p.name])])));
      assert.equal(sent[0]!.headers?.["content-type"], "application/json");
      if (spec.idempotency_key) assert.match(sent[0]!.headers?.["idempotency-key"] ?? "", /^[0-9a-f-]{36}$/);
    }
  }
  await client.close();
});

test("a path parameter is percent-encoded on the wire", async () => {
  // The parity dump reports decoded paths to match the guard's convention, so the
  // encoding itself is asserted here, where it cannot be normalised away.
  //
  // A space alone proves nothing: new URL() normalises " " to %20 whether or not
  // the code encodes it. A value carrying "/" and "#" does prove it, and those are
  // the characters that matter: unencoded they become a different path and a
  // fragment, so the request would go somewhere else entirely.
  const { client, sent } = await connect();
  await client.callTool({ name: "address_postcode", arguments: { postcode: "SW1A 2AA" } });
  assert.deepEqual(sent, [{ method: "GET", path: "/address/postcode/SW1A%202AA/", query: {} }]);

  sent.length = 0;
  await client.callTool({ name: "address_postcode", arguments: { postcode: "A/B#C" } });
  assert.deepEqual(sent, [{ method: "GET", path: "/address/postcode/A%2FB%23C/", query: {} }]);
  await client.close();
});

test("a request that never reached the API is an error, not a silent success", async () => {
  // A transport failure used to come back as status 0, which is not >= 400, so the
  // server reported success and the CLI exited 0.
  const fetchImpl = (async () => {
    throw new TypeError("fetch failed");
  }) as typeof fetch;
  const homedata = new HomedataClient({ apiKey: "k", fetchImpl });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1" }, { capabilities: {} });
  await Promise.all([buildServer(homedata).connect(a), client.connect(b)]);
  const result = await client.callTool({ name: "property_core", arguments: { uprn: "100023336956" } });
  assert.equal(result.isError, true);
  await client.close();
});

test("a non-JSON error body is preserved", async () => {
  const { client } = await connect({
    response: () => new Response("upstream is down", { status: 503, headers: { "Content-Type": "text/plain" } }),
  });
  const result = await client.callTool({ name: "property_core", arguments: { uprn: "100023336956" } });
  assert.equal(result.isError, true);
  assert.match(JSON.stringify(result.structuredContent), /upstream is down/);
  await client.close();
});

for (const reason of [null, "no_match", "multiple_matches"] as const) {
  test(`address_match preserves ${reason ?? "address resolution"} and charging`, async () => {
    const status = reason ? 422 : 200;
    const body = reason ? { reason } : { uprn: "100023336956", address_resolution: { match: "exact" } };
    const { client, sent } = await connect({ response: () => new Response(JSON.stringify(body), {
      status, headers: { "Content-Type": "application/json", "X-Tokens-Charged": reason ? "0" : "5" },
    }) });
    try {
      const listed = (await client.listTools()).tools;
      assert.ok(listed.some((tool) => tool.name === "address_match"));
      assert.ok(!listed.some((tool) => tool.name === "address_" + "find"));
      const result = await client.callTool({ name: "address_match", arguments: { address: "10 Downing Street", postcode: "SW1A 2AA" } });
      assert.equal(result.isError === true, Boolean(reason));
      assert.deepEqual(result.structuredContent, reason ? { error: "api_error", status_code: 422, detail: body } : body);
      assert.deepEqual(result._meta, { homedata: { tokens_charged: reason ? "0" : "5" } });
      for (const missing of [{ address: "10 Downing Street" }, { postcode: "SW1A 2AA" }, { q: "10 Downing Street" }]) {
        assert.equal((await client.callTool({ name: "address_match", arguments: missing })).isError, true);
      }
      assert.deepEqual(sent, [{ method: "GET", path: "/address/match/", query: { address: "10 Downing Street", postcode: "SW1A 2AA" } }]);
    } finally { await client.close(); }
  });
}

test("in ChatGPT, property_core never carries a valuation; everywhere else it does", async () => {
  // The ChatGPT listing and review cases say Homedata does not value homes. The API
  // added valuation_estimate to property_core in October 2026 (measured 16 Oct).
  const body = { uprn: 100023336956, address: { address_line_1: "10 DOWNING STREET", full_address: "10 DOWNING STREET" }, valuation_estimate: { estimate_gbp: 84087000 }, council_tax: { band: "H" } };
  const respond = () => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  const chatgpt = await connect({ response: respond, profile: PROFILES.chatgpt });
  const answer = await chatgpt.client.callTool({ name: "property_core", arguments: { uprn: "100023336956" } });
  assert.deepEqual(answer.structuredContent, { uprn: 100023336956, address: { address_line_1: "10 DOWNING STREET", full_address: "10 DOWNING STREET" }, council_tax: { band: "H" } });
  assert.doesNotMatch(JSON.stringify(answer.content), /valuation|84087000/, "nor in the text the model reads");
  await chatgpt.client.close();
  const stdio = await connect({ response: respond });
  const full = await stdio.client.callTool({ name: "property_core", arguments: { uprn: "100023336956" } });
  assert.deepEqual((full.structuredContent as Record<string, unknown>)["valuation_estimate"], { estimate_gbp: 84087000 });
  await stdio.client.close();
});

test("numeric address results pass straight into every UPRN tool", async () => {
  const uprn = 100023336956;
  const { client, sent } = await connect({ response: () => new Response(JSON.stringify({ uprn }), {
    headers: { "Content-Type": "application/json" },
  }) });
  try {
    for (const name of ["address_match", "address_postcode"]) {
      const result = await client.callTool({ name, arguments: name === "address_match" ? { address: "10 Downing Street", postcode: "SW1A 2AA" } : { postcode: "SW1A 2AA" } });
      assert.notEqual(result.isError, true);
      const returned = (result.structuredContent as { uprn: number }).uprn;
      assert.equal(returned, uprn);
      for (const spec of tools().filter((t) => t.params.some((p) => p.name === "uprn"))) {
        const args: Record<string, unknown> = { uprn: returned };
        for (const p of spec.params) {
          if (p.name !== "uprn" && p.required) args[p.name] = p.enum?.[0] ?? "epc";
        }
        const answer = await client.callTool({ name: spec.name, arguments: args });
        assert.notEqual(answer.isError, true, spec.name);
        const request = sent.at(-1)!;
        const carried = [request.path.includes(String(uprn)), request.query["uprn"] === String(uprn), (request.body as Record<string, unknown> | undefined)?.["uprn"] === String(uprn)];
        assert.ok(carried.some(Boolean), spec.name);
      }
    }
  } finally { await client.close(); }
});

// Synthetic fixtures use the field shapes measured on 29 October, with fake
// names. These prove filtering and transport behaviour, not live API coverage.
const deniedFields = ["applicant_name", "agent_name", "agent_address", "case_officer", "head_teacher", "title_no", "address_resolution", "uprn_token", "tokens_charged", "tokens_balance"];
const privateFixture = Object.fromEntries(deniedFields.map((key) => [key, "PRIVATE_SENTINEL"]));
function assertNoPrivate(value: unknown): void {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    assert.ok(!deniedFields.includes(key), `denied key ${key}`);
    assertNoPrivate(child);
  }
}

for (const status of [200, 422]) {
  for (const [name, args] of Object.entries({
    address_match: { address: "10 Downing Street", postcode: "SW1A 2AA" },
    address_postcode: { postcode: "SW1A 2AA" },
    property_core: { uprn: "100023336956" }, attr_epc: { uprn: "100023336956" },
    council_tax: { uprn: "100023336956" }, risks: { uprn: "100023336956", risk_type: "all" },
    planning: { postcode: "SW1A 2AA" }, schools: { postcode: "SW1A 2AA" },
    broadband: { postcode: "SW1A 2AA" }, crime: { postcode: "SW1A 2AA" },
    price_trends: { outcode: "SW1A" }, price_growth: { outcode: "SW1A" },
    deprivation: { postcode: "SW1A 2AA" }, amenities_all: { uprn: "100023336956" },
  })) {
    test(`ChatGPT ${name} filters private fields at every depth on HTTP ${status}`, async () => {
      const school = { name: "Example Primary", contact: { ...privateFixture, telephone: "public switchboard" } };
      const body = {
        uprn: 100023336956, ...privateFixture,
        full_address: name === "address_match" ? "PRIVATE_SENTINEL" : "Public site address", address_line_1: "10 DOWNING STREET", post_town: "LONDON", postcode: "SW1A 2AA",
        address: { full_address: name === "property_core" ? "PRIVATE_SENTINEL" : "10 DOWNING STREET, LONDON, SW1A 2AA", address_line_1: "10 DOWNING STREET", post_town: "LONDON", postcode: "SW1A 2AA" },
        addresses: [{ ...privateFixture, address: name === "address_postcode" ? "PRIVATE_SENTINEL" : "10 DOWNING STREET", building_number: "10", street: "DOWNING STREET", town: "LONDON" }],
        schools: { query: "PRIVATE_QUERY", schools: [school], deep: [{ ...privateFixture, children: [privateFixture] }] },
        query: "PRIVATE_QUERY", results: [{ ...privateFixture, description: "Extension" }],
        lr_title: { title_no: "PRIVATE_SENTINEL", estate_interest: "Freehold" },
        title_boundary: { title_no: "PRIVATE_SENTINEL", geometry: { type: "Polygon", coordinates: [] } },
        council_tax: { band: "H", deeper: [privateFixture] },
        future_section: { owner: "PRIVATE_SENTINEL" }, valuation_estimate: { estimate_gbp: 1 },
      };
      // Unknown sections are tested separately; they are legitimate pass-through
      // for tools other than the overview, so don't inject new personal categories.
      if (name !== "property_core" || status !== 200) delete (body as Partial<typeof body>).future_section;
      const response = () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "X-Tokens-Charged": "25", "X-Tokens-Balance": "100" } });
      const { client, sent } = await connect({ response, profile: PROFILES.chatgpt });
      try {
        const answer = await client.callTool({ name, arguments: args });
        assert.equal(sent.length, 1, "must reach the API, not fail argument validation");
        assertNoPrivate(answer);
        assert.equal(answer._meta, undefined);
        assert.equal(answer.isError ?? false, status >= 400);
        const envelope = answer.structuredContent as Record<string, unknown>;
        const data = (status >= 400 ? envelope.detail : envelope) as Record<string, unknown>;
        if (status === 200 && name === "property_core") assert.equal(data.future_section, undefined);
        if (name === "schools" || name === "property_core") assert.doesNotMatch(JSON.stringify(answer), /PRIVATE_QUERY/);
        assert.equal((data.address as Record<string, unknown>).full_address, "10 DOWNING STREET, LONDON, SW1A 2AA");
        assert.equal((data.council_tax as Record<string, unknown>).band, "H");
        assert.doesNotMatch(JSON.stringify(answer.content), /PRIVATE_SENTINEL/);
      } finally { await client.close(); }
    });
  }
}

test("ChatGPT preserves advertised overview sections and drops future additions; stdio is unchanged", async () => {
  const sections = ["address", "property_type", "rooms", "epc", "last_sold", "construction", "dimensions", "garden", "parking", "lr_title", "title_boundary", "council_tax", "flood", "schools", "broadband", "crime", "demographics", "solar", "lr_sales", "listed_buildings", "conservation", "planning_designations"];
  const body = { uprn: 100023336956, ...Object.fromEntries(sections.map((key) => [key, { public_fact: key, ...privateFixture }])), future_private_section: { owner: "PRIVATE_SENTINEL" } };
  for (const profile of [PROFILES.chatgpt, PROFILES.stdio]) {
    const { client } = await connect({ profile, response: () => new Response(JSON.stringify(body), { headers: { "X-Tokens-Balance": "100" } }) });
    try {
      const answer = await client.callTool({ name: "property_core", arguments: { uprn: "100023336956" } });
      if (profile.name === "stdio") {
        assert.deepEqual(answer.structuredContent, body);
        assert.deepEqual(answer._meta, { homedata: { tokens_balance: "100" } });
      } else {
        assert.deepEqual(answer.structuredContent, { uprn: body.uprn, ...Object.fromEntries(sections.map((key) => [key, { public_fact: key }])) });
      }
    } finally { await client.close(); }
  }
});

test("ChatGPT postcode labels use property parts, and never fall back to an occupant label", async () => {
  const addresses = [
    { uprn: 1, address: "PRIVATE_SENTINEL", sub_building: "FLAT 2", building_number: "10", street: "EXAMPLE ROAD", town: "LONDON" },
    { uprn: 2, full_address: "PRIVATE_SENTINEL", postcode: "SW1A 2AA" },
  ];
  const { client } = await connect({ profile: PROFILES.chatgpt, response: () => new Response(JSON.stringify({ addresses })) });
  try {
    const answer = await client.callTool({ name: "address_postcode", arguments: { postcode: "SW1A 2AA" } });
    const records = (answer.structuredContent as { addresses: Record<string, unknown>[] }).addresses;
    assert.equal(records[0].address, "FLAT 2, 10 EXAMPLE ROAD, LONDON");
    assert.equal(records[1].full_address, undefined);
    assert.doesNotMatch(JSON.stringify(answer), /PRIVATE_SENTINEL/);
  } finally { await client.close(); }
});

for (const [name, args, body] of [
  ["planning", { postcode: "SW1A 2AA" }, { results: [{ address: "12 Example Road, London SW1A 1AA", description: "Rear extension", applicant_name: "PRIVATE_SENTINEL" }] }],
  ["schools", { postcode: "SW1A 2AA" }, { schools: [{ name: "Example School", full_address: "School Lane, London", contact: { head_teacher: "PRIVATE_SENTINEL" } }] }],
  ["amenities_all", { uprn: "100023336956" }, { healthcare: { gps: [{ name: "Example Surgery", address: "1 High St, London" }] } }],
] as const) {
  test(`ChatGPT ${name} preserves public site addresses`, async () => {
    const { client } = await connect({ profile: PROFILES.chatgpt, response: () => new Response(JSON.stringify(body)) });
    try {
      const answer = await client.callTool({ name, arguments: args });
      const expected = JSON.parse(JSON.stringify(body), (key, value) => deniedFields.includes(key) ? undefined : value);
      assert.deepEqual(answer.structuredContent, expected);
      assert.deepEqual(JSON.parse((answer.content as { text: string }[])[0].text), expected);
      assertNoPrivate(answer);
    } finally { await client.close(); }
  });
}
