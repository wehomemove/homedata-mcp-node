#!/usr/bin/env bash
# Release the remote MCP endpoint on the production box, as the forge user:
#
#   deploy/deploy.sh <git ref>        e.g. deploy/deploy.sh origin/main
#
# Fetches the public repo, builds and tests the ref into releases/<sha>,
# switches `current` atomically, restarts the supervised service and checks
# /healthz. If the new release does not answer healthy it switches back to
# the previous one and exits non-zero. Keeps the last three releases.
#
# The defaults release the Homedata endpoint. The same script releases the
# Home endpoint with its own program, folder and health check:
#
#   DEPLOY_PROGRAM=... DEPLOY_ROOT=... DEPLOY_HEALTH=... deploy.sh origin/main
#
# Runbooks: docs/chatgpt-app/DEPLOY.md (Homedata),
# docs/home-chatgpt-app/RUNNING.md (Home values).
set -euo pipefail

REF=${1:?usage: deploy.sh <git ref>}
# Which endpoint: supervisor program, release folder and health check URL.
PROGRAM=${DEPLOY_PROGRAM:-homedata-mcp}
ROOT=${DEPLOY_ROOT:-/home/forge/mcp.homedata.co.uk}
HEALTH=${DEPLOY_HEALTH:-http://127.0.0.1:8191/healthz}
# Overridable only so the script itself can be exercised away from the box.
REPO=${DEPLOY_REPO:-https://github.com/wehomemove/homedata-mcp-node.git}
SUPERVISORCTL=${DEPLOY_SUPERVISORCTL:-sudo -n /usr/bin/supervisorctl}
echo "deploy: $PROGRAM from $ROOT, health $HEALTH" >&2

cd "$ROOT"
[ -d repo ] || git clone --quiet "$REPO" repo
git -C repo fetch --quiet --prune origin
SHA=$(git -C repo rev-parse --verify "${REF}^{commit}")
REL="$ROOT/releases/$SHA"

# A release counts only once its tests have passed: it is built in a
# .building directory, marked .verified after `npm test` succeeds, and only
# then renamed into place. (`npm test` builds dist/ before testing, so dist/
# existing proves nothing.) A release dir without the marker is rebuilt.
if [ ! -f "$REL/.verified" ]; then
  rm -rf "$REL" "$REL.building"
  mkdir -p "$REL.building"
  git -C repo archive "$SHA" | tar -x -C "$REL.building"
  (cd "$REL.building" && npm ci --no-audit --no-fund --silent && npm test --silent >/dev/null)
  touch "$REL.building/.verified"
  mv -T "$REL.building" "$REL"
fi

PREVIOUS=$(readlink -f current 2>/dev/null || true)
ln -sfn "$REL" current.next && mv -T current.next current
$SUPERVISORCTL restart "$PROGRAM" >/dev/null

healthy() {
  for _ in $(seq 1 20); do
    curl -fsS "$HEALTH" >/dev/null 2>&1 && return 0
    sleep 0.5
  done
  return 1
}

if ! healthy; then
  echo "deploy: $SHA did not answer $HEALTH" >&2
  if [ -n "$PREVIOUS" ] && [ "$PREVIOUS" != "$REL" ]; then
    ln -sfn "$PREVIOUS" current.next && mv -T current.next current
    $SUPERVISORCTL restart "$PROGRAM" >/dev/null
    healthy && echo "deploy: rolled back to $(basename "$PREVIOUS")" >&2
  fi
  exit 1
fi

ls -1dt releases/*/ | grep -v "\.building/$" | tail -n +4 | xargs -r rm -rf
echo "deploy: $SHA live ($(curl -fsS "$HEALTH"))"
