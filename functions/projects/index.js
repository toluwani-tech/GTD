// GET /projects   POST /projects
import { PROJECT_STATUSES, json, handle, methodNotAllowed, readBody, cleanText, checkStatus, getProject, now } from '../_lib/api.js';

export const onRequestGet = handle(async ({ env }) => {
  const { results } = await env.DB.prepare(`
    SELECT p.*, (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id) AS task_count
    FROM projects p ORDER BY p.id`).all();
  return json(results);
});

export const onRequestPost = handle(async ({ request, env }) => {
  const b = await readBody(request);
  const name = cleanText(b.name, 'name');
  const status = b.status === undefined ? 'active' : checkStatus(b.status, PROJECT_STATUSES);
  const ts = now();
  const r = await env.DB.prepare('INSERT INTO projects (name,status,created_at,updated_at) VALUES (?,?,?,?)')
    .bind(name, status, ts, ts).run();
  return json({ ...(await getProject(env.DB, r.meta.last_row_id)), task_count: 0 }, 201);
});

export const onRequest = methodNotAllowed;
