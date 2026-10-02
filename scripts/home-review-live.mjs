#!/usr/bin/env node
/**
 * Run the Home review packet's positive cases against a live endpoint:
 *
 *   node scripts/home-review-live.mjs https://mcp.home.co.uk/mcp
 *
 * Each case's expected calls run in order. A call that needs listing IDs and
 * names none takes them from the case's own search_homes result, the way the
 * model would: get_home the first, compare_homes the first three, plan_viewings
 * the first four, commute_filter the homes just compared (or the whole page),
 * and render_home_listings the search's homes. Prints what came back so the outcome text can be
 * checked against it, and fails on any tool error, an empty search, a search
 * result outside the requested filters, or a calculator without figures. It
 * cannot judge the model's answer; run the golden set in developer mode for
 * that. Negative cases expect no call, so there is nothing to run for them.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const url = process.argv[2];
if (!url) { console.error('usage: node scripts/home-review-live.mjs <Home MCP endpoint URL>'); process.exit(2); }

let id = 0;
async function call(name, args) {
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } }) });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.result) throw new Error(`${name}: HTTP ${response.status} ${JSON.stringify(body?.error ?? body).slice(0, 200)}`);
  if (body.result.isError) throw new Error(`${name}: ${JSON.stringify(body.result.structuredContent).slice(0, 200)}`);
  return body.result.structuredContent;
}

function checkSearch(args, result) {
  const homes = result.homes ?? [];
  if (!homes.length) return ['search returned no homes'];
  const problems = [];
  for (const h of homes) {
    if (args.min_beds !== undefined && h.bedrooms !== null && h.bedrooms < args.min_beds) problems.push(`${h.id} has ${h.bedrooms} bedrooms`);
    if (args.max_beds !== undefined && h.bedrooms !== null && h.bedrooms > args.max_beds) problems.push(`${h.id} has ${h.bedrooms} bedrooms`);
    if (args.max_price !== undefined && h.price > args.max_price) problems.push(`${h.id} is ${h.price}`);
    if (args.new_build && h.new_build !== true) problems.push(`${h.id} is not a new build`);
    if (!String(h.url).startsWith('https://home.co.uk/property/')) problems.push(`${h.id} has no home.co.uk link`);
    for (const m of h.wishes_matched ?? []) if (!m.evidence) problems.push(`${h.id} matches ${m.wish} with no listing words`);
  }
  if (args.sort === 'price_asc' && homes.some((h, i) => i && h.price < homes[i - 1].price)) problems.push('not in rising price order');
  return problems;
}

const set = JSON.parse(readFileSync(join(root, 'docs/home-chatgpt-app/golden-prompts.json'), 'utf8'));
let failed = 0;
for (const c of set.cases.filter((c) => c.review && c.kind !== 'negative')) {
  const problems = [];
  let lastSearch = null;
  let compared = null;
  console.log(`\n${c.id}: ${c.prompt}`);
  try {
    for (const expected of c.expect.calls) {
      const args = { ...expected.args };
      const ids = (lastSearch?.homes ?? []).map((h) => h.id);
      if (expected.tool === 'get_home' && !args.listing_id) args.listing_id = ids[0];
      if (expected.tool === 'compare_homes' && !args.listing_ids) args.listing_ids = compared = ids.slice(0, 3);
      if (expected.tool === 'plan_viewings' && !args.listing_ids) args.listing_ids = ids.slice(0, 4);
      if (expected.tool === 'commute_filter' && !args.listing_ids) args.listing_ids = compared ?? ids.slice(0, 20);
      if (expected.tool === 'render_home_listings' && !args.homes) args.homes = (lastSearch?.homes ?? []).slice(0, 20);
      const result = await call(expected.tool, args);
      if (expected.tool === 'search_homes') {
        lastSearch = result;
        problems.push(...checkSearch(args, result));
        if (args.wishes) console.log(`  wishes ${args.wishes.join(', ')}: ${result.homes_matching_every_wish} on the first page state every one`);
        console.log(`  search_homes: ${result.total} found; first ${(result.homes ?? []).slice(0, 3).map((h) => `${h.price} ${h.bedrooms}bd ${h.address}`).join(' | ')}`);
      } else if (expected.tool === 'get_home') {
        console.log(`  get_home: ${result.address}, ${result.tenure}, ${result.construction_age_band}, ${Math.round(result.days_listed ?? 0)} days listed, ${result.photos?.length} photos, enrichment ${result.enrichment?.available ? 'available' : `unavailable (${result.enrichment?.reason})`}`);
        if (!result.photos?.length) problems.push('get_home returned no photos');
      } else if (expected.tool === 'compare_homes') {
        console.log(`  compare_homes: ${(result.homes ?? []).map((h) => `${h.price} ${h.property_type} ${h.photos?.length} photos`).join(' | ')}`);
        if ((result.homes ?? []).length !== args.listing_ids.length) problems.push('compare_homes did not return every home');
      } else if (expected.tool === 'commute_filter') {
        console.log(`  commute_filter: ${result.summary} inside: ${(result.homes_inside ?? []).map((h) => `${h.address}${h.near_edge ? ' (near edge)' : ''}`).join(' | ') || 'none'}`);
        if (!result.place?.name) problems.push('commute_filter measured from no place');
        if ((result.homes_inside ?? []).length + (result.homes_outside ?? []).length !== args.listing_ids.length) problems.push('commute_filter did not place every home');
      } else if (expected.tool === 'plan_viewings') {
        console.log(`  plan_viewings: from ${result.start?.name ?? 'the best home'}, ${(result.stops ?? []).map((s) => `${s.stop}. ${s.address} +${s.drive_from_previous_minutes} min`).join(' | ')}; ${result.total_driving_minutes} min in all`);
        if ((result.stops ?? []).length !== args.listing_ids.length) problems.push('plan_viewings did not order every home');
        if (typeof result.total_driving_minutes !== 'number') problems.push('no total driving time');
      } else if (expected.tool === 'render_home_listings') {
        console.log(`  render_home_listings: ${result.view}, ${(result.homes ?? []).length} homes`);
        if (result.view !== 'listings' || !(result.homes ?? []).length) problems.push('render_home_listings drew no homes');
      } else {
        console.log(`  ${expected.tool}: ${JSON.stringify(result).slice(0, 240)}`);
        if (expected.tool === 'calculate_stamp_duty' && typeof result.total_tax !== 'number') problems.push('no stamp duty figure');
        if (expected.tool === 'calculate_mortgage' && typeof result.monthly_payment !== 'number') problems.push('no monthly payment');
        if (expected.tool === 'area_insights' && Object.values(result).some((v) => v?.unavailable)) problems.push('an area section is unavailable');
      }
    }
  } catch (error) { problems.push(error.message); }
  for (const p of problems) console.log(`  PROBLEM ${p}`);
  if (problems.length) failed++;
}
console.log(failed ? `\n${failed} review case(s) failed live` : '\nevery positive review case ran live');
process.exit(failed ? 1 : 0);
