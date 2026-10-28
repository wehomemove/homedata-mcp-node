import assert from "node:assert/strict";
import { test } from "node:test";

import { buildRequest, InvalidArguments, inputSchema } from "../calls.js";
import { paramTextFor, tools, type ToolSpec } from "../manifest.js";

const spec = (name: string): ToolSpec => {
  const found = tools().find((t) => t.name === name);
  assert.ok(found, name);
  return found;
};

test("path parameters are substituted and encoded", () => {
  const request = buildRequest(spec("address_postcode"), { postcode: "SW1A 2AA" });
  assert.deepEqual(request, { method: "GET", path: "/address/postcode/SW1A%202AA/", query: {} });
});

test("query parameters are sent by their manifest names", () => {
  const request = buildRequest(spec("risks"), { risk_type: "all", uprn: "100023336956" });
  assert.equal(request.path, "/risks/all/");
  assert.deepEqual(request.query, { uprn: "100023336956" });
});

test("optional parameters left out are not sent", () => {
  assert.deepEqual(buildRequest(spec("planning"), { postcode: "SW1A 2AA" }).query, { postcode: "SW1A 2AA" });
});

test("whole numbers are sent without a decimal point", () => {
  const request = buildRequest(spec("calc_mortgage"), { price: 300000, deposit: 30000, rate: 4.5, term: 25 });
  assert.deepEqual(request.query, { price: "300000", deposit: "30000", rate: "4.5", term: "25" });
});

test("property_custom sends with", () => {
  const request = buildRequest(spec("property_custom"), { uprn: "100023336956", with: "epc,council_tax" });
  assert.equal(request.path, "/property/100023336956/");
  assert.deepEqual(request.query, { with: "epc,council_tax" });
});

const INVALID: Array<[string, Record<string, unknown>, string]> = [
  ["property_core", {}, "uprn is required"],
  ["property_core", { uprn: "12a" }, "uprn must be digits only"],
  ["property_core", { uprn: "1", extra: "x" }, "unknown argument extra"],
  ["risks", { risk_type: "volcano", uprn: "1" }, "risk_type must be one of"],
  ["calc_mortgage", { price: "lots", deposit: 1, rate: 1, term: 1 }, "price must be a number"],
  ["calc_mortgage", { price: true, deposit: 1, rate: 1, term: 1 }, "price must be a number"],
];

for (const [name, args, problem] of INVALID) {
  test(`invalid arguments are refused: ${name} ${JSON.stringify(args)}`, () => {
    assert.throws(
      () => buildRequest(spec(name), args),
      (err: unknown) => err instanceof InvalidArguments && err.problems.some((p) => p.includes(problem)),
    );
  });
}

test("a path rule routes a prefixed value", () => {
  const ruleSpec = {
    name: "risks", playground_id: "risks", label: "Risks", method: "GET", path: "/risks/{risk_type}/",
    params: [{ name: "risk_type", in: "path", type: "string", required: true, enum: ["all", "flood:zones"] }],
    path_rules: [{ param: "risk_type", prefix: "flood:", path: "/risks/flood/{suffix}/" }],
    tokens: { default: 1 },
  } as unknown as ToolSpec;
  assert.equal(buildRequest(ruleSpec, { risk_type: "flood:zones" }).path, "/risks/flood/zones/");
  assert.equal(buildRequest(ruleSpec, { risk_type: "all" }).path, "/risks/all/");
});

test("input schema matches the manifest", () => {
  const schema = inputSchema(spec("risks"), paramTextFor("risks")) as Record<string, any>;
  // Spelled out rather than read back from the manifest: this test exists to catch
  // inputSchema silently dropping or inventing a required key, and a value derived
  // from the same manifest it is checking would agree with any of those. The cost
  // is that the list moves when the catalogue does — uprn became required when
  // risks stopped offering lat/lng, and this line had to move with it.
  assert.deepEqual(schema["required"], ["risk_type", "uprn"]);
  assert.equal(schema["additionalProperties"], false);
  assert.ok(schema["properties"]["risk_type"]["enum"].includes("all"));
  assert.ok(schema["properties"]["uprn"]["description"]);
});

test("non-finite numbers are refused before they reach a URL", () => {
  for (const price of [Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(
      () => buildRequest(spec("calc_mortgage"), { price, deposit: 1, rate: 1, term: 1 }),
      (err: unknown) => err instanceof InvalidArguments && err.problems.some((p) => p.includes("finite")),
    );
  }
});

test("paired parameters must be given together", () => {
  // The manifest pairs lng with lat; one without the other is an incomplete request.
  assert.throws(
    () => buildRequest(spec("planning"), { lat: "51.5" }),
    (err: unknown) => err instanceof InvalidArguments && err.problems.some((p) => p.includes("must be given together")),
  );
  assert.doesNotThrow(() => buildRequest(spec("planning"), { lat: "51.5", lng: "-0.1" }));
});

test("one of an alternative group is required", () => {
  assert.throws(
    () => buildRequest(spec("crime"), {}),
    (err: unknown) => err instanceof InvalidArguments && err.problems.some((p) => p.includes("one of postcode or lat")),
  );
  assert.doesNotThrow(() => buildRequest(spec("crime"), { postcode: "SW1A 2AA" }));
});

test("listing address sends JSON with a fresh idempotency key per request", () => {
  const first = buildRequest(spec("listing_address"), { listing_id: "listing-uuid" });
  const second = buildRequest(spec("listing_address"), { listing_id: "listing-uuid" });
  assert.equal(first.method, "POST");
  assert.deepEqual(first.query, {});
  assert.deepEqual(first.body, { listing_id: "listing-uuid" });
  assert.match(first.headers?.["Idempotency-Key"] ?? "", /^[0-9a-f-]{36}$/);
  assert.notEqual(first.headers?.["Idempotency-Key"], second.headers?.["Idempotency-Key"]);
});

test("body values are sent as text, as the Python server sends them", () => {
  const request = buildRequest(spec("rental_appraisal"), { uprn: 100023336956, beds: 2, type: "flat", limit: 0 });
  assert.deepEqual(request.body, { uprn: "100023336956", beds: "2", type: "flat", limit: "0" });
  assert.equal(request.headers, undefined, "the manifest asks for no idempotency key here");
});

test("digit-only strings also accept whole non-negative numbers", () => {
  for (const uprn of [0, 100023336956, 1e21, "000123"]) {
    const expected = typeof uprn === "number" ? BigInt(uprn).toString() : uprn;
    assert.equal(buildRequest(spec("property_core"), { uprn }).path, `/property/${expected}/core/`);
    assert.deepEqual(buildRequest(spec("risks"), { uprn, risk_type: "all" }).query, { uprn: expected });
  }
  for (const uprn of [-1, 1.5, true, false, "-1", "1.5", "1e3", "abc", " 123", NaN, Infinity]) {
    assert.throws(() => buildRequest(spec("property_core"), { uprn }), InvalidArguments, String(uprn));
  }
  assert.throws(() => buildRequest(spec("address_postcode"), { postcode: 123 }), InvalidArguments);
});

test("every digit-only parameter advertises string or non-negative integer", () => {
  for (const tool of tools()) {
    const properties = inputSchema(tool, {}).properties as Record<string, Record<string, unknown>>;
    for (const param of tool.params) {
      if (param.type === "string" && param.pattern === "^\\d+$") {
        assert.deepEqual(properties[param.name]!.type, ["string", "integer"], tool.name);
        assert.equal(properties[param.name]!.minimum, 0);
        assert.equal(properties[param.name]!.pattern, "^\\d+$");
      } else assert.equal(properties[param.name]!.type, param.type);
    }
  }
});
