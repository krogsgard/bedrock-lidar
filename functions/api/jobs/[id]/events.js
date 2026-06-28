// POST /api/jobs/:id/events — runner (DO/Modal) reports stage transitions, metrics
import { json, bad, corsPreflight, logEvent } from '../../_lib.js';

export const onRequestOptions = () => corsPreflight();

export async function onRequestPost({ env, request, params }) {
  const id = params.id;
  let body;
  try { body = await request.json(); } catch { return bad('invalid json'); }
  const stage = body.stage || 'unknown';
  const level = body.level || 'info';
  const msg = body.message || '';
  const meta = body.meta || null;
  await logEvent(env, id, stage, msg, level, meta);
  return json({ ok: true });
}

export async function onRequestGet({ env, params }) {
  const { results } = await env.DB.prepare(
    `SELECT id, ts, stage, level, message, meta_json FROM job_events WHERE job_id = ? ORDER BY ts DESC LIMIT 200`
  ).bind(params.id).all();
  return json({ events: results || [] });
}
