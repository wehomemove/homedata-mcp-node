import assert from "node:assert/strict";
import { test } from "node:test";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { HomedataClient } from "../client.js";
import { createHomemoveHttpHandler } from "../homemove/http.js";
import { MotusClient, type MotusProduct } from "../homemove/motus.js";
import { PropertyLookup } from "../homemove/property.js";
import { matchOption, quote, resolveProduct } from "../homemove/quote.js";
import { buildHomemoveServer, planNarration, quoteNarration } from "../homemove/server.js";
import { planMove } from "../homemove/plan.js";
import { continueUrlForQuote } from "../homemove/handoff.js";
import { HOMEMOVE_ASSET_PREFIX, HOMEMOVE_WIDGET_URI } from "../homemove/widget.js";

const BANDS = [["1", "Up to £100,000"], ["5", "£300,001 - £400,000"], ["6", "£400,001 - £500,000"]].map(([value, label]) => ({ value: value!, label: label! }));
const BEDS = ["1", "2", "3", "4", "5"].map((v) => ({ value: v, label: v === "5" ? "5+ Bedrooms" : `${v} Bedroom${v === "1" ? "" : "s"}` }));

/** Shapes copied from motus list_products on live pricing (16 Oct 2026). */
const PRODUCTS: MotusProduct[] = [
  { id: 2, name: "Level 2 Survey", type: "surveys", is_addon: false, pricing: "linear", price_gbp: null, inputs: [{ key: 13, name: "property_price", options: BANDS }] },
  { id: 1039, name: "Snagging Survey", type: "surveys", is_addon: false, pricing: "matrix", price_gbp: null, inputs: [{ key: 1, name: "beds", options: BEDS }, { key: 51, name: "snagging_type", options: [{ value: "1", label: "Pre-inspection" }, { value: "2", label: "Post-Completion" }] }] },
  { id: 1097, name: "End of Tenancy Clean", type: "cleaning", is_addon: false, pricing: "linear", price_gbp: null, inputs: [{ key: 1, name: "beds", options: BEDS }] },
  { id: 1054, name: "Removals", type: "removals", is_addon: false, pricing: "linear", price_gbp: null, inputs: [{ key: 1, name: "beds", options: BEDS }] },
  { id: 1081, name: "EPC Assessment", type: "surveys", is_addon: false, pricing: "flat", price_gbp: 99, inputs: [] },
  { id: 1085, name: "Gas CP12  Safety Certificate", type: "surveys", is_addon: false, pricing: "flat", price_gbp: 119, inputs: [] },
];

type Sent = { url: string; body: Record<string, unknown> };

/** The live website picker (is_default furniture), trimmed. */
const PICKER = [
  { room: "Bedrooms", items: [{ id: 1238, name: "Double Bed & Mattress", cubic_meters: 1.4213 }, { id: 1365, name: "Kingsize Bed & Mattress", cubic_meters: 1.995 }, { id: 1844, name: "Double Wardrobe", cubic_meters: 1.242 }] },
  { room: "Living", items: [{ id: 1584, name: "Three Seater Sofa", cubic_meters: 1.4653 }, { id: 1611, name: "Two Seater Sofa", cubic_meters: 1.1154 }] },
  { room: "Kitchen", items: [{ id: 1891, name: "Fridge Freezer", cubic_meters: 0.5575 }] },
  { room: "Boxes & Bags", items: [{ id: 1411, name: "Medium Box", cubic_meters: 0.125 }] },
];

/** Atlas's live legal pricing as motus get_legal_quote totals it (£350k freehold purchase, mortgage: £1,152). */
const LEGAL = { transaction: "purchase", tenure: "freehold", property_price: 350000, funding_type: "mortgage", total_gbp: 1152, legal_fee_gbp: 910,
  disbursements: [{ label: "Pre-Completion Searches", amount_gbp: 14 }, { label: "Bank Transfer", amount_gbp: 48 }, { label: "Financial Settlement & Clearance", amount_gbp: 120 }, { label: "SDLT Return Submission", amount_gbp: 60 }], search_pack_gbp: 399 };

