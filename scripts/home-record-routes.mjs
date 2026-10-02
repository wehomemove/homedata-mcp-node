#!/usr/bin/env node
// Records live Mapbox and home.co.uk answers for the Bath commute and
// viewing-day scenarios into src/test/fixtures/home-routes.json, which the tests
// replay. Needs MAPBOX_PUBLIC_TOKEN; the token is stripped from every saved key.
// Re-run after changing a Mapbox request, then re-check the expected figures in
// src/test/home.test.ts against the new recording.
import { writeFileSync } from 'node:fs';
import { HomedataClient } from '../dist/client.js';
import { HomeClient } from '../dist/home/client.js';
import { MapboxRoutes } from '../dist/home/routes.js';
import { BATH_ROUTE_SCENARIOS, routeFixtureKey } from '../dist/test/home-routes-fixture.js';

const token = (process.env.MAPBOX_PUBLIC_TOKEN ?? '').trim();
if (!token.startsWith('pk.')) { console.error('set MAPBOX_PUBLIC_TOKEN to the Home pk. token'); process.exit(2); }
const recorded = {};
const DETAIL_FIELDS = ['id', 'latitude', 'longitude', 'postcode', 'building_name', 'building_number', 'street_name', 'locality', 'town_name'];
const recording = async (input, init) => {
  const response = await fetch(input, init);
  const raw = await response.text();
  let body = JSON.parse(raw);
  const url = new URL(String(input));
  // Only the fields the route tools read: no descriptions, photos or agents.
  if (url.pathname.startsWith('/api/property-details/')) body = Object.fromEntries(DETAIL_FIELDS.map((k) => [k, body[k] ?? null]));
  recorded[routeFixtureKey(url)] = { status: response.status, body };
  return new Response(JSON.stringify(body), { status: response.status, headers: { 'Content-Type': 'application/json' } });
};
const client = new HomeClient({ homedata: new HomedataClient({ apiKey: 'unused' }), fetchImpl: recording, listingViewSecret: process.env.HOME_MCP_LISTING_VIEW_SECRET });
const routes = new MapboxRoutes({ token, fetchImpl: recording, referer: 'https://mcp.home.co.uk/' });
for (const scenario of BATH_ROUTE_SCENARIOS) {
  const answer = scenario.tool === 'commute_filter' ? await routes.commute(client, scenario.args) : await routes.viewings(client, scenario.args);
  console.log(`${scenario.id}: ${answer.summary ?? (answer.reachable_area ? "area only" : `${answer.stops.map((s) => s.listing_id.slice(0, 8)).join(' → ')}, ${answer.total_driving_minutes} min`)}`);
}
const out = new URL('../src/test/fixtures/home-routes.json', import.meta.url);
writeFileSync(out, JSON.stringify({ recorded_at: new Date().toISOString().slice(0, 10), responses: recorded }, null, 1) + '\n');
console.log(`recorded ${Object.keys(recorded).length} answers to ${out.pathname}`);
