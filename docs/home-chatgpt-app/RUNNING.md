# Home ChatGPT app endpoint

Home is a separate, public, read-only MCP surface. It reuses this repository's stateless Streamable HTTP pattern but does not change the `homedata-mcp` command or published npm package.

## Run locally

```sh
npm ci
npm run build
HOMEDATA_API_KEY=... HOME_MCP_PATH=/mcp PORT=4177 npm run home:http
```

The Homedata key is held only by the server and enriches listing details. ChatGPT and other callers use every Home tool without authentication. `HOME_BASE_URL` and `HOMEDATA_BASE_URL` exist for staging and tests; production should leave both unset.

`MCP_CALLS_PER_MINUTE` defaults to 30 per caller. `HOME_ENRICHMENTS_PER_MINUTE` separately defaults to four homes per caller because those lookups use the server-held Homedata key; a four-home comparison consumes all four units. A home with a UPRN uses one Homedata request, an exact address match uses two, and the postcode fallback uses five (or six after an unsuccessful address match). The default therefore caps the worst case at 24 Homedata requests per caller per minute. Coordinate-to-postcode recovery uses Home's reverse-geocode endpoint and does not use the Homedata key. Set `HOME_CLIENT_IP_HEADER=cf-connecting-ip` only behind the trusted proxy configuration that removes caller-supplied copies of that header. Without it, limits use the direct socket address. Invalid limit values prevent startup rather than silently removing the cap.

The endpoint answers MCP at `HOME_MCP_PATH` and health checks at `/healthz`. Set `OPENAI_APPS_CHALLENGE` to the plugin portal's domain token to serve it at `/.well-known/openai-apps-challenge`; unset, that path answers 404. It is stateless: each POST creates a fresh MCP server and no search, shortlist or user preference is retained.

## Deploy

Home releases with the same `deploy/deploy.sh` as the Homedata endpoint; never keep an edited copy of it. Three settings choose the endpoint, and each defaults to the Homedata value:

| Setting | Home | Homedata default |
| --- | --- | --- |
| `DEPLOY_PROGRAM` (supervisor program) | `home-mcp` | `homedata-mcp` |
| `DEPLOY_ROOT` (releases, `current`, `repo`) | `/home/forge/mcp.home.co.uk` | `/home/forge/mcp.homedata.co.uk` |
| `DEPLOY_HEALTH` (checked after restart) | `http://127.0.0.1:4177/healthz` | `http://127.0.0.1:8191/healthz` |

As `forge` on the box, using the same copy of `deploy/deploy.sh` that releases Homedata:

```sh
DEPLOY_PROGRAM=home-mcp \
DEPLOY_ROOT=/home/forge/mcp.home.co.uk \
DEPLOY_HEALTH=http://127.0.0.1:4177/healthz \
  /home/forge/mcp.homedata.co.uk/deploy.sh origin/main
```

The script prints the program, folder and health URL it is using before it starts. Everything else is shared: a release goes live only after `npm test` passes and it is marked `.verified`, an unhealthy release is rolled back to the previous one, and the last three releases are kept.

The Home supervisor program must run `dist/home/http.js` from `/home/forge/mcp.home.co.uk/current` with `PORT=4177` (and `HOME_MCP_PATH=/mcp`), so its port matches `DEPLOY_HEALTH`. The restart runs `sudo -n /usr/bin/supervisorctl restart home-mcp`, so the box's sudo rule has to allow that program as well as `homedata-mcp`.

## Checks

`npm test` covers the endpoint, trimmed search cards, full-detail enrichment, metadata, the golden set and npm exclusion. Against a deployed endpoint, run:

```sh
node scripts/home-golden-check.mjs https://mcp.home.co.uk/mcp
node scripts/home-review-live.mjs https://mcp.home.co.uk/mcp
```

The second runs the review packet's positive cases live and prints what came back. It uses four enrichment units in one minute, the default cap, so wait a minute before running it twice.

To check the seller and renter tools against live home.co.uk data (no key needed), run `node scripts/home-live-check.mjs` after `npm run build`.

## Sellers and renters

These three tools read home.co.uk's JSON only. They do not use the Homedata key or the enrichment limit.

- `sold_prices` reads `/sold-properties/{slug}/` with `Accept: application/json`. A full postcode searches its sector (`ba1-1`). If the sector has fewer than ten sales, the tool widens to the district (`ba1`). An unknown slug redirects to the national page, and that page also answers JSON with the latest sales anywhere in the country. The tool rejects any answer with `isNationalSearch` set or no boundary id, so national sales are never reported as local.
- `find_agents` reads `/api/agents/search/{location}/{sales|lettings}?per_page=120` and ranks by each agent's in-area listing count. The directory is paginated in partner-first order: Founder and Homemover agents come first, and featured agents with no stock in the area are merged in. So the busiest agent can sit on any page; in London sales (1,845 agents) the top agent is on page 2. The tool ranks from `allPins`, which lists every agent in the area with its count in the first answer, and joins card details from the page. If `allPins` is missing or shorter than `total`, it reads every page (up to 40) before ranking. It drops agents with no listings in the area. Answers not in `property` search mode count each agent's whole stock, so the tool refuses them.
- `typical_rents` reads `/rental-prices/{postcode|location}/{code}/current` with `Accept: application/json`. That JSON edition was added in wehomemove/atlas#2540. Until that change is deployed the page is HTML, and the tool reports the data as unavailable.

Search reads home.co.uk's public JSON. Search responses deliberately omit HTML cards, boundaries, map pins and all other page payload. One-home and comparison responses first use `uprn` from property details when Home publishes it, then try an exact address match. Today Home does not yet populate that field, so exact matches receive `scope: "home"`; listings that cannot be matched receive `scope: "area"` with explicitly labelled postcode facts. When details omit a postcode, published coordinates are reverse-geocoded first. Only a listing with no usable UPRN, postcode or coordinates is reported as unavailable.
