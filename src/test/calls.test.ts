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
  const request = buildRequest(spec("calc_mortgage"), { price: 300000, deposit: 30000, rate: 4.5, term_years: 25 });
  assert.deepEqual(request.query, { price: "300000", deposit: "30000", rate: "4.5", term_years: "25" });
});

test("property_custom sends with", () => {
  const request = buildRequest(spec("property_custom"), { uprn: "100023336956", with: "epc,council_tax" });
  assert.equal(request.path, "/property/100023336956/");
  assert.deepEqual(request.query, { with: "epc,council_tax" });
});

const INVALID: Array<[string, Record<string, unknown>, string]> = [
  ["property_core", {}, "uprn is required"],
  ["property_core", { uprn: "12a" }, "uprn must be digits only"],
  ["property_core", { uprn: 100023336956 }, "uprn must be a string"],
  ["property_core", { uprn: "1", extra: "x" }, "unknown argument extra"],
  ["risks", { risk_type: "volcano", uprn: "1" }, "risk_type must be one of"],
  ["calc_mortgage", { price: "lots", deposit: 1, rate: 1, term_years: 1 }, "price must be a number"],
  ["calc_mortgage", { price: true, deposit: 1, rate: 1, term_years: 1 }, "price must be a number"],
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
  assert.deepEqual(schema["required"], ["risk_type"]);
  assert.equal(schema["additionalProperties"], false);
  assert.ok(schema["properties"]["risk_type"]["enum"].includes("all"));
  assert.ok(schema["properties"]["uprn"]["description"]);
});
