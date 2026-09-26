#!/usr/bin/env bash
# Proves the shipped image migrates, boots as API and worker, and serves the expected release.
# Usage: scripts/ci-image-smoke.sh <image> <release>   (expects Postgres on localhost:5432)
set -euo pipefail
IMAGE="$1"
RELEASE="$2"
KEY="$(openssl rand -base64 32)"
RUN_ENV=(
  --network host
  -e "DATABASE_URL=postgres://nova:nova@localhost:5432/nova_test"
  -e "NOVA_MASTER_KEY=${KEY}"
  -e "NOVA_ENV=staging"
  -e "NOVA_RECIPIENT_ALLOWLIST=ci@example.com"
)

cleanup() {
  docker logs nova-api 2>&1 | tail -n 50 || true
  docker logs nova-worker 2>&1 | tail -n 50 || true
  docker rm -f nova-api nova-worker >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker run --rm "${RUN_ENV[@]}" "$IMAGE" node dist/entrypoints/migrate.js
docker run -d --name nova-api "${RUN_ENV[@]}" -e API_PORT=3000 "$IMAGE"
docker run -d --name nova-worker "${RUN_ENV[@]}" -e HEALTH_PORT=3001 "$IMAGE" node dist/entrypoints/worker.js

pnpm smoke --api http://localhost:3000 --worker http://localhost:3001 --release "$RELEASE"
