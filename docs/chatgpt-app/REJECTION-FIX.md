# Resubmission changes, 29 October 2026

The ChatGPT profile removes the fields identified in OpenAI's rejection. The
stdio package retains its existing API responses. No privacy or legal wording
has been changed.

Property overview responses admit only the sections advertised by the tool:
address, property type, rooms, EPC, last sold, construction, dimensions, garden,
parking, title basics and boundary geometry, council tax, flood, schools,
broadband, crime, demographics, solar, registered sales, listed buildings,
conservation and planning designations. New API sections require review before
being added. Valuations remain excluded.

At every object and array depth, ChatGPT responses remove applicant name, agent
name/address, case officer, head teacher, title number, address-resolution
metadata, postcode UPRN token and wallet charge/balance fields. School query
echoes are removed in both standalone schools and property overviews. Address
labels are rebuilt from property address parts; if those parts are absent, the
original occupant-bearing label is omitted. API errors use the same filter.
Response header spend metadata is not attached to ChatGPT results.

The directory display name is **Homedata Property Research**. The shorter
listing describes supported lookups, account requirements and dataset limits.
The approved paid-credit disclosure is retained verbatim.

Validation uses synthetic fixtures shaped from the measured field inventory;
it does not send personal data to an external model. Transport tests cover all
14 tools on successful and error responses, nested arrays and objects, retained
public facts, unknown overview sections, address reconstruction, and unchanged
stdio output. Run `npm test` and `node scripts/package-chatgpt-plugin.mjs`.

After this branch is reviewed and deployed, upload the generated
`dist-plugin/homedata-chatgpt-plugin.zip` to the existing app submission and
repeat the signed-in review cases against the deployed endpoint. OpenAI's
acceptance remains an external review outcome; local checks cannot establish it.
