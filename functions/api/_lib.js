// Shared helpers for Bedrock Pages Functions

export function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    status: init.status || 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS',
      'access-control-allow-headers': 'content-type, x-bedrock-key',
      'cache-control': 'no-store',
      ...(init.headers || {}),
    },
  });
}

export function corsPreflight() {
  return new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS',
      'access-control-allow-headers': 'content-type, x-bedrock-key',
      'access-control-max-age': '86400',
    },
  });
}

export function bad(message, status = 400) {
  return json({ error: message }, { status });
}

// Generate a job ID: BED-YYYYMMDD-XXXX (6-char base32 suffix)
export function generateJobId() {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  const rand = crypto.getRandomValues(new Uint8Array(4));
  const suffix = Array.from(rand, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 6).toUpperCase();
  return `BED-${y}${m}${day}-${suffix}`;
}

export async function logEvent(env, jobId, stage, message, level = 'info', meta = null) {
  try {
    await env.DB.prepare(
      `INSERT INTO job_events (job_id, stage, level, message, meta_json) VALUES (?, ?, ?, ?, ?)`
    )
      .bind(jobId, stage, level, message || '', meta ? JSON.stringify(meta) : null)
      .run();
  } catch (e) {
    console.error('logEvent failed', e);
  }
}

export async function setJobStatus(env, jobId, status, extras = {}) {
  const fields = ['status = ?', 'updated_at = unixepoch()'];
  const binds = [status];
  for (const [k, v] of Object.entries(extras)) {
    fields.push(`${k} = ?`);
    binds.push(v);
  }
  binds.push(jobId);
  await env.DB.prepare(
    `UPDATE jobs SET ${fields.join(', ')} WHERE id = ?`
  )
    .bind(...binds)
    .run();
}

// Light "owner" identity. v0: trust an X-Bedrock-Key header, or default to 'demo'.
// Phase 1: swap to Cloudflare Access JWT or email magic-link.
export function getOwner(request) {
  const k = request.headers.get('x-bedrock-key');
  if (k && k.length > 4 && k.length < 256) return k.slice(0, 200);
  return 'demo@bedrock-lidar.local';
}

// SSRF defense: only allow source URLs from a curated allowlist of public LIDAR hosts.
// Phase 1 will let admins extend this per-tenant. Keep tight in v0.
const SOURCE_URL_ALLOWLIST = [
  /^https:\/\/s3\.amazonaws\.com\/hobu-lidar\//,
  /^https:\/\/s3\.amazonaws\.com\/usgs-lidar-public\//,
  /^https:\/\/s3-us-west-2\.amazonaws\.com\/usgs-lidar-public\//,
  /^https:\/\/lidar\.weygand\.com\//,
];
export function isAllowedSourceUrl(u) {
  if (typeof u !== 'string' || u.length > 2048) return false;
  try {
    const url = new URL(u);
    if (url.protocol !== 'https:') return false;
  } catch {
    return false;
  }
  return SOURCE_URL_ALLOWLIST.some((rx) => rx.test(u));
}

// Job ID format guard — defends listing/detail endpoints from path tricks.
const JOB_ID_RX = /^BED-\d{8}-[A-Z0-9]{4,8}$/;
export function isValidJobId(id) {
  return typeof id === 'string' && JOB_ID_RX.test(id);
}
