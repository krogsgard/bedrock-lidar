// POST /api/jobs/:id/upload  — direct upload (v0: simple single-part PUT, max ~95MB on CF Pages)
// For large LAZ this will eventually move to multipart presigned URLs; v0 supports small
// demo files only. For real tracts we expect the source-type='usgs' path that streams
// from an existing public URL on the worker side.
import { json, bad, corsPreflight, logEvent, setJobStatus, isValidJobId } from '../../_lib.js';

const MAX_UPLOAD_BYTES = 95 * 1024 * 1024; // ~95MB — CF Pages Functions request cap

export const onRequestOptions = () => corsPreflight();

export async function onRequestPost({ env, request, params }) {
  const id = params.id;
  if (!isValidJobId(id)) return bad('invalid id format');

  // Cheap pre-check from Content-Length before buffering
  const cl = request.headers.get('content-length');
  if (cl && Number(cl) > MAX_UPLOAD_BYTES) {
    return bad(`upload too large (max ${MAX_UPLOAD_BYTES} bytes; use sample-copc or usgs sources for large tracts)`, 413);
  }

  const job = await env.DB.prepare(`SELECT * FROM jobs WHERE id = ?`).bind(id).first();
  if (!job) return bad('job not found', 404);
  if (job.source_type !== 'upload') return bad('this job is not an upload job');

  await setJobStatus(env, id, 'uploading');
  await logEvent(env, id, 'ingest', 'Upload started', 'info');

  const body = await request.arrayBuffer();
  if (body.byteLength > MAX_UPLOAD_BYTES) {
    await setJobStatus(env, id, 'failed', { error_message: 'upload exceeded max size' });
    return bad('upload exceeded max size', 413);
  }
  const key = job.upload_key || `uploads/${id}/raw.laz`;

  await env.STORAGE.put(key, body, {
    httpMetadata: {
      contentType: 'application/octet-stream',
    },
    customMetadata: {
      job_id: id,
      uploaded_at: String(Date.now()),
    },
  });

  await setJobStatus(env, id, 'queued', { upload_key: key, raw_bytes: body.byteLength });
  await logEvent(env, id, 'ingest', `Upload complete (${body.byteLength} bytes)`, 'info');

  return json({ ok: true, key, bytes: body.byteLength, status: 'queued' });
}
