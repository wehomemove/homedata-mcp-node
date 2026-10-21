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
import { BroadbandClient } from "../homemove/broadband.js";
import { tagged } from "../homemove/utm.js";
import { HomeVisitors } from "../home/activity.js";
import { planMove } from "../homemove/plan.js";
import { continueUrlForPlan, continueUrlForQuote } from "../homemove/handoff.js";
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
  { id: 19, name: "Insurance Reinstatement Survey", type: "surveys", is_addon: false, pricing: "linear", price_gbp: null, inputs: [{ key: 13, name: "property_price", options: BANDS }] },
  { id: 1091, name: "Buildings Insurance", type: "insurance", is_addon: false, pricing: "flat", price_gbp: 120, inputs: [] },
  { id: 1130, name: "B2B Subscription", type: "removals", is_addon: false, pricing: "flat", price_gbp: 39.99, inputs: [] },
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
      pricing_basis: priced ? "answers" : "product_base_price", from: !priced, property_price_band: band, bands: product.inputs.some((i) => i.key === 13) ? [{ band_id: 3, min: 1, max: 200000, price_gbp: 449 }, { band_id: 4, min: 200001, max: 300000, price_gbp: 449 }, { band_id: 5, min: 300001, max: 400000, price_gbp: 499 }, { band_id: 6, min: 400001, max: 100000000, price_gbp: 599 }] : [], needs: priced ? [] : missing, price_is_final: false, coverage_checked: false });
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
    if (url.pathname === "/address/postcode/NR46LL/") return json({ postcode: "NR4 6LL", count: 2, addresses: [
      { uprn: 100090887383, address: "75 BARNESDALE ROAD, NORWICH, NR4 6LL", building_name: "", building_number: "75", sub_building: "", street: "Barnesdale Road", town: "Norwich" },
      { uprn: 100090887399, address: "FLAT 2, THE MALTINGS, NORWICH, NR4 6LL", building_name: "THE MALTINGS", building_number: "", sub_building: "FLAT 2", street: "", town: "Norwich" }] });
    if (url.pathname === "/address/find/") return json({ suggestions: [{ uprn: 2630185115, address: "75 Colney Lane", postcode: "NR4 7RQ", town: "Cringleford" }], count: 1 });
    if (url.pathname === "/calculators/mortgage/") return json({ loan_amount: 270000, deposit: 30000, property_price: 300000, annual_rate_pct: 4.5, term_years: 25, monthly_payment: 1500.75, total_interest: 180224.31, ltv_pct: 90 });
    if (url.pathname.startsWith("/council_tax_band/")) return json({ council_tax_band: "B", authority_name: "Norwich" });
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

test("insurance and trade products are never offered or quoted", async () => {
  const found = resolveProduct(PRODUCTS, "home insurance");
  assert.deepEqual(found.candidates.map((p) => p.name), ["Insurance Reinstatement Survey"], "a reinstatement survey is a survey; insurance itself is not quoted here");
  assert.equal(resolveProduct(PRODUCTS, "1091").product, undefined, "not even by id");
  assert.equal(resolveProduct(PRODUCTS, "b2b subscription").product, undefined);
  assert.equal(resolveProduct(PRODUCTS, "1130").product, undefined);
  const server = buildHomemoveServer({ motus: fakeMotus(), property: fakeHomedata(), assetOrigin: "https://mcp.homemove.com" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "t", version: "1" });
  await Promise.all([server.connect(b), client.connect(a)]);
  const listed = await client.callTool({ name: "homemove_services", arguments: {} });
  const names = ((listed.structuredContent as { services: Array<{ name: string }> }).services).map((s) => s.name);
  assert.ok(names.includes("Insurance Reinstatement Survey"));
  assert.ok(!names.some((n) => /buildings insurance|b2b|subscription/i.test(n)), names.join(", "));
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
  assert.deepEqual(lost, { status: "address_not_found", reason: "no_match", postcode: "SW1A 2AA", product: { id: 1081, name: "EPC Assessment", type: "surveys" }, said: "1 Nowhere Lane" }, "the card can open the postcode's addresses for this product");
});

