// GET    /api/jobs/:id  — job detail + recent events
// PATCH  /api/jobs/:id  — update status / fields (demo: open auth)
// DELETE /api/jobs/:id  — delete job + cascade
import { json, bad, corsPreflight, logEvent, isValidJobId } from '../_lib.js';

export const onRequestOptions = () => corsPreflight();

export async function onRequestGet({ env, params }) {
  const id = params.id;
  if (!isValidJobId(id)) return bad('invalid id format');
  const job = await env.DB.prepare(`SELECT * FROM jobs WHERE id = ?`).bind(id).first();
  if (!job) return bad('not found', 404);

  const { results: events } = await env.DB.prepare(
    `SELECT id, ts, stage, level, message, meta_json FROM job_events WHERE job_id = ? ORDER BY ts DESC LIMIT 100`
  ).bind(id).all();

  const { results: ops } = await env.DB.prepare(
    `SELECT id, ts, user_email, op_type, from_class, to_class, geom_json, point_count
     FROM qc_ops WHERE job_id = ? ORDER BY ts DESC LIMIT 200`
  ).bind(id).all();

  return json({ job, events: events || [], qc_ops: ops || [] });
}

export async function onRequestPatch({ env, request, params }) {
  const id = params.id;
  if (!isValidJobId(id)) return bad('invalid id format');
  let body;
  try { body = await request.json(); } catch { return bad('invalid json'); }

  const allowed = ['name', 'status', 'classifier', 'notes', 'classified_key', 'dtm_key',
    'contours_key', 'las_key', 'point_count', 'raw_bytes', 'crs',
    'bbox_min_x', 'bbox_min_y', 'bbox_min_z', 'bbox_max_x', 'bbox_max_y', 'bbox_max_z',
    'error_message', 'started_at', 'completed_at'];

  const fields = [];
  const binds = [];
  for (const k of allowed) {
    if (k in body) {
      fields.push(`${k} = ?`);
      binds.push(body[k]);
    }
  }
  if (!fields.length) return bad('no updatable fields');

  fields.push('updated_at = unixepoch()');
  binds.push(id);

  const r = await env.DB.prepare(`UPDATE jobs SET ${fields.join(', ')} WHERE id = ?`).bind(...binds).run();
  if (!r.meta || r.meta.changes === 0) return bad('not found', 404);

  if (body.status) await logEvent(env, id, 'status', `status → ${body.status}`, 'info');
  return json({ ok: true });
}

export async function onRequestDelete({ env, params }) {
  const id = params.id;
  if (!isValidJobId(id)) return bad('invalid id format');
  // Cascade
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM qc_ops WHERE job_id = ?`).bind(id),
    env.DB.prepare(`DELETE FROM job_events WHERE job_id = ?`).bind(id),
    env.DB.prepare(`DELETE FROM jobs WHERE id = ?`).bind(id),
  ]);
  // Best-effort R2 cleanup
  try {
    const list = await env.STORAGE.list({ prefix: `uploads/${id}/` });
    for (const o of list.objects || []) await env.STORAGE.delete(o.key);
    const j = await env.STORAGE.list({ prefix: `jobs/${id}/` });
    for (const o of j.objects || []) await env.STORAGE.delete(o.key);
  } catch (e) {
    console.warn('R2 cleanup failed', e);
  }
  return json({ ok: true });
}