/** A motus that prices like the live grids: band 5 L2 £499, beds-priced clean, flat EPC, 5+ clean by hand. */
function fakeMotus(sent: Sent[] = []) {
  const json = (data: unknown, status = 200) => new Response(JSON.stringify(status < 400 ? { success: true, data } : { success: false, error: data }), { status, headers: { "Content-Type": "application/json" } });
  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input), body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    sent.push({ url, body });
    if (url.endsWith("/products")) return json({ products: PRODUCTS });
    if (url.endsWith("/removals-quote")) {
      const inv = (body["inventory"] ?? {}) as Record<string, number>;
      if (!Object.keys(inv).length) return json({ price_gbp: null, needs: ["inventory"], picker: PICKER });
      if (body["to_postcode"] === "ZZ9 9ZZ") return json("quote_unavailable", 503);
      return json({ price_gbp: 913, from_postcode: "SW1A2AA", to_postcode: "LS14AP", distance_km: 25, cubic_meters: 16.6, van_type: "7.5 Tonne", num_vans: 1, crew_size: 3, estimated_hours: 8.7 });
    }
    if (url.endsWith("/legal-quote")) return body["tenure"] === "leasehold" && body["transaction"] === "sale" ? json("quote_unavailable", 503) : json({ ...LEGAL, transaction: body["transaction"], tenure: body["tenure"] });
    const product = PRODUCTS.find((p) => p.id === body["product_id"])!;
    const answers = (body["answers"] ?? {}) as Record<string, string>;
    const price = body["property_price"] as number | undefined;
    const band = price ? (price > 400000 ? { id: 6, min: 400001, max: 500000 } : { id: 5, min: 300001, max: 400000 }) : null;
    const missing = product.inputs.filter((i) => (i.key === 13 ? !band : answers[String(i.key)] === undefined));
    if (product.id === 1097 && answers["1"] === "5") return json("quote_unavailable", 422);
    const grid: Record<number, number> = { 2: band?.id === 6 ? 599 : 499, 1097: [0, 209, 267, 376, 484][Number(answers["1"])] ?? 0, 1054: 999, 1039: 449, 1081: 99, 1085: 119 };
    const priced = missing.length === 0;
    return json({ product: { id: product.id, name: product.name, type: product.type }, postcode: "SW1A 2AA", price_gbp: priced ? grid[product.id] : 445,
      pricing_basis: priced ? "answers" : "product_base_price", from: !priced, property_price_band: band, bands: [], needs: priced ? [] : missing, price_is_final: false, coverage_checked: false });
  }) as typeof fetch;
  return new MotusClient({ bearer: "test", baseUrl: "https://motus.test", fetchImpl });
}

function fakeHomedataClient(charged: string[] = []) { return (fakeHomedata(charged) as unknown as { homedata: HomedataClient }).homedata; }

function fakeHomedata(charged: string[] = []) {
  const fetchImpl = (async (input: string | URL) => {
    const url = new URL(String(input));
    charged.push(url.pathname + url.search);
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    if (url.pathname === "/address/match/") {
      if (/nowhere/i.test(url.searchParams.get("address") ?? "")) return json({ reason: "no_match" }, 422);
      return json({ uprn: 100023336956, full_address: "10 DOWNING STREET, LONDON, SW1A 2AA", postcode: "SW1A 2AA" });
    }
    if (url.pathname.endsWith("/core/")) return json({ valuation_estimate: { estimate_gbp: 350000 } });
    if (url.pathname === "/calculators/stamp-duty/") return json({ price: 350000, buyer_type: url.searchParams.get("buyer_type"), total_tax: 2500, note: "First-time buyer relief applied.", jurisdiction: "England and Northern Ireland", thresholds_from: "1 April 2025" });
    return json({ uprn: 100023336956, rooms: { bedrooms: null, predicted_bedrooms: 3 }, lr_title: { title_class: "Absolute freehold title" } });
  }) as typeof fetch;
  return new PropertyLookup(new HomedataClient({ apiKey: "test", fetchImpl }));
}

test("the words people type find the right product", () => {
  const find = (s: string) => resolveProduct(PRODUCTS, s).product?.name;
  assert.equal(find("how much is a homebuyers survey"), "Level 2 Survey");
  assert.equal(find("RICS level 2"), "Level 2 Survey");
  assert.equal(find("move out clean"), "End of Tenancy Clean");
  assert.equal(find("removal company quote"), undefined, "the bedroom grid is never a removals price");
  assert.equal(find("1054"), "Removals", "only an explicit id reaches the product, and quote() sends that to the guide price");
  assert.equal(find("gas safety certificate"), "Gas CP12  Safety Certificate");
  assert.equal(find("EPC"), "EPC Assessment");
  assert.equal(find("1039"), "Snagging Survey");
  assert.equal(find("knitting lessons"), undefined);
});

