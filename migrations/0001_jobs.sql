-- Bedrock D1 schema, v0
-- Tracks LIDAR jobs from upload → classify → QC → export.

CREATE TABLE IF NOT EXISTS jobs (
  id            TEXT PRIMARY KEY,                -- BED-YYYYMMDD-NNNN
  name          TEXT NOT NULL,                   -- user-friendly job name
  status        TEXT NOT NULL DEFAULT 'pending', -- pending|uploading|queued|normalizing|classifying|qc|exporting|complete|failed
  source_type   TEXT NOT NULL,                   -- 'upload' | 'usgs' | 'sample-copc'
  source_url    TEXT,                            -- for usgs/sample: original LAZ/EPT URL
  upload_key    TEXT,                            -- R2 key under uploads/
  raw_bytes     INTEGER DEFAULT 0,
  point_count   INTEGER DEFAULT 0,
  bbox_min_x    REAL,
  bbox_min_y    REAL,
  bbox_min_z    REAL,
  bbox_max_x    REAL,
  bbox_max_y    REAL,
  bbox_max_z    REAL,
  crs           TEXT,                            -- EPSG code stored as 'EPSG:XXXX'
  classifier    TEXT DEFAULT 'csf',              -- 'csf' | 'smrf' | 'ptv3' | 'spt'
  classified_key TEXT,                           -- R2 key for classified.copc.laz
  dtm_key       TEXT,                            -- R2 key for dtm.tif
  contours_key  TEXT,                            -- R2 key for contours.shp.zip
  las_key       TEXT,                            -- R2 key for final.las
  edits_count   INTEGER DEFAULT 0,
  owner_email   TEXT,                            -- creator
  created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  started_at    INTEGER,
  completed_at  INTEGER,
  error_message TEXT,
  notes         TEXT
);

CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_owner  ON jobs(owner_email);
CREATE INDEX IF NOT EXISTS idx_jobs_created ON jobs(created_at);

-- Pipeline event log — every stage transition, error, metric
CREATE TABLE IF NOT EXISTS job_events (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id    TEXT NOT NULL,
  ts        INTEGER NOT NULL DEFAULT (unixepoch()),
  stage     TEXT NOT NULL,                       -- ingest|normalize|classify|qc|export|deliver
  level     TEXT NOT NULL DEFAULT 'info',        -- info|warn|error
  message   TEXT,
  meta_json TEXT,
  FOREIGN KEY(job_id) REFERENCES jobs(id)
);
CREATE INDEX IF NOT EXISTS idx_job_events_job ON job_events(job_id, ts);

-- QC edits ops log (mirrors the R2 ops.jsonl in queryable form)
CREATE TABLE IF NOT EXISTS qc_ops (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id    TEXT NOT NULL,
  ts        INTEGER NOT NULL DEFAULT (unixepoch()),
  user_email TEXT,
  op_type   TEXT NOT NULL,                       -- brush|polygon|single|undo|redo|filter
  from_class INTEGER,
  to_class   INTEGER,
  geom_json TEXT,                                -- polygon coords or brush center+radius
  point_count INTEGER DEFAULT 0,
  FOREIGN KEY(job_id) REFERENCES jobs(id)
);
CREATE INDEX IF NOT EXISTS idx_qc_ops_job ON qc_ops(job_id, ts);
