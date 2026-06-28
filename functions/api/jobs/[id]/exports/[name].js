// GET /api/jobs/:id/exports/:name — proxy/redirect to R2 object for an artifact
// name ∈ {classified, dtm, contours, las}
import { json, bad, corsPreflight } from '../../../_lib.js';

export const onRequestOptions = () => corsPreflight();

const FIELD_MAP = {
  classified: 'classified_key',
  dtm: 'dtm_key',
  contours: 'contours_key',
  las: 'las_key',
};
const CONTENT_TYPES = {
  classified: 'application/octet-stream',
  dtm: 'image/tiff',
  contours: 'application/zip',
  las: 'application/octet-stream',
};

export async function onRequestGet({ env, params }) {
  const id = params.id;
  const name = params.name;
  const field = FIELD_MAP[name];
  if (!field) return bad('unknown export name');

  const job = await env.DB.prepare(`SELECT ${field} as key FROM jobs WHERE id = ?`).bind(id).first();
  if (!job) return bad('not found', 404);
  if (!job.key) return bad('artifact not yet generated', 425);

  const obj = await env.STORAGE.get(job.key);
  if (!obj) return bad('artifact missing in storage', 410);

  return new Response(obj.body, {
    headers: {
      'content-type': CONTENT_TYPES[name] || 'application/octet-stream',
      'content-length': obj.size,
      'content-disposition': `attachment; filename="${id}-${name}${name === 'dtm' ? '.tif' : name === 'contours' ? '.zip' : '.las'}"`,
      'cache-control': 'private, max-age=300',
    },
  });
}
