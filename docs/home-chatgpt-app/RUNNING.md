# Home ChatGPT app endpoint

Home is a separate, public MCP surface: search and detail tools are read-only and need no sign-in; saved searches and price alerts need a home.co.uk sign-in. It reuses this repository's stateless Streamable HTTP pattern but does not change the `homedata-mcp` command or published npm package.

## Run locally

```sh
npm ci
npm run build
HOMEDATA_API_KEY=... MAPBOX_PUBLIC_TOKEN=... HOME_MCP_PATH=/mcp PORT=4177 npm run home:http
```

The Homedata key is held only by the server and enriches listing details. `HOME_MCP_LISTING_VIEW_SECRET` must match atlas's setting of the same name so property-detail requests use the trusted listing lane; it is a separate secret from `HOME_MCP_API_KEY`. ChatGPT and other callers use the search, detail, area and calculator tools without authentication; the account tools are described under [Saved searches and price alerts](#saved-searches-and-price-alerts). `HOME_BASE_URL` and `HOMEDATA_BASE_URL` exist for staging and tests; production should leave both unset.

`MAPBOX_PUBLIC_TOKEN` is a URL-restricted Mapbox `pk.` browser token. The
widget uses it for interactive light and dark maps. Never put a Mapbox `sk.`
secret token in this variable. When it is absent, the widget omits the map and
its Mapbox assets and CSP domains. Deployments that already put a `pk.` token
in the older `MAPBOX_SECRET_TOKEN` setting continue to work while they migrate;
an actual `sk.` token is never sent to the widget.

`MCP_CALLS_PER_MINUTE` defaults to 30 per caller. `HOME_ENRICHMENTS_PER_MINUTE` separately defaults to four homes per caller because those lookups use the server-held Homedata key; a four-home comparison consumes all four units. A home with a UPRN uses one Homedata request, an exact address match uses two, and the postcode fallback uses five (or six after an unsuccessful address match). The default therefore caps the worst case at 24 Homedata requests per caller per minute. Coordinate-to-postcode recovery uses Home's reverse-geocode endpoint and does not use the Homedata key. Set `HOME_CLIENT_IP_HEADER=cf-connecting-ip` only behind the trusted proxy configuration that removes caller-supplied copies of that header. Without it, limits use the direct socket address. Invalid limit values prevent startup rather than silently removing the cap.

Successful Homedata answers are cached in memory for 24 hours: each home's core lookup by UPRN (up to 2,000 homes), area facts by postcode (up to 2,000), and how each listing resolved to one of those, so a repeat view also skips the address match. A repeat view of a cached home spends no Homedata tokens and does not count towards `HOME_ENRICHMENTS_PER_MINUTE`. Failed or partly failed answers are never cached. The cache is per process and is emptied by a restart or deploy. `/healthz` reports `enrichment_cache.homes` and `enrichment_cache.areas`, each with `hits`, `misses` and `entries`, counted since the process started; a home hit is one 25-token core lookup saved.

The endpoint answers MCP at `HOME_MCP_PATH` and health checks at `/healthz`. Set `OPENAI_APPS_CHALLENGE` to the plugin portal's domain token to serve it at `/.well-known/openai-apps-challenge`; unset, that path answers 404. It is stateless: each POST creates a fresh MCP server and no search, shortlist or user preference is retained. Only the property and area enrichment cache described above outlives a request.

`4177` is the local default port. Production Home listens on `8192`.

## Deploy

Home releases with the same `deploy/deploy.sh` as the Homedata endpoint; never keep an edited copy of it. Three settings choose the endpoint, and each defaults to the Homedata value:

| Setting | Home | Homedata default |
| --- | --- | --- |
| `DEPLOY_PROGRAM` (supervisor program) | `home-mcp` | `homedata-mcp` |
| `DEPLOY_ROOT` (releases, `current`, `repo`) | `/home/forge/mcp.home.co.uk` | `/home/forge/mcp.homedata.co.uk` |
| `DEPLOY_HEALTH` (checked after restart) | `http://127.0.0.1:8192/healthz` | `http://127.0.0.1:8191/healthz` |

As `forge` on the box, using the same copy of `deploy/deploy.sh` that releases Homedata:

