# Submitting Homedata to the ChatGPT directory

Source of truth: [Upload and submit your plugin](https://developers.openai.com/plugins/deploy/submission)
and [Remote MCP server review requirements](https://developers.openai.com/plugins/deploy/app-review).

## The package

```sh
npm run build && node scripts/package-chatgpt-plugin.mjs
# -> dist-plugin/homedata-chatgpt-plugin.zip
```

- `chatgpt-plugin/listing.json` holds the listing: name, subtitle,
  description, links, starter prompts, icons, GB-only availability and release
  notes. It is the only file to edit by hand.
- The review cases (5 positive, 3 negative) are generated from
  `docs/chatgpt-app/golden-prompts.json` (`review: true`), so the cases we
  submit are the cases we test.
- `validatePackage()` (run by `npm test` and by the script) enforces OpenAI's
  limits and Homedata's listing rules: no pricing or offers, no competitor
  portals, no internal details, no "MCP"/"Plugin" in the name, HTTPS links,
  icon sizes, brand-colour contrast, and no credentials in the package.

## Before submitting

| Step | Who | Status |
| --- | --- | --- |
| Endpoint live at `https://mcp.homedata.co.uk/mcp`, with sign-in through homedata.co.uk | us | done (DEPLOY.md) |
| Reviewer account: no MFA, own org, funded wallet | us | done: `chatgpt-review@homedata.co.uk`, credentials in `credentials/homedata-chatgpt-review.json` (never in the package) |
| Signed-in end-to-end run of the golden set in developer mode | us + Louis's ChatGPT login | pending |
| Video walkthrough of the test cases (`review.demo_recording_url`) | us, recorded from that run | pending |
| Privacy policy covers ChatGPT use (PRIVACY-DRAFT.md) | **Louis** (legal sign-off), then publish | pending |
| OpenAI Platform org identity verification under the publishing name | **Louis** | pending |
| Confirm the category: `Productivity` is a placeholder until the dashboard's list is seen | at upload | pending |

## In the portal (platform.openai.com/plugins)

1. **Upload new or existing plugin**, choose the verified developer identity,
   then upload the ZIP. Fix any metadata findings in `listing.json` and upload
   again.
2. **MCPs → Connect**: the URL is `https://mcp.homedata.co.uk/mcp` and the
   authentication is OAuth. ChatGPT discovers the rest.
3. **Domain verification.** The portal shows a token. Put it on the box in
   `/home/forge/mcp.homedata.co.uk/.env` as `OPENAI_APPS_CHALLENGE=<token>`, run
   `sudo -n /usr/bin/supervisorctl restart homedata-mcp`, then check
   `curl https://mcp.homedata.co.uk/.well-known/openai-apps-challenge` returns
   exactly the token. The endpoint serves it as plain text and refuses to start
   if the token is malformed.
4. **Review details**: enter the reviewer credentials from the credentials file
   and the login URL `https://homedata.co.uk/login`.
5. **Submit for review**. Publishing after approval is Louis's decision.

The MCP origin `https://mcp.homedata.co.uk` cannot change after publication;
changing it means submitting a new plugin.
