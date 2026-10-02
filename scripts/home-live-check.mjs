#!/usr/bin/env node
// Calls the wish searches and the seller and renter tools against live home.co.uk
// and checks each answer has real local data. No Homedata key is needed: these tools read home.co.uk only.
import { HomedataClient } from '../dist/client.js';
import { cleanListingDescription, HomeClient } from '../dist/home/client.js';

const client = new HomeClient({ homeBaseUrl: process.argv[2] || undefined, listingViewSecret: process.env.HOME_MCP_LISTING_VIEW_SECRET, homedata: new HomedataClient({ apiKey: 'unused' }), logger: (message, detail) => console.error(`     ${message} (HTTP ${detail?.statusCode ?? '?'})`) });
const base = (process.argv[2] || 'https://home.co.uk').replace(/\/+$/, '');
// A wish search must rank by wishes stated, and every piece of evidence must be
// in that listing's own description, read here separately from the tool.
async function wishesHold(result) {
  const counts = result.homes.map((home) => home.wishes_matched.length);
  if (!counts.length || counts.some((count, i) => i > 0 && counts[i - 1] < count)) return false;
  if (!result.homes.some((home) => home.wishes_not_stated.length === 0)) return false;
  for (const home of result.homes.filter((h) => h.wishes_matched.length && h.wishes_checked_in === 'full_description')) {
    const secret = process.env.HOME_MCP_LISTING_VIEW_SECRET;
    const response = await fetch(`${base}/api/property-details/${home.id}`, { headers: { Accept: 'application/json', ...(secret ? { 'X-Home-Listing-Secret': secret } : {}) } });
    const text = cleanListingDescription((await response.json()).description) ?? '';
    for (const match of home.wishes_matched) {
      if (!text.includes(match.evidence)) { console.log(`     ${home.id} ${match.wish}: "${match.evidence}" is not in its listing`); return false; }
    }
  }
  return true;
}
const checks = [
  ['search_homes Bath wishes garden, off-road parking, quiet street', () => client.search({ location: 'Bath', listing_type: 'sale', min_beds: 3, max_price: 600000, wishes: ['garden', 'off_road_parking', 'quiet_street'] }), wishesHold],
  ['search_homes Bristol wishes period features, no chain', () => client.search({ location: 'Bristol', listing_type: 'sale', wishes: ['period_features', 'no_chain'] }), wishesHold],
  ['search_homes Manchester rentals wishes open plan, off-road parking', () => client.search({ location: 'Manchester', listing_type: 'rent', wishes: ['open_plan', 'off_road_parking'] }), wishesHold],
  ['sold_prices BA2 3PL', () => client.soldPrices({ postcode: 'BA2 3PL' }), (r) => r.total > 0 && r.sales.length > 0 && r.sales.every((s) => s.price > 0 && s.sold_date)],
  ['find_agents Bath sales', () => client.agents('Bath', 'sales', 5), (r) => r.agents.length > 0 && r.agents.every((a, i, all) => i === 0 || all[i - 1].homes_for_sale_here >= a.homes_for_sale_here)],
  // London's directory spans many pages in partner-first order; the busiest agent is not on page 1.
  ['find_agents London sales ranks the whole area', () => client.agents('London', 'sales', 3), (r) => r.agents_with_listings > 120 && r.agents.every((a, i, all) => i === 0 || all[i - 1].homes_for_sale_here >= a.homes_for_sale_here)],
  ['find_agents BA1 lettings', () => client.agents('BA1', 'lettings', 5), (r) => r.agents.length > 0 && r.agents[0].homes_to_let_here > 0],
  ['typical_rents BA1', () => client.rents('BA1'), (r) => r.rent_period === 'per_calendar_month' && r.median_asking_rent_pcm_pounds > 0],
];
let failed = 0;
for (const [name, run, ok] of checks) {
  try {
    const result = await run();
    if (await ok(result)) console.log(`ok   ${name}`);
    else { failed++; console.log(`FAIL ${name}: unexpected answer ${JSON.stringify(result).slice(0, 300)}`); }
  } catch (error) { failed++; console.log(`FAIL ${name}: ${error.message}`); }
}
console.log(failed ? `${failed} live check(s) failed` : 'Home live checks hold');
process.exit(failed ? 1 : 0);
