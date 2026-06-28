#!/usr/bin/env bash
# Bedrock runner daemon — polls the API for queued jobs and dispatches them.
# Designed for one-job-at-a-time on a single GPU droplet. For horizontal scale,
# run multiple instances with a shared visibility lock (TODO: cf-queues).
set -euo pipefail

API="${BEDROCK_API:-https://lidar.weygand.com}"
INTERVAL="${BEDROCK_POLL_INTERVAL:-15}"
HERE="$(cd "$(dirname "$0")" && pwd)"

echo "[bedrock-runner] polling $API every ${INTERVAL}s"

while true; do
  # Look for the oldest queued job
  JOB_ID=$(curl -fsS "$API/api/jobs?status=queued" \
    | jq -r '.jobs | sort_by(.created_at) | .[0].id // empty')

  if [[ -n "$JOB_ID" ]]; then
    echo "[$(date -Is)] dispatching $JOB_ID"
    if ! "$HERE/run-job.sh" "$JOB_ID"; then
      echo "[$(date -Is)] $JOB_ID failed (see job event log)"
    fi
  fi

  sleep "$INTERVAL"
done
