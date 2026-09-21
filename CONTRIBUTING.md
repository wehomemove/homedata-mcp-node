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

`SOURCE.json` records the commit and a sha256 per file. Two different checks
guard it, and neither replaces the other:

- `node scripts/vendor-manifest.mjs --check` asks whether the vendored files
  match **the commit they record**. CI runs it before the parity job, so the
  parity result always applies to the copy this package ships.
- `node scripts/check-manifest-current.mjs` asks whether that commit is still
  **the upstream head**. Without it, this package could vendor a year-old tool
  list and stay green: the files would still match the commit they record, and
  the parity job would still pass. It runs weekly, not per-PR, because main
  moving is not a reason to fail someone's pull request.

When the weekly check fails, the fix is to re-vendor from the head it names and
commit the result; the failure message spells out the three commands. Expect the
README tool table and the tests to change with it if the upstream manifest did.

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
