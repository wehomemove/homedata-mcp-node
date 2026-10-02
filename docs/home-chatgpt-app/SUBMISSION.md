# Submitting Home to the ChatGPT directory

Source of truth: [Upload and submit your plugin](https://developers.openai.com/plugins/deploy/submission),
[Build skills](https://developers.openai.com/plugins/build/skills) and
[Remote MCP server review requirements](https://developers.openai.com/plugins/deploy/app-review).
The Homedata package (`docs/chatgpt-app/SUBMISSION.md`) is the template; this
one differs where Home differs.

## The package

```sh
npm run build && node scripts/package-chatgpt-plugin.mjs home
# -> dist-plugin/home-chatgpt-plugin.zip
```

- `home-chatgpt-plugin/listing.json` holds the listing. It is named Home and
  written in the words people type when house hunting (homes, houses and flats
  for sale and to rent, viewings, stamp duty, mortgage repayments). It names no
  other portal, says nothing about pricing, and names a valuation only to rule
  one out. Links are all home.co.uk: the site, `/chatgpt/`, `/contact/`,
  `/privacy/` and `/terms/`. `publication.countries` is `[]`, which means worldwide.
- `home-chatgpt-plugin/assets/logo.png` is `home.co.uk/ms-icon-310x310.png`,
  the site's heart app icon, byte for byte. A test pins its hash. Never restyle
  it; replace it only with another file the site itself serves.
- `home-chatgpt-plugin/skills/` holds three skills: `prepare-for-a-viewing`,
  `shortlist-and-compare` and `buying-costs`. Each has an `agents/openai.yaml`
  that declares the Home MCP server as a dependency.
- The review cases (5 positive, 3 negative) are generated from
  `docs/home-chatgpt-app/golden-prompts.json` (`review: true`). Every positive
  case stands alone (no follow-ups) and was run live before its outcome was
  written. Three of them exercise one skill each.
- `validatePackage(..., HOME_RULES)` and `validateSkills()` run in `npm test`
  and before the ZIP is written. `HOME_RULES` (`src/home/plugin.ts`) differs
  from Homedata's: homes for sale and listings are allowed, there is no
  paid-credit sentence, and any pricing word is refused. `validateSkills()`
  requires every `snake_case` word in backticks in a skill to be a tool,
  argument or allowed value that the Home endpoint lists, and at least one to
  be a tool. Renaming a tool turns the skills red.

## Checks run for this package (2026-10-02)

- `node scripts/home-review-live.mjs https://mcp.home.co.uk/mcp`: all five
  positive cases ran against production. Figures in the buying-costs outcome
  (stamp duty £7,500, loan £405,000, £2,251.12 a month, £270,336.46 interest)
  are the live calculator results.
- Selection check without a ChatGPT login: give a model the Home instructions,
  `tools/list` and the three skills, then ask for its skill and calls on each
  review case plus three skill edge cases (a generic viewing question, a rent
  question that must not use buying-costs, a comparison with no earlier
  results). Run with `claude -p --tools ""`. Haiku 4.5 and Sonnet 5.5 both got
  11 of 11. The first Sonnet run asked about priorities before comparing; the
  skill now compares first and asks only when a ranking is wanted.

## Before submitting

| Step | Who | Status |
| --- | --- | --- |
| Deploy this branch to `mcp.home.co.uk` (domain challenge route) | us | pending |
| Fund the Home Group Homedata org that enriches listings. Today it has no balance, so `area_insights` and all Homedata checks come back unavailable. | **Louis** | pending |
| Cloudflare host skip for `mcp.home.co.uk`, so OpenAI's datacenter calls are not challenged | Reed | asked 2026-10-02 |
| Privacy policy covers queries made through ChatGPT | **Louis** (legal sign-off) | pending |
| Submit under the Home Group OpenAI org (identity verification) | submitter | pending |
| Confirm `category`: `Lifestyle` stands in until the dashboard's list is seen | at upload | pending |
| Signed-in developer-mode run of the golden set, plus the demo video | us + a ChatGPT login | pending |

No reviewer account is needed: every Home tool is no-auth.

## In the portal

1. Upload `home-chatgpt-plugin.zip` under the Home Group developer identity.
   Fix any metadata or skill findings in `home-chatgpt-plugin/` and upload again.
2. **MCPs → Connect**: `https://mcp.home.co.uk/mcp`, no authentication.
3. **Domain verification**: put the token in the box's
   `/home/forge/mcp.home.co.uk/.env` as `OPENAI_APPS_CHALLENGE=<token>`, restart
   `home-mcp`, and check that
   `curl https://mcp.home.co.uk/.well-known/openai-apps-challenge` returns
   exactly the token.
4. Submit for review. Publishing after approval is Louis's decision.

The origin `https://mcp.home.co.uk` cannot change after publication.
