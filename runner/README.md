# Bedrock Runner

The runner is a headless worker that polls `/api/jobs?status=queued`, processes each one through PDAL, and writes artifacts back to R2 + status back to D1.

It is intentionally portable — a Bash + Python + PDAL stack that runs on any Linux box (or container) with:

- PDAL ≥ 2.7 (with the `filters.csf`, `filters.smrf`, `readers.copc`, `readers.ept`, `writers.copc`, `writers.gdal` plugins)
- Python 3.10+
- `aws` CLI configured for R2 (S3-compatible)
- `gdal_contour` (for contour export)
- `entwine` (optional — for re-tiling EPT clips)
- `rclone` (optional — easier R2 mounting)

## Architecture

```
poll-jobs.sh    ──► picks the oldest queued job
   │
   ▼
run-job.sh JOB_ID ──► fetches job spec, runs the pipeline, posts events
   │
   ├── stage:ingest    (download or clip source LAZ/EPT)
   ├── stage:normalize (denoise + SOR + range filter)
   ├── stage:classify  (CSF / SMRF / PTv3-hook)
   ├── stage:qc        (apply qc_ops delta, if any)
   ├── stage:export    (write classified COPC + DTM + contours)
   └── stage:deliver   (upload to R2, mark job complete)
```

Every stage:

1. Posts a `POST /api/jobs/:id/events` with `{stage, level, message, meta}`
2. On success, advances `status` via `PATCH /api/jobs/:id`
3. On failure, sets `status=failed` and `error_message`

## Local invocation

```bash
export BEDROCK_API=https://lidar.weygand.com
export BEDROCK_OWNER=runner@bedrock-lidar.local
export AWS_ACCESS_KEY_ID=...        # R2 access key
export AWS_SECRET_ACCESS_KEY=...
export AWS_ENDPOINT_URL=https://<account>.r2.cloudflarestorage.com
export BEDROCK_BUCKET=bedrock-lidar

./poll-jobs.sh                      # daemon loop
./run-job.sh BED-20260628-XXXXXX   # one-off
```

## What's NOT done yet (Phase 1)

- PTv3 inference container (uses ONNX Runtime + Open3D — separate image)
- Tile-aware processing for tracts > 4GB
- Multi-tenant R2 path isolation
- GPU autoscaling on DO

These are spec'd in `docs/runner-roadmap.md`.
