# Home: ChatGPT submission note

One page for whoever uploads Home under the Home Group OpenAI organisation.
OpenAI's rules: [Upload and submit your plugin](https://developers.openai.com/plugins/deploy/submission),
[Build skills](https://developers.openai.com/plugins/build/skills),
[Remote MCP server review requirements](https://developers.openai.com/plugins/deploy/app-review).

## What to upload

**`docs/home-chatgpt-app/home-chatgpt-plugin.zip`**. Rebuild it with
`npm run build && node scripts/package-chatgpt-plugin.mjs home`, then copy
`dist-plugin/home-chatgpt-plugin.zip` over it. `npm test` fails if the committed
ZIP differs from its sources. The packager will not write a ZIP that fails
`validatePackage()`, `validateSkills()` or `secretsIn()`. No key, token,
reviewer login or `.env` goes in the package.

| In the ZIP | Source |
| --- | --- |
| `plugin.json`: listing, keywords, 5 positive and 3 negative review cases | `home-chatgpt-plugin/listing.json` + `review: true` cases in `golden-prompts.json` |
| `mcp.json` → `https://mcp.home.co.uk/mcp` | `home-chatgpt-plugin/mcp.json` |
| `assets/logo.png`: home.co.uk's own heart icon (hash pinned) | `home-chatgpt-plugin/assets/` |
| Five skills: `what-can-i-afford`, `prepare-for-a-viewing`, `plan-a-viewing-day`, `shortlist-and-compare`, `buying-costs` | `home-chatgpt-plugin/skills/` |

The listing names no other portal and says nothing about pricing or offers.
It names a valuation only to rule one out. Category: `Lifestyle`. Countries:
worldwide (`[]`). Screenshots (light and dark, live Bath data, 2 October 2026)
are in `screenshots/`: `listings`, `map`, `detail`, `shortlist`.

## URL and auth

- **MCP URL:** `https://mcp.home.co.uk/mcp` (streamable HTTP). The origin cannot change after publication.
- **Auth:** OAuth, mixed. The 13 search, detail, area, calculator, commute and
  viewing-day tools are `noauth`. The nine saved-search and price-alert tools
  need a home.co.uk sign-in (scopes `home.saved-searches`, `home.price-alerts`). ChatGPT
  finds home.co.uk as the authorization server at
  `https://mcp.home.co.uk/.well-known/oauth-protected-resource`.
- **Domain verification:** put the portal's token in
  `/home/forge/mcp.home.co.uk/.env` as `OPENAI_APPS_CHALLENGE=<token>`, restart
  `home-mcp`, and check that `curl https://mcp.home.co.uk/.well-known/openai-apps-challenge` returns only the token.

## Reviewer steps (paste into Review details)

1. Connect Home. Searching needs no sign-in.
2. *"I'm a first-time buyer with a £40,000 deposit and can pay £1,600 a month at 4.5% over 25 years. What price can I go up to? Show me two-bedroom homes for sale in Bath with a garden in that budget."* Expect a price of about £327,000, stamp duty of £1,350 and cards with a map. Each garden is quoted from the listing's own words.
3. *"I'm viewing the newest three-bedroom house for sale in Bath under £500,000 this weekend. What should I check and ask the agent?"* Expect a checklist from that home's facts and five questions for the agent, with no valuation.
4. *"Find two-bedroom homes to rent in Bath, compare the three newest side by side, and tell me which are within a 20-minute walk of Bath Spa station."*
5. *"Find the four newest homes for sale in Bath with at least three bedrooms and plan the quickest order to view them on Saturday, starting from Bath Spa station."* Expect the stops in order, each drive in minutes and the total.
6. *"I'm a first-time buyer. What would a £450,000 home cost me up front and each month with a £45,000 deposit at 4.5% over 25 years?"* Expect £7,500 stamp duty and about £2,251 a month.
7. For saved searches and price alerts, sign in with the reviewer account entered in the form (home.co.uk, verified email, no MFA). Say *"Save this search and email me daily"* after step 2, then *"Watch the first home for price drops"*.

Search results are live listings, so the homes and counts change day to day.
Calculator figures do not change.

## Checked for this package (2026-10-02)

- `node scripts/home-review-live.mjs https://mcp.home.co.uk/mcp`: all five positive cases ran against production, including the wish search, `commute_filter` and `plan_viewings`. The figures in the outcomes come from that run.
- `node scripts/home-golden-check.mjs https://mcp.home.co.uk/mcp`: all 22 live tools are exercised by at least one golden case (`checkGoldenSet` requires this).
- The 11 of 11 skill-selection run (Haiku 4.5, Sonnet 5.5, `claude -p --tools ""`) was done before `what-can-i-afford` and `plan-a-viewing-day` were added. Re-run it with the five skills before uploading.

## Still open before submitting

| Step | Who |
| --- | --- |
| Cloudflare host skip for `mcp.home.co.uk`, so OpenAI's datacenter calls are not challenged | Reed |
| Privacy policy covers queries made through ChatGPT (legal sign-off) | Louis |
| Submit under the verified Home Group OpenAI org | submitter |
| A home.co.uk reviewer account for the account tools; atlas `OAUTH_MCP_RESOURCE` = `https://mcp.home.co.uk` | us + atlas deploy |
| Signed-in developer-mode run of the golden set, plus the demo video | us + a ChatGPT login |
| Confirm `category` against the dashboard's list at upload | submitter |

Publishing after approval is Louis's decision.
