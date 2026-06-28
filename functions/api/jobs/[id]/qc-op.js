// POST /api/jobs/:id/qc-op — record a QC reclassification operation
import { json, bad, corsPreflight, getOwner } from '../../_lib.js';

export const onRequestOptions = () => corsPreflight();

export async function onRequestPost({ env, request, params }) {
  const id = params.id;
  let body;
  try { body = await request.json(); } catch { return bad('invalid json'); }
  const opType = body.op_type;
  if (!['brush', 'polygon', 'single', 'undo', 'redo', 'filter'].includes(opType)) {
    return bad('op_type must be brush|polygon|single|undo|redo|filter');
  }
  const fromClass = body.from_class ?? null;
  const toClass = body.to_class ?? null;
  const geom = body.geom_json ? JSON.stringify(body.geom_json) : null;
  const cnt = body.point_count || 0;
  const user = getOwner(request);

  await env.DB.prepare(
    `INSERT INTO qc_ops (job_id, user_email, op_type, from_class, to_class, geom_json, point_count) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, user, opType, fromClass, toClass, geom, cnt).run();

  await env.DB.prepare(`UPDATE jobs SET edits_count = edits_count + 1, updated_at = unixepoch() WHERE id = ?`).bind(id).run();

  return json({ ok: true });
}
