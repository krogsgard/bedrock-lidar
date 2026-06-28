#!/usr/bin/env bash
# Bedrock job runner — process a single job through PDAL.
# Usage: ./run-job.sh BED-YYYYMMDD-XXXXXX
set -euo pipefail

JOB_ID="${1:?Usage: $0 BED-YYYYMMDD-XXXXXX}"
API="${BEDROCK_API:-https://lidar.weygand.com}"
BUCKET="${BEDROCK_BUCKET:-bedrock-lidar}"
WORK="${BEDROCK_WORK:-/tmp/bedrock/$JOB_ID}"
mkdir -p "$WORK"

log_event() {
  local stage="$1" level="$2" message="$3" meta="${4:-{}}"
  curl -fsS -X POST "$API/api/jobs/$JOB_ID/events" \
    -H 'content-type: application/json' \
    -d "$(printf '{"stage":"%s","level":"%s","message":%s,"meta":%s}' \
        "$stage" "$level" "$(jq -Rn --arg m "$message" '$m')" "$meta")" \
    >/dev/null || true
}

set_status() {
  curl -fsS -X PATCH "$API/api/jobs/$JOB_ID" \
    -H 'content-type: application/json' \
    -d "{\"status\":\"$1\"}" >/dev/null
}

fail() {
  local stage="$1" msg="$2"
  log_event "$stage" error "$msg"
  curl -fsS -X PATCH "$API/api/jobs/$JOB_ID" \
    -H 'content-type: application/json' \
    -d "$(jq -n --arg m "$msg" '{status:"failed", error_message:$m}')" >/dev/null
  exit 1
}

trap 'fail "runtime" "Runner crashed: line $LINENO"' ERR

# ─── 1. fetch job spec ───
JOB_JSON=$(curl -fsS "$API/api/jobs/$JOB_ID")
SRC_TYPE=$(echo "$JOB_JSON" | jq -r .source_type)
SRC_URL=$(echo "$JOB_JSON" | jq -r .source_url // empty)
CLASSIFIER=$(echo "$JOB_JSON" | jq -r .classifier)
UPLOAD_KEY=$(echo "$JOB_JSON" | jq -r .upload_key // empty)

log_event ingest info "Runner picked up job ($SRC_TYPE, $CLASSIFIER)"
set_status ingesting

# ─── 2. fetch source LAZ (idempotent: skip if RAW already on disk) ───
RAW="$WORK/raw.laz"
if [[ -s "$RAW" ]]; then
  log_event ingest info "RAW already on disk, skipping download"
else
case "$SRC_TYPE" in
  upload)
    aws s3 cp "s3://$BUCKET/$UPLOAD_KEY" "$RAW" --endpoint-url "$AWS_ENDPOINT_URL"
    ;;
  sample-copc)
    # SSRF defense: only fetch from a curated allowlist of hosts
    case "$SRC_URL" in
      https://s3.amazonaws.com/hobu-lidar/*|https://s3.amazonaws.com/usgs-lidar-public/*|https://s3-us-west-2.amazonaws.com/usgs-lidar-public/*)
        curl -fsSL --max-time 1800 "$SRC_URL" -o "$RAW"
        ;;
      *)
        fail ingest "source_url not on allowlist: $SRC_URL"
        ;;
    esac
    ;;
  usgs)
    # USGS EPT clip — uses readers.ept with optional bbox
    pdal pipeline /dev/stdin <<EOF
{ "pipeline": [
    { "type":"readers.ept", "filename":"$SRC_URL" },
    { "type":"writers.las", "filename":"$RAW", "compression":"laszip" }
  ] }
EOF
    ;;
  *) fail ingest "unknown source_type: $SRC_TYPE" ;;
esac
fi

RAW_BYTES=$(stat -c%s "$RAW")
log_event ingest info "Source ready ($((RAW_BYTES / 1048576)) MB)"

curl -fsS -X PATCH "$API/api/jobs/$JOB_ID" \
  -H 'content-type: application/json' \
  -d "{\"raw_bytes\":$RAW_BYTES}" >/dev/null

# ─── 3. normalize (denoise, SOR, range filter) ───
set_status normalizing
NORM="$WORK/norm.laz"
if [[ -s "$NORM" ]]; then
  log_event normalize info "NORM already on disk, skipping"
else
log_event normalize info "Running SOR + outlier filter"
pdal pipeline /dev/stdin <<EOF
{ "pipeline": [
    "$RAW",
    { "type":"filters.outlier", "method":"statistical", "mean_k":12, "multiplier":2.2 },
    { "type":"filters.range", "limits":"Classification![7:7]" },
    { "type":"writers.las", "filename":"$NORM", "compression":"laszip" }
  ] }
EOF
fi