test("ChatGPT sees two no-sign-in tools, the quote card template, and a widget that loads from this origin", async () => {
  const server = buildHomemoveServer({ motus: fakeMotus(), property: fakeHomedata(), assetOrigin: "https://mcp.homemove.com" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "t", version: "1" });
  await Promise.all([server.connect(b), client.connect(a)]);
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name), ["homemove_quote", "homemove_services", "homemove_moving_checklist", "homemove_find_address"]);
  assert.deepEqual(tools[3]!._meta?.["ui"], { visibility: ["app"] }, "the address finder is the card's, not the model's");
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
  assert.deepEqual(first.status === "needs_answers" && first.questions.map((q) => q.name), ["transaction", "address"], "the home next, as the homemove.com legal form asks");
  const skipped = await quote({ service: "conveyancing buying", postcode: "SW1A 2AA", answers: { address: "skip" } }, deps);
  assert.deepEqual(skipped.status === "needs_answers" && skipped.questions.map((q) => q.name), ["property_price", "tenure", "funding_type"], "no home yet: ask what the records would have said");
  const picked = await quote({ service: "conveyancing buying", postcode: "NR4 6LL", address: "75 Barnesdale Road", uprn: "100090887383" }, deps);
  assert.deepEqual(picked.status === "needs_answers" && picked.questions.map((q) => q.name), ["funding_type"], "tenure from the title, value from the estimate: only the mortgage is left");

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

