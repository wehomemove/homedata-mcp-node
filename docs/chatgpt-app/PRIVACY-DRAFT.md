# Draft privacy policy section: using Homedata through ChatGPT

OpenAI requires a published privacy policy that covers the personal data
categories collected through the plugin, the purposes, the recipients, the
retention and the user's controls
([guidelines](https://developers.openai.com/plugins/plugin-guidelines#privacy-policy)).
homedata.co.uk/privacy ("Last updated September 2026", read 2026-10-01) has no
section on connected apps, ChatGPT, account linking, or the lookups made
through them.

This is a draft for sign-off. **Publishing it is a legal decision for Louis**;
nothing here has been published. Every statement is checked against the code or
measured in production.

---

## Using Homedata through ChatGPT and other connected apps

You can connect your Homedata account to ChatGPT so that it can look up UK
property and area data for you.

**What we receive.** When you connect, you sign in to Homedata and agree to the
connection on our own page. ChatGPT never sees your password or your API key.
When ChatGPT looks something up for you, we receive the details needed for that
lookup: the address, postcode or property reference you asked about, and which
lookup it was.

**What we use it for.** To answer the lookup, to record it against your account
in the same way as any other request to the Homedata API, and to keep the
service secure, for example by limiting how often lookups can be made.

**Who receives it.** The answer to each lookup goes back to ChatGPT, which is
run by OpenAI. OpenAI's handling of your conversations is governed by OpenAI's
own privacy policy. We do not share your account details with OpenAI.

**How long we keep it.** A connection stays active while you keep it. The
access it uses lasts one hour and is renewed automatically for up to 30 days of
inactivity. We keep request logs for 90 days and prune older logs every night.
Each log records the path and query string, which include the address or
postcode you asked about, together with the time, status and result count. For
lookups made through ChatGPT, the IP address in the log is Homedata's own server
address, not yours.

**Your choices.** You can disconnect Homedata from ChatGPT's settings at any
time. Rotating your API key in your Homedata dashboard ends every connected app
at once.

---

## Evidence (homedata-mcp-node, thor and production; 2026-10-01)

- Sign-in and consent on homedata.co.uk; ChatGPT never sees the key: thor
  `AuthorizeController`, consent view, `IntrospectController` (the key goes only
  to our MCP endpoint).
- Access token 1 hour, refresh 30 days: `config/oauth.php` `ttl`.
- Rotating the key ends every link: `Organization::booted()` revokes the
  organisation's grants when `loki_api_key` changes.
- Tool inputs are only an address, postcode, UPRN or outcode plus filters:
  `src/manifest/tools.json` params for the 15 ChatGPT tools.
- Rate limiting per user: `src/http.ts` `CallerLimits`.
- Production request-log measurement: the nightly prune runs and the oldest row
  is exactly 90 days old. Each row stores the request path and query string,
  time, status, result count and IP address; requests through ChatGPT record
  Homedata's server IP rather than the user's IP.