# ─── 4. classify ───
set_status classifying
CLAS="$WORK/classified.copc.laz"
if [[ -s "$CLAS" ]]; then
  log_event classify info "CLAS already on disk, skipping classification"
else

case "$CLASSIFIER" in
  csf)
    log_event classify info "CSF (Cloth Simulation Filter): rigidness=3, cloth=0.5"
    pdal pipeline /dev/stdin <<EOF
{ "pipeline": [
    "$NORM",
    { "type":"filters.assign", "value":"Classification = 1" },
    { "type":"filters.csf", "resolution":0.5, "rigidness":3, "threshold":0.5 },
    { "type":"writers.copc", "filename":"$CLAS" }
  ] }
EOF
    ;;
  smrf)
    log_event classify info "SMRF (Simple Morphological): slope=0.20, window=18, threshold=0.45"
    pdal pipeline /dev/stdin <<EOF
{ "pipeline": [
    "$NORM",
    { "type":"filters.assign", "value":"Classification = 1" },
    { "type":"filters.smrf", "slope":0.20, "window":18, "threshold":0.45, "cell":1.0 },
    { "type":"writers.copc", "filename":"$CLAS" }
  ] }
EOF
    ;;
  ptv3)
    log_event classify warn "PTv3 not yet wired — falling back to CSF baseline" '{"fallback":"csf"}'
    pdal pipeline /dev/stdin <<EOF
{ "pipeline": [
    "$NORM",
    { "type":"filters.assign", "value":"Classification = 1" },
    { "type":"filters.csf", "resolution":0.5, "rigidness":3, "threshold":0.5 },
    { "type":"writers.copc", "filename":"$CLAS" }
  ] }
EOF
    ;;
  *) fail classify "unknown classifier: $CLASSIFIER" ;;
esac
fi

# capture stats
STATS=$(pdal info --metadata "$CLAS" 2>/dev/null | jq -c '.metadata // {}')
POINT_COUNT=$(pdal info --summary "$CLAS" 2>/dev/null | jq -r '.summary.num_points')
log_event classify info "Classification complete: $POINT_COUNT points" "$(jq -n --arg p "$POINT_COUNT" '{point_count:$p}')"

# ─── 5. export DTM (1m raster) ───
set_status exporting
DTM="$WORK/dtm.tif"
log_event export info "Rasterizing DTM (1m, IDW)"
pdal pipeline /dev/stdin <<EOF
{ "pipeline": [
    "$CLAS",
    { "type":"filters.range", "limits":"Classification[2:2]" },
    { "type":"writers.gdal", "filename":"$DTM",
      "resolution":1.0, "output_type":"idw", "window_size":4 }
  ] }
EOF

# ─── 6. export 1ft contours ───
CONTOURS_DIR="$WORK/contours"
mkdir -p "$CONTOURS_DIR"
log_event export info "Generating 1ft contours (gdal_contour)"
gdal_contour -i 0.3048 -snodata 0 -a elev "$DTM" "$CONTOURS_DIR/contours.shp"
( cd "$WORK" && zip -qr contours.shp.zip contours )

# ─── 7. upload artifacts to R2 ───
CLAS_KEY="jobs/$JOB_ID/classified.copc.laz"
DTM_KEY="jobs/$JOB_ID/dtm.tif"
CON_KEY="jobs/$JOB_ID/contours.shp.zip"
LAS_KEY="jobs/$JOB_ID/final.las"

aws s3 cp "$CLAS" "s3://$BUCKET/$CLAS_KEY" --endpoint-url "$AWS_ENDPOINT_URL"
aws s3 cp "$DTM"  "s3://$BUCKET/$DTM_KEY"  --endpoint-url "$AWS_ENDPOINT_URL"
aws s3 cp "$WORK/contours.shp.zip" "s3://$BUCKET/$CON_KEY" --endpoint-url "$AWS_ENDPOINT_URL"

# emit a plain LAS too for legacy CAD ingest
pdal translate "$CLAS" "$WORK/final.las"
aws s3 cp "$WORK/final.las" "s3://$BUCKET/$LAS_KEY" --endpoint-url "$AWS_ENDPOINT_URL"

curl -fsS -X PATCH "$API/api/jobs/$JOB_ID" \
  -H 'content-type: application/json' \
  -d "$(jq -n \
      --arg cl "$CLAS_KEY" --arg dt "$DTM_KEY" --arg co "$CON_KEY" --arg la "$LAS_KEY" \
      --arg pc "$POINT_COUNT" \
      '{status:"complete", classified_key:$cl, dtm_key:$dt, contours_key:$co, las_key:$la, point_count:($pc|tonumber)}')" >/dev/null

log_event deliver info "Job complete — all artifacts in R2"

# cleanup local work
rm -rf "$WORK"

echo "Job $JOB_ID complete."