test("a client that accepts only JSON gets the tool list, not 406 (seen from ChatGPT desktop)", async () => {
  const { createServer } = await import("node:http");
  const handler = createHomemoveHttpHandler({ motus: fakeMotus(), property: fakeHomedata(), assetOrigin: "https://mcp.homemove.com" });
  const server = createServer((req, res) => void handler(req, res));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  try {
    for (const accept of ["application/json", "application/json, text/event-stream", "*/*"]) {
      const res = await fetch(`http://127.0.0.1:${port}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }) });
      assert.equal(res.status, 200, accept);
      assert.ok(((await res.json()) as { result: { tools: unknown[] } }).result.tools.length >= 2, accept);
    }
  } finally { server.close(); }
});

test("a whole-move handoff says which home each service is for", async () => {
  const plan = await planMove({ situation: "buying_and_selling", from_postcode: "M1 1AE", to_postcode: "SW1A 2AA", to_address: "10 Downing Street", property_price: 350000, sale_price: 250000, mortgage: true, bedrooms: 2 },
    { motus: fakeMotus(), property: fakeHomedata(), homedata: fakeHomedataClient() });
  const url = new URL(continueUrlForPlan(plan, { from_postcode: "M1 1AE", to_postcode: "SW1A 2AA" }, "https://homemove.com/continue/"));
  const data = JSON.parse(Buffer.from(url.searchParams.get("d")!, "base64url").toString());
  assert.deepEqual(data.services.map((s: { name: string; for: string }) => [s.name, s.for]), [
    ["EPC Assessment", "property"], ["Conveyancing (selling)", "property"], ["Conveyancing (buying)", "to_property"],
    ["Level 2 Survey", "to_property"], ["Removals", "property"], ["End of Tenancy Clean", "property"]]);
  assert.equal(data.property.postcode.replace(/\s/g, ""), "M11AE");
  assert.equal(data.to_property.postcode, "SW1A 2AA");
});

test("removals questions carry the destination already given, so the card does not ask for it again", async () => {
  const ask = await quote({ service: "removals", postcode: "SW1A 2AA", to_postcode: "LS1 4AP" }, { motus: fakeMotus(), property: fakeHomedata() });
  assert.equal(ask.status, "needs_answers");
  assert.equal(ask.status === "needs_answers" && ask.to_postcode, "LS1 4AP");
  assert.deepEqual(ask.status === "needs_answers" && ask.questions.map((q) => q.name), ["home_size"]);
});

test("the bare origin sends people to homemove.com, not a JSON 404 (seen in ChatGPT on iPhone)", async () => {
  const handler = createHomemoveHttpHandler({ motus: fakeMotus(), property: fakeHomedata() });
  const req = Object.assign(Readable.from([]), { url: "/", method: "GET", headers: {}, socket: { remoteAddress: "127.0.0.1" } }) as unknown as IncomingMessage;
  let status = 0; const headers: Record<string, string> = {};
  const res = { headersSent: false, setHeader() {}, on() {}, writeHead(s: number, h?: Record<string, string>) { status = s; Object.assign(headers, h); return this; }, end() { return this; } } as unknown as ServerResponse;
  await handler(req, res);
  assert.equal(status, 302);
  assert.equal(headers["Location"], "https://homemove.com/");
});

async function homemoveClient(charged: string[] = [], sent: Sent[] = []) {
  const server = buildHomemoveServer({ motus: fakeMotus(sent), property: fakeHomedata(charged), assetOrigin: "https://mcp.homemove.com", handoffBase: "https://homemove.com/continue/" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "t", version: "1" });
  await Promise.all([server.connect(b), client.connect(a)]);
  return client;
}

test("asked with no postcode, a value-priced survey answers with its price from and every band, and tells ChatGPT not to quiz them", async () => {
  const sent: Sent[] = [];
  const client = await homemoveClient([], sent);
  const res = await client.callTool({ name: "homemove_quote", arguments: { service: "Level 2 survey" } });
  const out = res.structuredContent as Record<string, any>;
  assert.equal(res.isError, undefined);
  assert.equal(out["status"], "needs_answers");
  assert.equal(out["from_gbp"], 449);
  assert.deepEqual(out["bands"].map((b: any) => [b.label, b.price_gbp]), [["up to £300k", 449], ["£300k–£400k", 499], ["over £400k", 599]]);
  assert.equal(out["postcode"], "");
  assert.equal(sent.find((x) => x.url.endsWith("/quote"))!.body["postcode"], "NOT GIVEN", "motus records that none was given");
  const text = (res.content as Array<{ text: string }>)[0]!.text;
  assert.match(text, /from £449/);
  assert.match(text, /do not ask for the postcode or price/);
});

test("an address picked in the card is priced on its own value band without spending an address match", async () => {
  const charged: string[] = [];
  const client = await homemoveClient(charged);
  const res = await client.callTool({ name: "homemove_quote", arguments: { service: "2", postcode: "NR4 6LL", address: "75 Barnesdale Road", uprn: "100090887383" } });
  const out = res.structuredContent as Record<string, any>;
  assert.equal(out["status"], "priced");
  assert.equal(out["price_gbp"], 499, "Homedata's estimate (£350k) picks the £300k–£400k band");
  assert.deepEqual(out["property"], { address: "75 Barnesdale Road", postcode: "NR4 6LL", uprn: "100090887383" });
  assert.ok(!charged.some((c) => c.startsWith("/address/match/")), charged.join(" "));
  const handoff = JSON.parse(Buffer.from(new URL(out["continue_url"]).searchParams.get("d")!, "base64url").toString("utf8"));
  assert.equal(handoff.property.uprn, "100090887383", "homemove.com gets the exact home");
  assert.equal(handoff.property.address, "75 Barnesdale Road");
});

test("the card's address finder lists a postcode's homes, or searches an address", async () => {
  const client = await homemoveClient();
  const byPostcode = (await client.callTool({ name: "homemove_find_address", arguments: { query: "nr4 6ll" } })).structuredContent as { addresses: unknown[] };
  assert.deepEqual(byPostcode.addresses, [
    { uprn: "100090887383", line: "75 Barnesdale Road", town: "Norwich", postcode: "NR4 6LL" },
    { uprn: "100090887399", line: "Flat 2, The Maltings", town: "Norwich", postcode: "NR4 6LL" }]);
  const bySearch = (await client.callTool({ name: "homemove_find_address", arguments: { query: "75 colney" } })).structuredContent as { addresses: unknown[] };
  assert.deepEqual(bySearch.addresses, [{ uprn: "2630185115", line: "75 Colney Lane", town: "Cringleford", postcode: "NR4 7RQ" }]);
  const tooShort = (await client.callTool({ name: "homemove_find_address", arguments: { query: "nr" } })).structuredContent as { addresses: unknown[] };
  assert.deepEqual(tooShort.addresses, []);
});

test("broadband lists the comparison's deals in Mbps, sorted as asked, and opens a deal through the click endpoint as chatgpt", async () => {
  const calls: Array<{ url: string; body?: Record<string, unknown> }> = [];
  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}) });
    const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "Content-Type": "application/json" } });
    if (url.endsWith("/click")) return json({ status: "success", outlink: "https://www.awin1.com/cread.php?awinmid=1&clickref=abc" });
    return json({ status: "success", total: 3, products: [
      { id: 29, name: "Brilliant Broadband", network: { shortName: "NOW", logo: "https://cdn.homemove.com/images/broadband/providers/now.png" }, downloadSpeed: 11264, uploadSpeed: 1024, monthlyCost: 20, setupFee: 0, contractLength: 12, offerText: null, landLine: true, tv: false, features: ["Unlimited usage"], isAvailable: true },
      { id: 41, name: "Full Fibre 900", network: { shortName: "BT", logo: "https://evil.example/x.png" }, downloadSpeed: 921600, uploadSpeed: 112640, monthlyCost: 49.99, setupFee: 9.99, contractLength: 24, offerText: "Free router", isAvailable: true },
      { id: 50, name: "Gone", network: { shortName: "X" }, downloadSpeed: 1024, monthlyCost: 5, isAvailable: false },
    ] });
  }) as typeof fetch;
  const server = buildHomemoveServer({ motus: fakeMotus(), property: fakeHomedata(), assetOrigin: "https://mcp.homemove.com", broadband: new BroadbandClient({ baseUrl: "https://motus.test/api/broadband", fetchImpl }) });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "t", version: "1" });
  await Promise.all([server.connect(b), client.connect(a)]);
  const cheap = (await client.callTool({ name: "homemove_broadband", arguments: { postcode: "nr4 6ll" } })).structuredContent as Record<string, any>;
  assert.deepEqual(cheap["deals"].map((d: any) => [d.provider, d.download_mbps, d.monthly_gbp]), [["NOW", 11, 20], ["BT", 900, 49.99]], "unavailable deals are dropped; Kbps become Mbps");
  assert.equal(cheap["deals"][1].logo, null, "a logo is only ever loaded from homemove.com's CDN");
  assert.equal(cheap["continue_url"], "https://homemove.com/broadband/compare/NR46LL?utm_source=chatgpt-plugin&utm_medium=referral&utm_campaign=homemove-chatgpt-app&utm_content=broadband");
  const fast = (await client.callTool({ name: "homemove_broadband", arguments: { postcode: "NR4 6LL", sort: "speed", min_mbps: 100 } })).structuredContent as Record<string, any>;
  assert.deepEqual(fast["deals"].map((d: any) => d.id), [41]);
  assert.equal(calls.filter((c) => c.url.includes("/search?")).length, 1, "the postcode's deals are fetched once");
  const link = (await client.callTool({ name: "homemove_broadband_link", arguments: { deal_id: 41, postcode: "NR4 6LL" } })).structuredContent as Record<string, any>;
  assert.equal(link["url"], "https://www.awin1.com/cread.php?awinmid=1&clickref=abc");
  assert.equal(calls.at(-1)!.body!["source"], "chatgpt-plugin");
  const { tools } = await client.listTools();
  assert.deepEqual(tools.find((t) => t.name === "homemove_broadband_link")!._meta?.["ui"], { visibility: ["app"] });
});

test("without the broadband comparison configured, no broadband tool is listed", async () => {
  const client = await homemoveClient();
  const { tools } = await client.listTools();
  assert.ok(!tools.some((t) => t.name.startsWith("homemove_broadband")));
});

test("a clean priced on bedrooms from the record carries the bedroom choices, so the card can offer a correction", async () => {
  const deps = { motus: fakeMotus(), property: fakeHomedata() };
  const answer = await quote({ service: "end of tenancy clean", postcode: "NR4 6LL", address: "75 Barnesdale Road", uprn: "100090887383" }, deps);
  assert.equal(answer.status, "priced");
  const priced = answer as Extract<typeof answer, { status: "priced" }>;
  assert.equal(priced.assumed[0]!.name, "beds", "bedrooms came from the record");
  assert.deepEqual(priced.beds_options, BEDS.map((o) => o.label));
  const said = await quote({ service: "end of tenancy clean", postcode: "NR4 6LL", bedrooms: 2 }, deps);
  assert.equal((said as { beds_options?: unknown }).beds_options, undefined, "stated bedrooms need no correction");
});

test("insurance, mortgages and estate agents are a way into homemove.com, never a price or advice here", async () => {
  const deps = { motus: fakeMotus(), property: fakeHomedata() };
  const door = (service: string) => quote({ service, postcode: "NR4 6LL" }, deps);
  const insurance = await door("home insurance");
  assert.deepEqual(insurance, { status: "front_door", door: "home_insurance", name: "Home insurance", line: "Buildings, contents or both, quoted on homemove.com by Homemove's insurance partner.", postcode: "NR4 6LL", url: "https://homemove.com/quote/home-insurance/" });
  assert.match(quoteNarration({ ...insurance, continue_url: "x" } as never), /Do not quote, compare or recommend insurance/);
  assert.equal((await door("contents insurance")).status, "front_door");
  assert.equal(((await door("remortgage")) as { door?: string }).door, "mortgage");
  assert.equal(((await door("estate agent to sell my house")) as { url?: string }).url, "https://homemove.com/estate-agents/search/NR46LL/");
  assert.notEqual((await door("insurance reinstatement survey")).status, "front_door", "a reinstatement survey is a survey");
  assert.notEqual((await quote({ service: "conveyancing buying with a mortgage", postcode: "NR4 6LL" }, deps)).status, "front_door", "conveyancing is priced, mortgage or not");
});

test("the moving checklist is dated back from the move, marks what Homemove prices, and a landlord's is the letting duties", async () => {
  const client = await homemoveClient();
  const res = await client.callTool({ name: "homemove_moving_checklist", arguments: { situation: "buying", move_date: "2026-12-18" } });
  const out = res.structuredContent as { stages: Array<{ when: string; date?: string; items: Array<{ task: string; service?: string }> }> };
  assert.equal(out.stages[0]!.items[0]!.task, "Instruct a conveyancer");
  assert.equal(out.stages.find((s) => s.when === "4 weeks before")!.date, "2026-11-20");
  assert.ok(out.stages.flatMap((s) => s.items).some((i) => i.task === "Update the DVLA"));
  assert.match((res.content as Array<{ text: string }>)[0]!.text, /Homemove can price .*removals.*broadband/);
  const landlord = (await client.callTool({ name: "homemove_moving_checklist", arguments: { situation: "landlord" } })).structuredContent as typeof out;
  assert.deepEqual(landlord.stages.map((s) => s.when), ["Before the tenants move in"]);
});

test("mortgage repayments are sums, and the council tax band comes from the matched home", async () => {
  const server = buildHomemoveServer({ motus: fakeMotus(), property: fakeHomedata(), assetOrigin: "https://mcp.homemove.com", homedata: fakeHomedataClient() });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "t", version: "1" });
  await Promise.all([server.connect(b), client.connect(a)]);
  const m = await client.callTool({ name: "homemove_mortgage_repayments", arguments: { price: 300000, deposit: 30000, rate: 4.5, term: 25 } });
  assert.match((m.content as Array<{ text: string }>)[0]!.text, /about £1,500.75 a month.*not advice/);
  const bad = await client.callTool({ name: "homemove_mortgage_repayments", arguments: { price: 300000, deposit: 300000, rate: 4.5, term: 25 } });
  assert.equal(bad.isError, true, "a deposit as big as the price is not a mortgage");
  const ct = await client.callTool({ name: "homemove_council_tax", arguments: { postcode: "SW1A 2AA", address: "10 Downing Street" } });
  assert.equal((ct.structuredContent as { council_tax_band?: string }).council_tax_band, "B");
  assert.match((ct.content as Array<{ text: string }>)[0]!.text, /paid to the council, not Homemove/);
});

test("every homemove.com link says it came from the ChatGPT app; other sites and existing UTMs are left alone", async () => {
  assert.equal(tagged("https://homemove.com/quote/surveys/rics-level-2?pc=NR46LL", "Level 2 Survey"),
    "https://homemove.com/quote/surveys/rics-level-2?pc=NR46LL&utm_source=chatgpt-plugin&utm_medium=referral&utm_campaign=homemove-chatgpt-app&utm_content=level-2-survey");
  assert.equal(tagged("https://www.awin1.com/cread.php?x=1"), "https://www.awin1.com/cread.php?x=1");
  assert.equal(tagged("https://homemove.com/?utm_source=x"), "https://homemove.com/?utm_source=x");
  const client = await homemoveClient();
  const out = (await client.callTool({ name: "homemove_quote", arguments: { service: "home insurance" } })).structuredContent as Record<string, string>;
  assert.equal(new URL(out["continue_url"]!).searchParams.get("utm_source"), "chatgpt-plugin");
  const l2 = (await client.callTool({ name: "homemove_quote", arguments: { service: "Level 2 survey", postcode: "NR4 6LL", property_price: 350000 } })).structuredContent as Record<string, string>;
  assert.equal(new URL(l2["continue_url"]!).searchParams.get("utm_content"), "level-2-survey");
  assert.equal(new URL(l2["booking_url"]!).searchParams.get("utm_source"), "chatgpt-plugin");
});

test("activity: one line per Homemove call with the service and price at area level, never the street or the subject", async () => {
  const events: Array<{ organisation: string; tool: string; outcome: string; detail?: string }> = [];
  const handler = createHomemoveHttpHandler({ motus: fakeMotus(), property: fakeHomedata(), callsPerMinute: 2, activity: (e) => events.push(e), visitors: new HomeVisitors(undefined, () => Date.parse("2026-10-21T12:00:00Z")) });
  const http = (await import("node:http")).createServer((req, res) => void handler(req, res));
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const port = (http.address() as { port: number }).port;
  const post = async (args: Record<string, unknown>, subject: string) => {
    await fetch(`http://127.0.0.1:${port}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "homemove_quote", arguments: args, _meta: { "openai/subject": subject } } }) }).then((r) => r.text());
  };
  try {
  await post({ service: "Level 2 survey", postcode: "NR4 6LL", address: "75 Barnesdale Road", uprn: "100090887383" }, "user-a");
  await post({ service: "home insurance" }, "user-a");
  await post({ service: "EPC", postcode: "SW1A 2AA" }, "user-a");
  assert.equal(events.length, 3);
  assert.match(events[0]!.organisation, /^Homemove · visitor [0-9a-f]{6} \(new · 1 today · 1 ever\)$/);
  assert.equal(events[0]!.outcome, "ok");
  assert.equal(events[0]!.detail, "Level 2 Survey, priced £499 (from records), home picked, NR4");
  assert.equal(events[1]!.detail, "front door: Home insurance");
  assert.equal(events[2]!.outcome, "rate limited");
  for (const e of events) assert.doesNotMatch(JSON.stringify(e), /Barnesdale|6LL|user-a|100090887383/);
  } finally { http.closeAllConnections(); await new Promise((resolve) => http.close(resolve)); }
});
