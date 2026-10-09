# Homedata in ChatGPT: research notes and build plan

Started 2026-10-01 by quinn/gpt-plugin. Every claim about OpenAI below is taken from
OpenAI's own documentation, read in full on 2026-10-01 from the Markdown twins of
the pages (append `.md` to any page URL). Where something is our inference rather
than OpenAI's text, it says so.

## 1. What a "ChatGPT plugin" is today

OpenAI renamed and folded things together. `developers.openai.com/apps-sdk` now
redirects to `developers.openai.com/plugins`. What used to be a "ChatGPT app built
with the Apps SDK" is now a **plugin**: a package people install from one
**universal directory shared by ChatGPT and Codex**.

A plugin contains skills, an MCP server, or both
([Plugin architecture](https://developers.openai.com/plugins/concepts/plugins)):

- **Skills**: folders with a `SKILL.md`, workflow instructions for the model.
- **An MCP server**: the tools, auth and live data. Optional UI hangs off it.
- **Optional UI**: built on the open MCP Apps standard, not a ChatGPT-only format.

For us the shape is **MCP server only** at first: our value is live data behind
tools. Skills can come later if a workflow needs guidance, such as "assess a
property before an offer".

Primary pages read for these notes:

| Topic | Page |
| --- | --- |
| Index | https://developers.openai.com/plugins |
| Quickstart | https://developers.openai.com/plugins/quickstart |
| Build an MCP server | https://developers.openai.com/plugins/build/mcp-server |
| Authentication | https://developers.openai.com/plugins/build/auth |
| Define tools | https://developers.openai.com/plugins/plan/tools |
| Optimize metadata | https://developers.openai.com/plugins/guides/optimize-metadata |
| UI (MCP Apps) | https://developers.openai.com/plugins/build/chatgpt-ui |
| Connect and test | https://developers.openai.com/plugins/deploy/connect-chatgpt |
| Developer mode | https://developers.openai.com/api/docs/guides/developer-mode |
| Secure MCP Tunnel | https://developers.openai.com/api/docs/guides/secure-mcp-tunnels |
| Review requirements | https://developers.openai.com/plugins/deploy/app-review |
| Submission | https://developers.openai.com/plugins/deploy/submission |
| Guidelines | https://developers.openai.com/plugins/plugin-guidelines |

`https://chatgpt.com/features/plugins/` returns 403 to non-browser clients, so it
was not read. The developer docs are the authority anyway.

## 2. What OpenAI requires, by topic

### Transport

- "Deploy production MCP servers at stable HTTPS endpoints using the streamable
  HTTP transport", "typically at `/mcp`"
  ([MCP server concept](https://developers.openai.com/plugins/concepts/mcp-server),
  [Build](https://developers.openai.com/plugins/build/mcp-server#deploy-the-endpoint)).
- Developer mode also accepts SSE, but submission needs a public HTTPS
  streamable-HTTP endpoint. A tunnel or Secure MCP Tunnel is fine for testing and
  "does not satisfy public submission requirements".
- **The server origin can never change once published.** "The MCP server origin
  (`scheme`, `hostname`, or `port`) can't change between versions. To use a
  different origin, submit a new plugin." So the production hostname is a
  one-way door ([Review](https://developers.openai.com/plugins/deploy/app-review#submitting-new-versions-for-review)).
- Domain verification: serve the exact challenge token as plain text at
  `https://<mcp host or eligible parent>/.well-known/openai-apps-challenge`
  ([Submission](https://developers.openai.com/plugins/deploy/submission#domain-verification)).

### Authentication

From [Authentication](https://developers.openai.com/plugins/build/auth):

- **ChatGPT cannot send an API key.** "ChatGPT does **not** support
  machine-to-machine OAuth grants such as client credentials, service accounts,
  or JWT bearer assertions, nor can it present custom API keys or
  customer-provided mTLS certificates."
- The two options are **`noauth`** (anonymous tools) and **OAuth 2.1** following
  the MCP authorization spec: authorization code + PKCE (`S258`),
  protected-resource metadata at `/.well-known/oauth-protected-resource`, an
  authorization server publishing RFC 8414 or OIDC discovery, the `resource`
  parameter echoed into the token audience, and client registration by CIMD
  (preferred), DCR, or a predefined client.
- Auth is declared **per tool** with `securitySchemes` (`noauth`, `oauth2`, or
  both). Developer mode supports "OAuth, No Authentication, and Mixed
  Authentication". In mixed mode, initialize and list-tools are anonymous and each
  tool follows its own scheme.
- To make ChatGPT show its "connect your account" UI, a tool result must carry
  `_meta["mcp/www_authenticate"]` and the tool must declare `oauth2`. Both are
  needed.
- ChatGPT presents an OpenAI-managed mTLS client certificate and publishes egress
  IP ranges. We can use either to confirm the caller is ChatGPT, but neither
  identifies the user.
- OpenAI "_strongly_ recommend[s]" an established identity provider (Auth0,
  Stytch named) over writing an authorization server ourselves.

### Tools and metadata

From [Define tools](https://developers.openai.com/plugins/plan/tools),
[Build](https://developers.openai.com/plugins/build/mcp-server) and the
[Guidelines](https://developers.openai.com/plugins/plugin-guidelines#tools):

- Each tool needs a name, a **title**, a description saying when to use it, an
  input schema, an **output schema** when it returns structured data, and
  **explicit boolean** `readOnlyHint`, `destructiveHint` and `openWorldHint`.
  Wrong annotations are a named rejection reason.
- "Do not mirror an internal API without considering how people will ask for and
  use the capability." Each tool must work on its own. No generic executor.
- Server `instructions`: keep "the most important details in the first 512
  characters".
- Results: `structuredContent` for the model, `content` for text, `_meta` hidden
  from the model. **Response minimisation is enforced**: no request IDs, trace
  IDs, timestamps, internal account IDs or logging metadata unless the user needs
  them.
- Inputs: "Do not request precise user location data (for example, GPS
  coordinates or addresses)." *Our reading (INFERRED):* this is about **the
  user's own** location. An address the user asks about is the subject of the
  query, not the user's location. We should say so plainly in tool descriptions
  and the review notes.

### UI (optional)

From [Add UI](https://developers.openai.com/plugins/build/chatgpt-ui):

- Built on the open **MCP Apps** standard: a `ui://` resource with mimeType
  `text/html;profile=mcp-app`, linked from the tool by `_meta.ui.resourceUri`,
  talking to the host over a `ui/*` postMessage bridge. `window.openai` is only
  for ChatGPT-specific extras.
- OpenAI recommends **separating data tools from render tools**. Its worked
  example is real estate: a `search` data tool, then `render_listings_widget`
  with the filtered IDs. Only the render tool carries `_meta.ui.resourceUri`.
- A tight content security policy (`connectDomains`, `resourceDomains`) is
  checked in review.
- Tools must stay useful without the UI.

### Testing

From [Connect and test](https://developers.openai.com/plugins/deploy/connect-chatgpt)
and [Developer mode](https://developers.openai.com/api/docs/guides/developer-mode):

- **Developer mode is available on Plus, Pro, Business, Enterprise and Education
  accounts, on the web.** Settings → Security and login → Developer mode, then
  chatgpt.com/plugins → "+" → MCP server URL. Use it in a **Work** chat via `@`.
- Workspace policy can disable developer mode on Business and Enterprise plans.
- Use MCP Inspector (`npx @modelcontextprotocol/inspector`) before ChatGPT.
- Keep a golden prompt set: direct, indirect, follow-up and negative prompts.
  Record tool chosen, arguments and result, and re-run it after every metadata
  change. After a change, press **Refresh** on the connection.

### Submission and review

From [Review](https://developers.openai.com/plugins/deploy/app-review),
[Submission](https://developers.openai.com/plugins/deploy/submission) and the
[Guidelines](https://developers.openai.com/plugins/plugin-guidelines):

- **Identity verification is mandatory.** The OpenAI Platform organisation needs
  business verification to publish under a company name, at
  platform.openai.com/settings/organization/general. Submitting needs an org
  owner or the Apps Management Write permission. Projects with EU data
  residency cannot submit MCP plugins.
- The package is a ZIP with `plugin.json` metadata: name, logo (square, at least
  48px), `websiteURL`, `supportURL`, `privacyPolicyURL` and `termsOfServiceURL`
  (all four required for MCP review), up to 3 starter prompts, and
  `publication.countries` (for example `["GB"]`).
- Review packet: **5 positive and 3 negative test cases**, a **video
  walkthrough**, release notes, and **reviewer credentials**. The reviewer
  account must be "fully featured" with sample data, and must sign in with no
  MFA, no email or SMS codes and no magic links.
- "Trial or demo plugins will not be accepted."
- After publication, tool changes are re-checked automatically by "continuous
  review". Listing and skill changes need a new version and a new review.
- Discovery is by direct link or exact-name search. Front-page placement is at
  OpenAI's discretion and cannot be requested.

### Commerce rules (these shape the product)

From the [Guidelines](https://developers.openai.com/plugins/plugin-guidelines#commerce-and-monetization):

- "Selling digital products or services—including subscriptions, digital
  content, tokens, or credits—is not allowed, whether offered directly or
  indirectly (for example, through freemium upsells)."
- "Users may sign in to an existing paid account and access features already
  included in their subscription." A plugin may say a feature needs a different
  entitlement and link to an *informational* plans page. It must not link to
  checkout or a page that starts a purchase.
- Listing name and description: "Do not advertise pricing, subscriptions, free
  trials, discounts, or promotions." Do not append "MCP" or "Plugin" to the name.

## 3. What we have: homedata-mcp-node (main at a75f01e)

MEASURED from source:

- **Transport: stdio only.** `src/server.ts` connects a `StdioServerTransport`.
  There is no HTTP listener.
- **Auth: one `HOMEDATA_API_KEY` from the environment**, sent to
  `https://api.homedata.co.uk` as `Authorization: Api-Key …` (`src/client.ts`).
  With no key, only the two signup helpers are listed.
- **Tools: 58 data tools generated from the vendored Playground manifest**
  (`src/manifest/tools.json`), plus `start_homedata_signup` and
  `check_homedata_api_key`. **57 are GET requests; listing_address is a POST that resolves a listing ID**, so every one is honestly
  `readOnlyHint: true, destructiveHint: false`.
- Uses the low-level `Server` class with hand-written list/call handlers. It
  sets no `title`, `outputSchema` or `annotations`.
- Descriptions and server instructions **state token prices**. The server
  instructions also describe the prepaid balance.
- Results put the API body into both `content` (pretty-printed JSON) and
  `structuredContent`, with spend in `_meta.homedata`.
- Catalogue coverage: address/UPRN, property tiers (base/core/complete),
  attributes, EPC, council tax, LR titles, risks, planning, schools, broadband,
  crime, deprivation, price trends and growth, postcode profile, amenities, fuel,
  healthcare and calculators. There is **no valuation tool**: valuations left the
  Playground catalogue in thor #400 (see the homedata-mcp lane memory).

On the Homedata side (MEASURED, thor origin/main 54879c70): thor authenticates
with **Laravel Sanctum only, and there is no OAuth authorization server**. Each
Organization holds its Loki key (`loki_api_key`, `loki_api_key_prefix`), and
Loki charges tokens per key.

## 4. The gap

| ChatGPT needs | We have | Work |
| --- | --- | --- |
| Public HTTPS streamable HTTP at `/mcp` | stdio | Add an HTTP entry point. The SDK already ships `StreamableHTTPServerTransport`. |
| A stable, permanent hostname | none | Pick it once, for example `mcp.homedata.co.uk`. |
| OAuth 2.1 per user, or `noauth` | env API key | See the auth plan below. |
| Title, output schema, explicit annotations on every tool | none set | Add them in the HTTP profile. |
| No pricing in listing copy. Tool descriptions are model-readable fields. | token prices in descriptions and instructions | A ChatGPT description profile without prices. Spend stays in `_meta`, which the model does not see. |
| No selling of credits, no signup upsell | `start_homedata_signup` | Leave the signup helpers out of the ChatGPT surface. |
| A focused tool surface built from user goals | 58 endpoint mirrors | Start with a curated subset (below) and grow from the golden set. |
| Response minimisation | raw API bodies | Audit each exposed tool's payload for internal IDs and timestamps. |
| Domain challenge, privacy, terms, support and website URLs | site exists | Confirm that the existing homedata.co.uk privacy policy covers this use. |
| A reviewer demo account with no MFA | none | A dedicated Homedata org with a funded wallet. |

## 5. Build plan

**Phase 1: remote endpoint, developer mode (start now).**

- Add `src/http.ts`: a Streamable HTTP server on `/mcp`, stateless (a new
  server and transport per request), with a `/healthz` route and a `bin` entry
  `homedata-mcp-http`. It reuses `buildServer` so stdio and HTTP keep one tool
  definition.
- Add a `chatgpt` profile that gives every tool a `title`, explicit
  annotations (`readOnlyHint: true`, `destructiveHint: false`,
  `openWorldHint: false`), descriptions with no prices, no signup helpers, and
  a curated tool list. The stdio package keeps its current behaviour, so
  nothing changes for npm users.
- Auth for this phase is `noauth` with a **server-held Homedata key** from a
  dedicated test org, used only for our own developer-mode testing. Spend comes
  from our test wallet.
- Run it on port 4176 behind our gated preview, connect it in developer mode,
  and run the golden prompt set.

First curated tool set (INFERRED from likely user goals, to be refined by the
golden set):
`address_match`, `address_postcode`, `property_core`, `attr_epc`,
`council_tax`, `risks` (flood and other environmental risk), `planning`,
`schools`, `broadband`, `crime`, `price_trends`, `price_growth`,
`postcode_profile`, `deprivation` and `amenities_all`.

Update 2026-10-01: `postcode_profile` was taken out of this set. Measured in
production, it returned empty deprivation, school and transport sections (and
often empty broadband and sold prices) for every postcode tried, while the
dedicated tools had the data. Re-adding it is one line in `CHATGPT_TOOLS`
once it returns full data.

**Phase 2: OAuth with the user's own Homedata account.**

- Recommended design: thor becomes the OAuth 2.1 authorization server. Users
  sign in with their homedata.co.uk login. Laravel Passport is one option; it
  needs PKCE S258, RFC 8414 metadata, CIMD or DCR, `resource` echoed into
  `aud`, and RFC 9207 `iss`. An external provider such as Auth0 or Stytch,
  federated to thor, is the alternative.
- The MCP server becomes the resource server. It verifies the token, resolves
  the user's org, and calls Loki with **that org's key**, so calls charge the
  user's own wallet. The ChatGPT user never sees or pastes a key; the guidelines
  forbid collecting API keys.
- Declare `oauth2` on the data tools. Return
  `_meta["mcp/www_authenticate"]` when unlinked. Add a read-only profile tool
  with `_meta["openai/profile"]: true`.
- An empty wallet produces a plain "your balance can't cover this" message with
  a link to an informational page. No checkout link.

**Phase 3: optional UI.** A property card and an area summary, using the
decoupled data and render tools, MCP Apps resource and tight CSP. Only build
this if the golden set shows text answers fall short.

**Phase 4: submission.** Business verification, the hostname fixed for good,
the domain challenge, `plugin.json` with GB-only countries, the four URLs, a
logo, starter prompts with no pricing, 5 positive and 3 negative cases, a
video, and a no-MFA reviewer org with a funded wallet.

## 6. Distribution: why this is worth doing now

The ask came with a post arguing that ChatGPT plugins are 2026's free
distribution channel: ChatGPT now suggests plugins mid-conversation, and the
slots for most questions are empty. What OpenAI's own text says about that:

- Proactive suggestions exist, but they are earned. "Plugins that demonstrate
  strong real-world utility and high user satisfaction may be eligible for
  enhanced distribution opportunities, such as directory placement or proactive
  suggestions." "Developers cannot request enhanced distribution."
  ([Review](https://developers.openai.com/plugins/deploy/app-review#discovery)).
  The lever is reliable, useful answers, which the golden prompt set measures.
- Matching the words users type is endorsed: build "indirect prompts" (outcome
  wanted, tool not named) into the golden set and tune descriptions for recall
  ([Optimize metadata](https://developers.openai.com/plugins/guides/optimize-metadata)).
  For us that means phrases we can answer today: "is this street at risk of
  flooding", "what council tax band is", "good schools near", "EPC rating of",
  and "broadband speed at".
- The limit: descriptions "must not recommend overly broad triggering beyond the
  explicit user intent", and must not steer the model towards us over other
  plugins (Guidelines, *Fair play* and *Tools*). Accurate and specific wins
  review. Keyword-stuffed copy gets rejected.
- "Ship several and see which gets picked up" is allowed: "Each organization can
  publish multiple unique plugins with MCP." Plugins that are spam or copycats
  are not allowed, so each one needs a distinct purpose. Candidates for us, all
  INFERRED from the catalogue: a property lookup (homebuyers), an area or
  "should I move here" check, and a developer-facing Homedata API helper.
- There is a gap to close first. The catalogue has **no valuation and no listings
  tool** today: valuations were removed in thor #400, and listings are enterprise
  only and held out of the MCP. "How much is my house worth" and listings
  questions are the biggest consumer intents, so we should not imply we answer
  them until we really do.

## 7. Decisions for Louis

These are account, spend and product calls. The defaults are what we build
towards unless he says otherwise.

1. **OpenAI account and developer access.** Default: the Homedata/Homemove
   OpenAI Platform org, with business verification under the Homedata trading
   name, plus one ChatGPT Plus or Business seat for developer-mode testing whose
   login the fleet can use.
2. **Auth approach.** Default: OAuth with the user's own homedata.co.uk account,
   charging their own wallet (Phase 2). Until then, a server-held key on a
   dedicated test wallet, for private developer-mode use only. It is never
   published anonymously, because that would put public traffic on our spend.
3. **Directory or private first.** Default: private developer mode first, then
   the public directory, GB only, once OAuth and a reviewer account exist.

## 8. Open questions (ours, not Louis's)

- Hosting for the permanent `/mcp` origin. It must be public HTTPS with logs and
  rate limits. Ask base (SRE) where Homedata services run in production.
- Whether the existing homedata.co.uk privacy policy covers queries made through
  ChatGPT, which sends the address the user typed.
- Whether `property_core`'s payload contains internal IDs or timestamps that
  review would flag.