```sh
DEPLOY_PROGRAM=home-mcp \
DEPLOY_ROOT=/home/forge/mcp.home.co.uk \
DEPLOY_HEALTH=http://127.0.0.1:8192/healthz \
  /home/forge/mcp.homedata.co.uk/deploy.sh origin/main
```

The script prints the program, folder and health URL it is using before it starts. Everything else is shared: a release goes live only after `npm test` passes and it is marked `.verified`, an unhealthy release is rolled back to the previous one, and the last three releases are kept.

The Home supervisor program must run `dist/home/http.js` from `/home/forge/mcp.home.co.uk/current` with `PORT=8192` (and `HOME_MCP_PATH=/mcp`), so its port matches `DEPLOY_HEALTH`. The restart runs `sudo -n /usr/bin/supervisorctl restart home-mcp`, so the box's sudo rule has to allow that program as well as `homedata-mcp`.

## Checks

`npm test` covers the endpoint, trimmed search cards, full-detail enrichment, metadata, the golden set and npm exclusion. Against a deployed endpoint, run:

```sh
node scripts/home-golden-check.mjs https://mcp.home.co.uk/mcp
node scripts/home-review-live.mjs https://mcp.home.co.uk/mcp
```

The second runs the review packet's positive cases live and prints what came back. It uses four enrichment units in one minute, the default cap, so wait a minute before running it twice.

To check the wish searches and the seller and renter tools against live home.co.uk data (no key needed), run `node scripts/home-live-check.mjs` after `npm run build`. Each wish check reads every matched listing again on its own and fails if any quoted evidence is not in that listing's description.

## Searching by wishes

`search_homes` takes an optional `wishes` list: `garden`, `off_road_parking`, `quiet_street`, `period_features`, `open_plan`, `home_office`, `no_chain`. The search card carries only the first 150 characters of a description, so a wish search reads each home's full description from `/api/property-details/{id}` (five at a time, about 1.5 s for a page of 20). These reads go to home.co.uk, not Homedata, and use the trusted listing lane like `get_home`. Without `HOME_MCP_LISTING_VIEW_SECRET`, each read counts against atlas's daily per-address listing limit. Descriptions are kept in memory for an hour, so refining the wishes on the same page reads nothing again. A failed read is not kept.

The patterns in `src/home/wishes.ts` are deliberately narrow. A wish matches only when the listing states it. A negated mention ("no garden"), a possibility ("could be used as a home office", "potential for off-road parking"), a place name ("Sydney Gardens") and a nearby feature ("the surrounding grounds are Grade II listed") do not count. Each match carries its sentence, cut to about 120 characters, as an exact substring of the listing. A wish that is not matched is reported under `wishes_not_stated`: the listing does not mention it, which is not the same as the home lacking it. Homes are ranked by wishes stated on the page that was read. When more source pages exist, the answer gives `wishes_next_page`. If a listing cannot be read, it is checked against its card summary and marked `wishes_checked_in: "summary_only"`.

## Sellers and renters

These three tools read home.co.uk's JSON only. They do not use the Homedata key or the enrichment limit.

- `sold_prices` reads `/sold-properties/{slug}/` with `Accept: application/json`. A full postcode searches its sector (`ba1-1`). If the sector has fewer than ten sales, the tool widens to the district (`ba1`). An unknown slug redirects to the national page, and that page also answers JSON with the latest sales anywhere in the country. The tool rejects any answer with `isNationalSearch` set or no boundary id, so national sales are never reported as local.
- `find_agents` reads `/api/agents/search/{location}/{sales|lettings}?per_page=120` and ranks by each agent's in-area listing count. The directory is paginated in partner-first order: Founder and Homemover agents come first, and featured agents with no stock in the area are merged in. So the busiest agent can sit on any page; in London sales (1,845 agents) the top agent is on page 2. The tool ranks from `allPins`, which lists every agent in the area with its count in the first answer, and joins card details from the page. If `allPins` is missing or shorter than `total`, it reads every page (up to 40) before ranking. It drops agents with no listings in the area. Answers not in `property` search mode count each agent's whole stock, so the tool refuses them.
- `typical_rents` reads `/api/v1/rental-prices/{area}` with `Accept: application/json`. Unknown postcode districts and towns return a JSON 404.

