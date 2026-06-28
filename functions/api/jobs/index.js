// GET  /api/jobs       — list jobs (most-recent 50)
// POST /api/jobs       — create a new job
import { json, bad, corsPreflight, generateJobId, getOwner, logEvent, isAllowedSourceUrl } from '../_lib.js';

export const onRequestOptions = () => corsPreflight();

export async function onRequestGet({ env, request }) {
  const url = new URL(request.url);
  const status = url.searchParams.get('status');
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 200);
  const owner = url.searchParams.get('owner');

  const filters = [];
  const binds = [];
  if (status) { filters.push('status = ?'); binds.push(status); }
  if (owner) { filters.push('owner_email = ?'); binds.push(owner); }

  const where = filters.length ? 'WHERE ' + filters.join(' AND ') : '';
  binds.push(limit);

  const stmt = env.DB.prepare(
    `SELECT id, name, status, source_type, source_url, raw_bytes, point_count,
            classifier, classified_key, dtm_key, contours_key, las_key, edits_count,
            owner_email, created_at, updated_at, started_at, completed_at, error_message,
            bbox_min_x, bbox_min_y, bbox_min_z, bbox_max_x, bbox_max_y, bbox_max_z, crs
     FROM jobs ${where} ORDER BY created_at DESC LIMIT ?`
  ).bind(...binds);

  const { results } = await stmt.all();
  return json({ jobs: results || [], count: (results || []).length });
}

export async function onRequestPost({ env, request }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return bad('invalid json');
  }
  const name = (body.name || '').trim();
  const sourceType = body.source_type || 'upload';
  const sourceUrl = (body.source_url || '').trim() || null;
  const classifier = body.classifier || 'csf';
  const notes = (body.notes || '').trim() || null;

  if (!name) return bad('name required');
  if (!['upload', 'usgs', 'sample-copc'].includes(sourceType)) {
    return bad('source_type must be upload|usgs|sample-copc');
  }
  if (!['csf', 'smrf', 'ptv3', 'spt'].includes(classifier)) {
    return bad('classifier must be csf|smrf|ptv3|spt');
  }
  if (sourceType !== 'upload' && !sourceUrl) {
    return bad('source_url required for usgs/sample-copc');
  }
  if (sourceType !== 'upload' && !isAllowedSourceUrl(sourceUrl)) {
    return bad('source_url not on the public-LIDAR allowlist (Hobu/USGS hosts only)', 422);
  }
  // Cap name length to prevent DOS / log spam
  if (name.length > 200) return bad('name too long (max 200 chars)');

  const id = generateJobId();
  const owner = getOwner(request);
  const initialStatus = sourceType === 'upload' ? 'pending' : 'queued';
  const uploadKey = sourceType === 'upload' ? `uploads/${id}/raw.laz` : null;

  await env.DB.prepare(
    `INSERT INTO jobs (id, name, status, source_type, source_url, upload_key, classifier, owner_email, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(id, name, initialStatus, sourceType, sourceUrl, uploadKey, classifier, owner, notes)
    .run();

  await logEvent(env, id, 'ingest', `Job created (${sourceType}, ${classifier})`, 'info', { sourceUrl, classifier });

  return json({ id, status: initialStatus, upload_key: uploadKey });
}
