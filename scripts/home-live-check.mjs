#!/usr/bin/env node
// Calls the seller and renter tools against live home.co.uk and checks each answer
// has real local data. No Homedata key is needed: these tools read home.co.uk only.
import { HomedataClient } from '../dist/client.js';
import { HomeClient } from '../dist/home/client.js';

const client = new HomeClient({ homeBaseUrl: process.argv[2] || undefined, homedata: new HomedataClient({ apiKey: 'unused' }), logger: (message, detail) => console.error(`     ${message} (HTTP ${detail?.statusCode ?? '?'})`) });
const checks = [
  ['sold_prices BA2 3PL', () => client.soldPrices({ postcode: 'BA2 3PL' }), (r) => r.total > 0 && r.sales.length > 0 && r.sales.every((s) => s.price > 0 && s.sold_date)],
  ['find_agents Bath sales', () => client.agents('Bath', 'sales', 5), (r) => r.agents.length > 0 && r.agents.every((a, i, all) => i === 0 || all[i - 1].homes_for_sale_here >= a.homes_for_sale_here)],
  // London's directory spans many pages in partner-first order; the busiest agent is not on page 1.
  ['find_agents London sales ranks the whole area', () => client.agents('London', 'sales', 3), (r) => r.agents_with_listings > 120 && r.agents.every((a, i, all) => i === 0 || all[i - 1].homes_for_sale_here >= a.homes_for_sale_here)],
  ['find_agents BA1 lettings', () => client.agents('BA1', 'lettings', 5), (r) => r.agents.length > 0 && r.agents[0].homes_to_let_here > 0],
  ['typical_rents BA1', () => client.rents('BA1'), (r) => r.frequency === 'pcm' && r.summary?.median_rent > 0],
];
let failed = 0;
for (const [name, run, ok] of checks) {
  try {
    const result = await run();
    if (ok(result)) console.log(`ok   ${name}`);
    else { failed++; console.log(`FAIL ${name}: unexpected answer ${JSON.stringify(result).slice(0, 300)}`); }
  } catch (error) { failed++; console.log(`FAIL ${name}: ${error.message}`); }
}
console.log(failed ? `${failed} live check(s) failed` : 'Home live checks hold');
process.exit(failed ? 1 : 0);