test("answers in the user's words become the option values motus expects", () => {
  const snag = PRODUCTS[1]!;
  assert.equal(matchOption(snag.inputs[1]!, "post-completion"), "2");
  assert.equal(matchOption(snag.inputs[1]!, "Pre-inspection"), "1");
  assert.equal(matchOption(snag.inputs[0]!, 3), "3");
  assert.equal(matchOption(snag.inputs[0]!, "7"), "5", "beyond the top band is the 5+ option");
  assert.equal(matchOption(snag.inputs[0]!, "lots"), undefined);
  assert.equal(matchOption(snag.inputs[1]!, "before completion"), "1", "found live: the model passes everyday words");
  assert.equal(matchOption(snag.inputs[1]!, "after we've moved in"), "2");
});

test("an address fills bedrooms from the property record and says it was assumed", async () => {
  const sent: Sent[] = [], charged: string[] = [];
  const answer = await quote({ service: "end of tenancy clean", postcode: "SW1A 2AA", address: "10 Downing Street" }, { motus: fakeMotus(sent), property: fakeHomedata(charged) });
  assert.equal(answer.status, "priced");
  assert.equal(answer.status === "priced" && answer.price_gbp, 376);
  assert.deepEqual(sent.at(-1)!.body["answers"], { "1": "3" });
  assert.deepEqual(answer.status === "priced" && answer.assumed, [{ name: "beds", value: "3 Bedrooms", source: "Homedata's estimate for this home" }]);
  assert.ok(!charged.some((path) => path.includes("/core/")), "a bedrooms-priced product never buys the 25-token core record");
});

test("a value-band survey with an address uses the estimate only to pick the band", async () => {
  const charged: string[] = [];
  const answer = await quote({ service: "level 2 survey", postcode: "SW1A 2AA", address: "10 Downing Street" }, { motus: fakeMotus(), property: fakeHomedata(charged) });
  assert.equal(answer.status, "priced");
  assert.equal(answer.status === "priced" && answer.price_gbp, 499);
  assert.ok(charged.some((path) => path.includes("/core/")));
  const narration = quoteNarration(answer);
  assert.match(narration, /£300k–£400k value band/);
  assert.equal(answer.status === "priced" && answer.booking_url, "https://homemove.com/quote/surveys/rics-level-2?pc=SW1A2AA");
  assert.doesNotMatch(narration, /350,?000/, "the estimate itself is never told to the model");
  assert.doesNotMatch(JSON.stringify(answer), /350000/, "nor to the widget");
});

test("a stated value wins over the estimate, and costs no core lookup", async () => {
  const charged: string[] = [];
  const answer = await quote({ service: "level 2 survey", postcode: "SW1A 2AA", address: "10 Downing Street", property_price: 450000 }, { motus: fakeMotus(), property: fakeHomedata(charged) });
  assert.equal(answer.status === "priced" && answer.price_gbp, 599);
  assert.ok(!charged.some((path) => path.includes("/core/")));
});

test("without enough to price, it returns the questions and no figure", async () => {
  const answer = await quote({ service: "snagging", postcode: "M1 1AE", bedrooms: 2 }, { motus: fakeMotus(), property: fakeHomedata() });
  assert.equal(answer.status, "needs_answers");
  assert.deepEqual(answer.status === "needs_answers" && answer.questions.map((q) => [q.name, q.options]), [["snagging_type", ["Pre-inspection", "Post-Completion"]]]);
  assert.doesNotMatch(quoteNarration(answer), /£\d/, "a base or 'from' price is never narrated");
  assert.doesNotMatch(JSON.stringify(answer), /445/, "motus's base price never reaches the card either");

  const value = await quote({ service: "level 2", postcode: "M1 1AE" }, { motus: fakeMotus(), property: fakeHomedata() });
  assert.deepEqual(value.status === "needs_answers" && value.questions.map((q) => q.name), ["property_price"]);
});

test("a hand-quoted combination, an unknown service and an unmatched address each say so", async () => {
  const deps = { motus: fakeMotus(), property: fakeHomedata() };
  assert.equal((await quote({ service: "end of tenancy clean", postcode: "SW1A 2AA", bedrooms: 6 }, deps)).status, "quoted_by_hand");
  assert.equal((await quote({ service: "knitting lessons", postcode: "SW1A 2AA" }, deps)).status, "unknown_service");
  const lost = await quote({ service: "epc", postcode: "SW1A 2AA", address: "1 Nowhere Lane" }, deps);
  assert.deepEqual(lost, { status: "address_not_found", reason: "no_match", postcode: "SW1A 2AA" });
});

