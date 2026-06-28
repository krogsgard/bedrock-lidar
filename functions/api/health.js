import { json } from './_lib.js';

export async function onRequest({ env }) {
  const checks = { d1: false, r2: false, ts: Date.now() };
  try {
    const r = await env.DB.prepare('SELECT 1 as ok').first();
    checks.d1 = !!r;
  } catch (e) {
    checks.d1_error = String(e).slice(0, 200);
  }
  try {
    // Cheap R2 head: list with limit=1
    const l = await env.STORAGE.list({ limit: 1 });
    checks.r2 = Array.isArray(l.objects);
    checks.r2_count = (l.objects || []).length;
  } catch (e) {
    checks.r2_error = String(e).slice(0, 200);
  }
  checks.healthy = checks.d1 && checks.r2;
  return json(checks, { status: checks.healthy ? 200 : 503 });
}
