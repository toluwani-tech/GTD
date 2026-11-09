// Shared helpers for the Pages Functions. Same rules as the Node server's src/server.js.
export const TASK_STATUSES = ['inbox', 'next', 'waiting', 'done'];
export const PROJECT_STATUSES = ['active', 'someday', 'archive'];

export class HttpError extends Error {
  constructor(status, message, extra = {}) { super(message); this.status = status; this.extra = extra; }
}

export const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
export const noContent = () => new Response(null, { status: 204 });

// Wraps a handler so thrown HttpErrors become JSON error responses.
export const handle = (fn) => async (ctx) => {
  try { return await fn(ctx); }
  catch (e) {
    if (e instanceof HttpError) return json({ error: e.message, ...e.extra }, e.status);
    console.error(e);
    return json({ error: 'Internal server error' }, 500);
  }
};
export const methodNotAllowed = handle(async () => { throw new HttpError(405, 'Method not allowed'); });

export async function readBody(request) {
  const raw = await request.text();
  let body;
  if (raw) { try { body = JSON.parse(raw); } catch { throw new HttpError(400, 'Invalid JSON body'); } }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Body must be a JSON object');
  return body;
}

export function cleanText(v, field) {
  if (typeof v !== 'string' || !v.trim()) throw new HttpError(400, `${field} is required and must be a non-empty string`);
  const t = v.trim();
  if (t.length > 200) throw new HttpError(400, `${field} must be 200 characters or fewer`);
  return t;
}
export function checkStatus(v, allowed) {
  if (!allowed.includes(v)) throw new HttpError(400, `Invalid status "${v}". Allowed: ${allowed.join(', ')}`);
  return v;
}
export const now = () => new Date().toISOString();

// "/tasks/abc" or an unknown id is simply "not found".
export function parseId(params, what) {
  if (!/^\d+$/.test(String(params.id))) throw new HttpError(404, `${what} not found`);
  return Number(params.id);
}
export const getTask = (db, id) => db.prepare('SELECT * FROM tasks WHERE id = ?').bind(id).first();
export const getProject = (db, id) => db.prepare('SELECT * FROM projects WHERE id = ?').bind(id).first();
export const need = (row, what) => { if (!row) throw new HttpError(404, `${what} not found`); return row; };

export async function checkProjectId(db, pid) {
  if (pid === null) return null;
  if (!Number.isInteger(pid)) throw new HttpError(400, 'project_id must be an integer or null');
  if (!(await getProject(db, pid))) throw new HttpError(400, `project_id ${pid} does not exist`);
  return pid;
}