test("ChatGPT sees two no-sign-in tools, the quote card template, and a widget that loads from this origin", async () => {
  const server = buildHomemoveServer({ motus: fakeMotus(), property: fakeHomedata(), assetOrigin: "https://mcp.homemove.com" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "t", version: "1" });
  await Promise.all([server.connect(b), client.connect(a)]);
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name), ["homemove_quote", "homemove_services"]);
  for (const tool of tools) {
    assert.deepEqual(tool._meta?.["securitySchemes"], [{ type: "noauth" }]);
    assert.equal(tool.annotations?.readOnlyHint, true);
  }
  assert.equal(tools[0]!._meta?.["openai/outputTemplate"], HOMEMOVE_WIDGET_URI);
  const resource = await client.readResource({ uri: HOMEMOVE_WIDGET_URI });
  const html = String((resource.contents[0] as { text: string }).text);
  assert.match(html, new RegExp(`src="https://mcp\\.homemove\\.com${HOMEMOVE_ASSET_PREFIX}/quote\\.js"`));
  assert.match(html, /<script async /, "never parser-blocking: ChatGPT desktop would never reach DOMContentLoaded");
  const priced = await client.callTool({ name: "homemove_quote", arguments: { service: "EPC", postcode: "sw1a 2aa" } });
  assert.equal((priced.structuredContent as { price_gbp?: number }).price_gbp, 99);
  const bad = await client.callTool({ name: "homemove_quote", arguments: { service: "EPC", postcode: "nowhere" } });
  assert.equal(bad.isError, true);
  await client.close();
});

test("the endpoint serves the widget's Homie art and code, and nothing else under that prefix", async () => {
  const handler = createHomemoveHttpHandler({ motus: fakeMotus(), property: fakeHomedata(), assetOrigin: "https://mcp.homemove.com" });
  const get = async (path: string) => {
    const req = Object.assign(Readable.from([]), { url: path, method: "GET", headers: {}, socket: { remoteAddress: "127.0.0.1" } }) as unknown as IncomingMessage;
    let status = 0; const headers: Record<string, string> = {};
    const res = { headersSent: false, setHeader() {}, on() {}, writeHead(s: number, h?: Record<string, string>) { status = s; Object.assign(headers, h); return this; }, end() { return this; } } as unknown as ServerResponse;
    await handler(req, res);
    return { status, headers };
  };
  for (const file of ["quote.js", "quote.css", "assets/rig.json", "assets/loops/loop-survey-base.webp", "assets/poses/survey-surveyor-cheer.webp"]) {
    const { status, headers } = await get(`${HOMEMOVE_ASSET_PREFIX}/${file}`);
    assert.equal(status, 200, file);
    assert.match(headers["Cache-Control"] ?? "", /immutable/);
  }
  assert.equal((await get(`${HOMEMOVE_ASSET_PREFIX}/../../package.json`)).status, 404);
  assert.equal((await get("/healthz")).status, 200);
});

test("conveyancing asks what Atlas needs, fills tenure from the title, and quotes motus's total", async () => {
  const sent: Sent[] = [];
  const deps = { motus: fakeMotus(sent), property: fakeHomedata() };
  const first = await quote({ service: "how much are conveyancing fees", postcode: "SW1A 2AA" }, deps);
  assert.equal(first.status, "needs_answers");
  assert.deepEqual(first.status === "needs_answers" && first.questions.map((q) => q.name), ["transaction", "property_price", "tenure", "funding_type"]);

  const priced = await quote({ service: "conveyancing for my purchase", postcode: "SW1A 2AA", address: "10 Downing Street", property_price: 350000, answers: { funding_type: "Mortgage" } }, deps);
  assert.equal(priced.status, "priced");
  assert.equal(priced.status === "priced" && priced.price_gbp, 1152);
  assert.deepEqual(sent.at(-1)!.body, { transaction: "purchase", tenure: "freehold", property_price: 350000, funding_type: "mortgage" });
  assert.deepEqual(priced.status === "priced" && priced.assumed, [{ name: "tenure", value: "Freehold", source: "the Land Registry title" }]);
  assert.match(quoteNarration(priced), /Search pack £399 is a separate line, not in that total/);
  assert.equal(priced.status === "priced" && priced.booking_url, "https://homemove.com/legal/quote/?pc=SW1A2AA");

  // The widget re-asks with the product id: 1063 is selling, priced by Atlas, never the catalogue's placeholder row.
  const resold = await quote({ service: "1063", postcode: "SW1A 2AA", property_price: 250000, answers: { tenure: "Leasehold", funding_type: "No mortgage" } }, deps);
  assert.equal(resold.status, "quoted_by_hand", "Atlas not answering is never a guessed figure");
  assert.deepEqual(sent.at(-1)!.body, { transaction: "sale", tenure: "leasehold", property_price: 250000, funding_type: "cash" });
});