Search reads home.co.uk's public JSON. Search responses deliberately omit HTML cards, boundaries, pre-rendered map pins and all other page payload. They retain only each home's coordinates so the separate `render_home_listings` tool can show the selected cards on a map. The search and detail tools stay text-first; only `render_home_listings` and `render_home_detail` link to the MCP Apps resource, so the model can refine an earlier result set and re-render it without another search. Clients without UI still receive the same JSON as text and structured content.

The inline component's resource policy permits listing images from `home.co.uk` and `cdn.home.co.uk`, Plus Jakarta Sans from Google's font CDN, and Mapbox connections only when Mapbox is configured. Mapbox GL JS and CSS come from immutable, versioned paths on this endpoint; their integrity values are calculated from the pinned npm package bytes that those paths serve. Map tiles and styles still come from Mapbox. The component supports inline and fullscreen presentation, interactive pan and zoom with price pins, and is responsive down to 320px. OpenStreetMap is not used anywhere.

A Home deployment must install development dependencies: do not run `npm ci --omit=dev`. Mapbox GL is deliberately a development dependency because `dist/home` is excluded from the public npm package, while the Home server reads its distribution files at startup.

One-home and comparison responses first use `property_uprn` from property details, then try an exact address match. Exact matches receive `scope: "home"`; listings that cannot be matched receive `scope: "area"` with explicitly labelled postcode facts. When details omit a postcode, published coordinates are reverse-geocoded first. Only a listing with no usable UPRN, postcode or coordinates is reported as unavailable.

## Saved searches and price alerts

Nine account tools run on the user's own home.co.uk account: `list_saved_searches`, `create_saved_search`, `pause_saved_search`, `delete_saved_search`, `get_saved_search_new_results` (scope `home.saved-searches`) and `list_price_alerts`, `create_price_alert`, `pause_price_alert`, `delete_price_alert` (scope `home.price-alerts`). atlas owns them (`app/Services/Mcp/ConsumerMcpServer.php`) and is the OAuth server.

- Listing is anonymous. Each account tool declares `oauth2` with its one scope; every other tool stays `noauth`.
- `/.well-known/oauth-protected-resource` (and the same with the MCP path appended) publishes `resource` = `HOME_MCP_RESOURCE` (default `https://mcp.home.co.uk`, the origin, no path), `authorization_servers` = [`HOME_OAUTH_ISSUER`] (default `https://home.co.uk`) and both scopes. It is never cached.
- A call with a bearer token is forwarded, with that token, to `HOME_ACCOUNT_MCP_URL` (default `https://home.co.uk/api/mcp`). atlas checks the token, and only accepts tokens whose resource is its `OAUTH_MCP_RESOURCE`, so that must equal `HOME_MCP_RESOURCE`. Nothing here checks, caches or logs the token.
- A call without a token returns the tool error with `_meta["mcp/www_authenticate"]`, which ChatGPT turns into the sign-in button, on an HTTP 200.
- When atlas refuses the token the caller sent (a 401, or a missing scope given as its "not been granted the required permission" tool error or an `insufficient_scope` challenge), the tool error carries the same `_meta` challenge and the HTTP answer is a 401 with that challenge in `WWW-Authenticate`: `error="invalid_token"` for a forged, expired or revoked token, `error="insufficient_scope"` for a missing scope. Its `resource_metadata` points at this endpoint's metadata, never atlas's.
- Every other atlas answer (down, 5xx, 429, a 404 while atlas's Socket surface is off, a 403 with no challenge) returns "Not available right now." with no challenge, so an outage never signs the user out. While `HOME_SOCKET_ENABLED` is off on atlas, every signed-in call, forged or real, gets that neutral answer.
- `create_saved_search` takes a `location`. atlas's runner ignores free text and would search the whole country, so the endpoint resolves the location through home.co.uk's search JSON and sends `location_slug` (when home.co.uk matched a boundary) plus `lat`, `lng` and `radius`, which the runner uses when the slug is unknown to it.
- `create_saved_search` offers only `for_sale`, `to_rent` and `new_builds`. atlas stores a `sold` search but its runner returns nothing for it (no email, no new results), so the endpoint neither advertises nor forwards it.
- `HOME_ACCOUNTS=off` lists the search tools only and publishes no OAuth metadata.
