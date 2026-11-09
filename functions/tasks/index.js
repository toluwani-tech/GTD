// GET /tasks   POST /tasks
import { TASK_STATUSES, HttpError, json, handle, methodNotAllowed, readBody, cleanText, checkStatus, checkProjectId, getTask, now } from '../_lib/api.js';

export const onRequestGet = handle(async ({ request, env }) => {
  const qs = new URL(request.url).searchParams;
  const where = []; const args = [];
  if (qs.has('status')) { where.push('status = ?'); args.push(checkStatus(qs.get('status'), TASK_STATUSES)); }
  if (qs.has('project_id')) {
    const v = qs.get('project_id');
    if (!/^\d+$/.test(v)) throw new HttpError(400, 'project_id must be an integer');
    where.push('project_id = ?'); args.push(Number(v));
  }
  const sql = `SELECT * FROM tasks ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC`;
  const { results } = await env.DB.prepare(sql).bind(...args).all();
  return json(results);
});

export const onRequestPost = handle(async ({ request, env }) => {
  const b = await readBody(request);
  const title = cleanText(b.title, 'title');
  // A valid status is accepted but ignored: new tasks always start in the inbox.
  if (b.status !== undefined) checkStatus(b.status, TASK_STATUSES);
  const pid = b.project_id === undefined ? null : await checkProjectId(env.DB, b.project_id);
  const ts = now();
  const r = await env.DB.prepare('INSERT INTO tasks (title,status,project_id,created_at,updated_at) VALUES (?,?,?,?,?)')
    .bind(title, 'inbox', pid, ts, ts).run();
  return json(await getTask(env.DB, r.meta.last_row_id), 201);
});

export const onRequest = methodNotAllowed; // any other method