test("removals ask where to and how big, price a typical home as indicative, or the user's own list exactly", async () => {
  const sent: Sent[] = [];
  const deps = { motus: fakeMotus(sent), property: fakeHomedata() };
  const ask = await quote({ service: "how much does a removal company cost", postcode: "SW1A 2AA" }, deps);
  assert.equal(ask.status, "needs_answers");
  assert.deepEqual(ask.status === "needs_answers" && ask.questions.map((q) => q.name), ["to_postcode", "home_size"]);

  const typical = await quote({ service: "removals", postcode: "SW1A 2AA", to_postcode: "LS1 4AP", answers: { home_size: "2 bedrooms" } }, deps);
  assert.equal(typical.status, "priced");
  assert.equal(typical.status === "priced" && typical.indicative, "a typical 2-bedroom home");
  assert.ok(Object.keys(sent.at(-1)!.body["inventory"] as object).length > 3, "a typical household from the picker's own items");
  assert.match(quoteNarration(typical), /indicative removals price for a typical 2-bedroom home/);
  assert.match(quoteNarration(typical), /Say it is indicative/);
  assert.ok(ask.status === "needs_answers" && ask.picker?.length, "the card gets the picker");
  assert.ok(!sent.some((s) => s.url.endsWith("/quote")), "the bedroom grid is never asked");

  const priced = await quote({ service: "removals", postcode: "SW1A 2AA", to_postcode: "LS1 4AP", items: [{ item: "king size bed" }, { item: "sofa", quantity: 2 }, { item: "boxes", quantity: 20 }, { item: "grand piano" }] }, deps);
  assert.equal(priced.status, "priced");
  assert.deepEqual(sent.at(-1)!.body["inventory"], { "1365": 1, "1584": 2, "1411": 20 });
  assert.deepEqual(priced.status === "priced" && priced.unmatched, ["grand piano"]);
  const said = quoteNarration(priced);
  assert.match(said, /£913/);
  assert.equal(priced.status === "priced" && priced.indicative, undefined, "their own list is not 'indicative'");
  assert.match(said, /7\.5 Tonne, a crew of 3/);
  assert.match(said, /Not in the price \(not on the item list\): grand piano/);

  const down = await quote({ service: "removals", postcode: "SW1A 2AA", to_postcode: "ZZ9 9ZZ", items: [{ item: "sofa" }] }, deps);
  assert.equal(down.status, "quoted_by_hand");
});

test("a whole move is priced line by line; only priced lines count, and stamp duty stays HMRC's", async () => {
  const charged: string[] = [];
  const property = fakeHomedata(charged);
  const plan = await planMove({ situation: "buying_and_selling", from_postcode: "M1 1AE", from_address: "10 Downing Street", to_postcode: "SW1A 2AA", to_address: "10 Downing Street", property_price: 350000, sale_price: 250000, first_time_buyer: true, mortgage: true },
    { motus: fakeMotus(), property, homedata: fakeHomedataClient(charged) });
  assert.deepEqual(plan.lines.map((l) => [l.step, l.answer.status]), [
    ["Get an EPC", "priced"],
    ["Instruct a conveyancer for the sale", "priced"],
    ["Instruct a conveyancer for the purchase", "priced"],
    ["Book a survey", "priced"],
    ["Book removals", "needs_answers"],
    ["Moving-out clean", "priced"],
  ]);
  // EPC 99 + sale conveyancing 1152 + purchase 1152 + L2 499 + clean (3 beds from the record) 376.
  assert.equal(plan.total_gbp, 99 + 1152 + 1152 + 499 + 376);
  assert.deepEqual(plan.unpriced, ["Book removals"]);
  assert.equal(plan.stamp_duty?.total_tax, 2500);
  const said = planNarration(plan);
  assert.match(said, /Not in that total: Book removals/);
  assert.match(said, /paid to HMRC, not Homemove, and is not in the total/);
});

