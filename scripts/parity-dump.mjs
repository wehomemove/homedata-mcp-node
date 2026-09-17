#!/usr/bin/env node
/**
 * Dump what the parity guard judges: the Node server's tools/list, and the HTTP
 * request each tool sends when called with the guard's sample arguments.
 *
 *   node scripts/parity-dump.mjs <out dir>
 *
 * The guard itself lives in the Python package (python -m homedata_mcp.parity),
 * so one implementation judges both servers. Sample arguments mirror its
 * sample_arguments(); if they drift, the guard reports QUERY_VALUE_MISMATCH or
 * BINDING_NO_REQUEST rather than passing quietly.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { HomedataClient } from '../dist/client.js';
import { staticTools, tools } from '../dist/manifest.js';
import { buildServer } from '../dist/server.js';

const OUT = resolve(process.argv[2] ?? 'parity-out');
const SAMPLE_VALUES = {
    uprn: '100023336956', postcode: 'SW1A 2AA', outcode: 'SW1A', q: '10 Downing Street',
};

const sampleArguments = (spec) => Object.fromEntries(spec.params.map((param, index) => {
    if (param.enum) return [param.name, param.enum[0]];
    if (param.type === 'number') return [param.name, index + 2];
    if (param.pattern === '^\\d+$') return [param.name, SAMPLE_VALUES[param.name] ?? String(index + 2)];
    return [param.name, SAMPLE_VALUES[param.name] ?? `${param.name}-sample`];
}));

const sent = [];
const fetchImpl = async (input, init) => {
    const url = new URL(String(input));
    sent.push({
        method: init?.method ?? 'GET',
        // Decoded, because that is what the guard compares: the Python harness records
        // httpx's decoded request path. Both servers send the same percent-encoded path
        // on the wire, which src/test/server.test.ts asserts separately.
        path: decodeURIComponent(url.pathname),
        query: Object.fromEntries(url.searchParams.entries()),
    });
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};

const homedata = new HomedataClient({ apiKey: 'parity-test', fetchImpl });
const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
const client = new Client({ name: 'parity', version: '1' }, { capabilities: {} });
await Promise.all([buildServer(homedata).connect(serverSide), client.connect(clientSide)]);

const listed = (await client.listTools()).tools;
const recorded = {};
for (const spec of [...tools(), ...staticTools()]) {
    if (!listed.some((tool) => tool.name === spec.name)) continue;
    sent.length = 0;
    await client.callTool({ name: spec.name, arguments: sampleArguments(spec) });
    recorded[spec.name] = [...sent];
}
await client.close();

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'tools.json'), `${JSON.stringify(listed, null, 2)}\n`);
writeFileSync(join(OUT, 'requests.json'), `${JSON.stringify(recorded, null, 2)}\n`);
console.log(`wrote ${listed.length} tools and ${Object.keys(recorded).length} request sets to ${OUT}`);
