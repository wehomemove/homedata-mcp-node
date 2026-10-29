# Rejection fix validation

- `npm test`: 296 tests passed, zero failures, including 50 server tests.
- The privacy matrix exercises 14 tools on HTTP 200 and 422: 28 transport cases.
- Additional cases verify every allowed overview section, unknown-section exclusion,
  public fact retention, property-part labels, missing-part omission and unchanged stdio.
- Public planning, school and GP addresses survive in both structured and text output.
  Rebuilding is limited to the measured property label paths, including API error bodies.
- Review regression mutation: restoring the broad address rewrite fails all three
  public site address tests; generated output was restored afterwards.
- Merge-queue legs command exited 0; the project selected no legs for this diff.
- Mutation check: disabling the recursive denied-field check in generated output
  makes both selected address_match regression cases fail on a denied key. Generated
  output was restored before packaging; no mutation is committed.
- `node scripts/package-chatgpt-plugin.mjs`: validated and wrote the submission ZIP.
- Fixtures are synthetic, based on measured field shapes; no live personal data or
  reviewer credentials are included. No external model was used for product tests.
- No Live Preview exists for homedata-mcp-node. This change has no screens or click journey.
- Product cost per lookup: unknown (no new model call); product margin per lookup:
  unknown; maximum additional exposure: zero new API calls per lookup, assuming the
  same tool request. Existing account billing remains unchanged.

OpenAI approval and deployed signed-in review remain external to this code proof.
