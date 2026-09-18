# Contributing

## The tool list is vendored, not written here

The MCP offers exactly the self-serve endpoints of the Homedata Developer
Playground. The list is generated in the
[Python package](https://github.com/wehomemove/homedata-mcp) and vendored here.
Do not edit `src/manifest/` by hand: change the catalogue, regenerate the
manifest there, then re-vendor:

```bash
node scripts/vendor-manifest.mjs --ref <commit sha of homedata-mcp>
node scripts/readme-tools.mjs
npm run build && npm test
```

`SOURCE.json` records the commit and a sha256 per file.
`node scripts/vendor-manifest.mjs --check` re-fetches at that commit and fails
if a vendored byte differs; CI runs it before the parity job, so the parity
result always applies to the copy this package ships.

## What the tests enforce

- `src/test/server.test.ts`: the server offers exactly the manifest, sends one
  request per tool to its manifest endpoint, refuses invalid arguments without
  sending anything, reports what a call cost, and the helpers call nothing.
- `src/test/stdio.test.ts`: a real MCP client session over stdio against a local
  stand-in API.
- CI `parity` job: the Python package's guard (`python -m homedata_mcp.parity`)
  judges this server's tools/list and recorded requests. One guard, both
  servers.

## Releasing

Publishing needs a go from the product owner. When there is one:

1. Set the version in `package.json` and `src/index.ts` (a test checks they
   match) and date the CHANGELOG entry.
2. Merge to `main` with CI green.
3. Push a tag `vX.Y.Z`; `.github/workflows/release.yml` publishes to npm.
