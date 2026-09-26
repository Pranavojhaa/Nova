#!/usr/bin/env bash
# Deploys one image digest to one environment: migrate (Cloud Run job), then worker, then API.
# Migrations are forward-only and must stay compatible with the release still serving traffic.
set -euo pipefail
: "${GCP_PROJECT_ID:?}" "${GCP_REGION:?}" "${NOVA_ENV:?}" "${IMAGE:?}" "${SQL_CONNECTION:?}" "${RUNTIME_SA:?}"
if [[ "$NOVA_ENV" != "prod" && -z "${NOVA_RECIPIENT_ALLOWLIST:-}" ]]; then
  echo "NOVA_RECIPIENT_ALLOWLIST must be set for non-prod environments (NOVA_ENV=${NOVA_ENV}); refusing before touching GCP" >&2
  exit 1
fi
WORKER_MIN="${WORKER_MIN_INSTANCES:-1}"

COMMON=(--project "$GCP_PROJECT_ID" --region "$GCP_REGION" --quiet)
# ^;^ switches gcloud's list delimiter so the comma-separated allowlist survives intact.
ENV_VARS="^;^NOVA_ENV=${NOVA_ENV};LOG_LEVEL=info"
if [[ -n "${NOVA_RECIPIENT_ALLOWLIST:-}" ]]; then
  ENV_VARS="${ENV_VARS};NOVA_RECIPIENT_ALLOWLIST=${NOVA_RECIPIENT_ALLOWLIST}"
fi
SECRETS="DATABASE_URL=DATABASE_URL:latest,NOVA_MASTER_KEY=NOVA_MASTER_KEY:latest"
RUNTIME=(--service-account "$RUNTIME_SA" --set-cloudsql-instances "$SQL_CONNECTION" --set-secrets "$SECRETS")

echo "==> migrate"
gcloud run jobs deploy nova-migrate "${COMMON[@]}" "${RUNTIME[@]}" \
  --image "$IMAGE" --command node --args dist/entrypoints/migrate.js \
  --set-env-vars "$ENV_VARS" --max-retries 0 --task-timeout 10m
gcloud run jobs execute nova-migrate "${COMMON[@]}" --wait

echo "==> worker"
gcloud run deploy nova-worker "${COMMON[@]}" "${RUNTIME[@]}" \
  --image "$IMAGE" --command node --args dist/entrypoints/worker.js \
  --set-env-vars "${ENV_VARS};HEALTH_PORT=8080" --port 8080 \
  --no-allow-unauthenticated --ingress internal \
  --no-cpu-throttling --cpu 1 --memory 512Mi \
  --min-instances "$WORKER_MIN" --max-instances 1

echo "==> api"
gcloud run deploy nova-api "${COMMON[@]}" "${RUNTIME[@]}" \
  --image "$IMAGE" --command node --args dist/entrypoints/api.js \
  --set-env-vars "$ENV_VARS" --port 3000 \
  --allow-unauthenticated --cpu 1 --memory 512Mi \
  --min-instances 0 --max-instances 3

API_URL="$(gcloud run services describe nova-api "${COMMON[@]}" --format 'value(status.url)')"
echo "api_url=${API_URL}"
if [[ -n "${GITHUB_OUTPUT:-}" ]]; then echo "api_url=${API_URL}" >>"$GITHUB_OUTPUT"; fi