test("every outcome links to homemove.com, carrying property and service details but never personal data", async () => {
  const deps = { motus: fakeMotus(), property: fakeHomedata() };
  const priced = await quote({ service: "level 2 survey", postcode: "SW1A 2AA", address: "10 Downing Street" }, deps);
  const page = new URL(continueUrlForQuote(priced, "https://homemove.com/continue/", new Date("2026-10-16T12:00:00Z")));
  assert.equal(page.origin + page.pathname, "https://homemove.com/continue/");
  assert.equal(page.searchParams.get("v"), "1");
  const data = JSON.parse(Buffer.from(page.searchParams.get("d")!, "base64url").toString());
  assert.match(data.ref, /^[A-Za-z0-9_-]{12}$/, "an opaque random handoff id");
  delete data.ref;
  assert.deepEqual(data, { source: "chatgpt", created_at: "2026-10-16T12:00:00.000Z",
    property: { postcode: "SW1A 2AA", address: "10 DOWNING STREET, LONDON, SW1A 2AA", uprn: "100023336956" },
    services: [{ product_id: 2, slug: "rics-level-2", name: "Level 2 Survey", quoted_gbp: 499 }] });
  const clean = await quote({ service: "end of tenancy clean", postcode: "SW1A 2AA", bedrooms: 3 }, deps);
  const cleanData = JSON.parse(Buffer.from(new URL(continueUrlForQuote(clean, "https://homemove.com/continue/")).searchParams.get("d")!, "base64url").toString());
  assert.deepEqual(cleanData.services, [{ kind: "cleaning", name: "End of Tenancy Clean", clean_type: "end_of_tenancy", bedrooms: 3, quoted_gbp: 376 }]);
  assert.doesNotMatch(JSON.stringify(data), /350000|@|phone|email/i, "no estimate, no personal data");
  // Without the page configured, the service's own wizard.
  assert.equal(continueUrlForQuote(priced, undefined), "https://homemove.com/quote/surveys/rics-level-2?pc=SW1A2AA");
  const byHand = await quote({ service: "end of tenancy clean", postcode: "SW1A 2AA", bedrooms: 6 }, deps);
  assert.match(continueUrlForQuote(byHand, undefined), /^https:\/\/homemove\.com\/quote\/cleaning\/$/);
});

test("the handoff carries what conveyancing and removals need to be re-priced: stated price and funding, and the inventory", async () => {
  const deps = { motus: fakeMotus(), property: fakeHomedata() };
  const read = (a: Parameters<typeof continueUrlForQuote>[0]) => JSON.parse(Buffer.from(new URL(continueUrlForQuote(a, "https://homemove.com/continue/")).searchParams.get("d")!, "base64url").toString()).services[0];
  const stated = await quote({ service: "conveyancing buying", postcode: "SW1A 2AA", address: "10 Downing Street", property_price: 350000, answers: { funding_type: "Mortgage" } }, deps);
  assert.deepEqual(read(stated), { kind: "conveyancing", name: "Conveyancing (buying)", transaction: "purchase", tenure: "freehold", property_price: 350000, funding_type: "mortgage", quoted_gbp: 1152 });
  const estimated = await quote({ service: "conveyancing buying", postcode: "SW1A 2AA", address: "10 Downing Street", answers: { funding_type: "Cash" } }, deps);
  assert.equal(estimated.status, "priced");
  assert.equal(read(estimated).property_price, undefined, "an estimated value is never handed on as theirs");
  const moving = await quote({ service: "removals", postcode: "SW1A 2AA", to_postcode: "LS1 4AP", items: [{ item: "sofa", quantity: 2 }] }, deps);
  assert.deepEqual(read(moving).inventory, { "1584": 2 });
});

test("without motus's removals pricing, removals send people to homemove.com's removals form, not an error", async () => {
  const down = new MotusClient({ bearer: "t", baseUrl: "https://motus.test", fetchImpl: (async () => new Response("{}", { status: 404 })) as typeof fetch });
  const answer = await quote({ service: "removals", postcode: "SW1A 2AA", to_postcode: "LS1 4AP" }, { motus: down, property: fakeHomedata() });
  assert.equal(answer.status, "quoted_by_hand");
  assert.equal(continueUrlForQuote(answer, undefined), "https://homemove.com/removals/quote/?pc=SW1A2AA");
});
