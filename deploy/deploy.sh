#!/usr/bin/env bash
# Release the remote MCP endpoint on the production box, as the forge user:
#
#   deploy/deploy.sh <git ref>        e.g. deploy/deploy.sh origin/main
#
# Fetches the public repo, builds and tests the ref into releases/<sha>,
# switches `current` atomically, restarts the supervised service and checks
# /healthz. If the new release does not answer healthy it switches back to
# the previous one and exits non-zero. Keeps the last three releases.
# Runbook: docs/chatgpt-app/DEPLOY.md
set -euo pipefail

REF=${1:?usage: deploy.sh <git ref>}
ROOT=/home/forge/mcp.homedata.co.uk
REPO=https://github.com/wehomemove/homedata-mcp-node.git
PROGRAM=homedata-mcp
HEALTH=http://127.0.0.1:8191/healthz

cd "$ROOT"
[ -d repo ] || git clone --quiet "$REPO" repo
git -C repo fetch --quiet --prune origin
SHA=$(git -C repo rev-parse --verify "${REF}^{commit}")
REL="$ROOT/releases/$SHA"

if [ ! -f "$REL/dist/http.js" ]; then
  rm -rf "$REL"
  mkdir -p "$REL"
  git -C repo archive "$SHA" | tar -x -C "$REL"
  (cd "$REL" && npm ci --no-audit --no-fund --silent && npm test --silent >/dev/null)
fi

PREVIOUS=$(readlink -f current 2>/dev/null || true)
ln -sfn "$REL" current.next && mv -T current.next current
sudo -n /usr/bin/supervisorctl restart "$PROGRAM" >/dev/null

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
    sudo -n /usr/bin/supervisorctl restart "$PROGRAM" >/dev/null
    healthy && echo "deploy: rolled back to $(basename "$PREVIOUS")" >&2
  fi
  exit 1
fi

ls -1dt releases/*/ | tail -n +4 | xargs -r rm -rf
echo "deploy: $SHA live ($(curl -fsS "$HEALTH"))"
