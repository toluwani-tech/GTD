// GET/PATCH/DELETE /projects/:id
import { PROJECT_STATUSES, HttpError, json, noContent, handle, methodNotAllowed, readBody, cleanText, checkStatus, getProject, need, parseId, now } from '../_lib/api.js';

export const onRequestGet = handle(async ({ env, params }) =>
  json(need(await getProject(env.DB, parseId(params, 'Project')), 'Project')));

export const onRequestPatch = handle(async ({ request, env, params }) => {
  const id = parseId(params, 'Project');
  const cur = need(await getProject(env.DB, id), 'Project');
  const b = await readBody(request);
  const name = b.name === undefined ? cur.name : cleanText(b.name, 'name');
  const status = b.status === undefined ? cur.status : checkStatus(b.status, PROJECT_STATUSES);
  await env.DB.prepare('UPDATE projects SET name=?, status=?, updated_at=? WHERE id=?').bind(name, status, now(), id).run();
  return json(await getProject(env.DB, id));
});

// Blocked with 409 while tasks remain; ?force=true unassigns them and deletes.
export const onRequestDelete = handle(async ({ request, env, params }) => {
  const id = parseId(params, 'Project');
  const p = need(await getProject(env.DB, id), 'Project');
  const { results: tasks } = await env.DB.prepare('SELECT id,title,status FROM tasks WHERE project_id = ? ORDER BY id').bind(id).all();
  const force = new URL(request.url).searchParams.get('force') === 'true';
  if (tasks.length && !force) {
    const list = tasks.map((t) => `#${t.id} "${t.title}"`).join(', ');
    throw new HttpError(409, `Project "${p.name}" still has ${tasks.length} task(s): ${list}. Move or delete them first, or retry with ?force=true to unassign them.`, { blocking_tasks: tasks });
  }
  await env.DB.batch([
    env.DB.prepare('UPDATE tasks SET project_id = NULL, updated_at = ? WHERE project_id = ?').bind(now(), id),
    env.DB.prepare('DELETE FROM projects WHERE id = ?').bind(id),
  ]);
  return noContent();
});

export const onRequest = methodNotAllowed;
