// GET/PATCH/DELETE /tasks/:id
import { TASK_STATUSES, json, noContent, handle, methodNotAllowed, readBody, cleanText, checkStatus, checkProjectId, getTask, need, parseId, now } from '../_lib/api.js';

export const onRequestGet = handle(async ({ env, params }) =>
  json(need(await getTask(env.DB, parseId(params, 'Task')), 'Task')));

export const onRequestPatch = handle(async ({ request, env, params }) => {
  const id = parseId(params, 'Task');
  const cur = need(await getTask(env.DB, id), 'Task');
  const b = await readBody(request);
  const next = { title: cur.title, status: cur.status, project_id: cur.project_id };
  if (b.title !== undefined) next.title = cleanText(b.title, 'title');
  if (b.status !== undefined) next.status = checkStatus(b.status, TASK_STATUSES);
  if (b.project_id !== undefined) next.project_id = await checkProjectId(env.DB, b.project_id);
  await env.DB.prepare('UPDATE tasks SET title=?, status=?, project_id=?, updated_at=? WHERE id=?')
    .bind(next.title, next.status, next.project_id, now(), id).run();
  return json(await getTask(env.DB, id));
});

export const onRequestDelete = handle(async ({ env, params }) => {
  const id = parseId(params, 'Task');
  need(await getTask(env.DB, id), 'Task');
  await env.DB.prepare('DELETE FROM tasks WHERE id = ?').bind(id).run();
  return noContent();
});

export const onRequest = methodNotAllowed;
