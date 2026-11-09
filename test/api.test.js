'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');

const base = process.env.BASE_URL || 'http://localhost:8788'; // run `npm run dev` first (fresh local DB)

async function call(method, url, body) {
  const res = await fetch(base + url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

test('seed data: 3 projects, 8 tasks across all four statuses', async () => {
  const projects = (await call('GET', '/projects')).body;
  const tasks = (await call('GET', '/tasks')).body;
  assert.equal(projects.length, 3);
  assert.equal(tasks.length, 8);
  assert.deepEqual([...new Set(tasks.map((t) => t.status))].sort(), ['done', 'inbox', 'next', 'waiting']);
});

test('create a task: 201, lands in inbox, validated', async () => {
  const r = await call('POST', '/tasks', { title: '  Write tests  ' });
  assert.equal(r.status, 201);
  assert.equal(r.body.title, 'Write tests');
  assert.equal(r.body.status, 'inbox');
  assert.equal(r.body.project_id, null);
  assert.ok(r.body.created_at && r.body.updated_at);
  assert.equal((await call('POST', '/tasks', { title: '   ' })).status, 400);
  assert.equal((await call('POST', '/tasks', {})).status, 400);
  assert.equal((await call('GET', `/tasks/${r.body.id}`)).body.title, 'Write tests');
});

test('complete a task: PATCH returns the full updated task', async () => {
  const { body: t } = await call('POST', '/tasks', { title: 'Finish me' });
  const r = await call('PATCH', `/tasks/${t.id}`, { status: 'done' });
  assert.equal(r.status, 200);
  assert.equal(r.body.id, t.id);
  assert.equal(r.body.title, 'Finish me');
  assert.equal(r.body.status, 'done');
  assert.ok(r.body.updated_at >= t.updated_at);
  const done = (await call('GET', '/tasks?status=done')).body;
  assert.ok(done.some((x) => x.id === t.id));
});

test('process an inbox task: defer to waiting, and assign to a project', async () => {
  const a = (await call('POST', '/tasks', { title: 'Defer me' })).body;
  const b = (await call('POST', '/tasks', { title: 'Assign me' })).body;
  const proj = (await call('GET', '/projects')).body[0];
  assert.equal((await call('PATCH', `/tasks/${a.id}`, { status: 'waiting' })).body.status, 'waiting');
  const r = await call('PATCH', `/tasks/${b.id}`, { project_id: proj.id, status: 'next' });
  assert.equal(r.body.project_id, proj.id);
  assert.equal(r.body.status, 'next');
  const inbox = (await call('GET', '/tasks?status=inbox')).body.map((t) => t.id);
  assert.ok(!inbox.includes(a.id) && !inbox.includes(b.id));
  assert.equal((await call('PATCH', `/tasks/${b.id}`, { project_id: 99999 })).status, 400);
});

test('errors: unknown ids 404, invalid status 400, delete task 204', async () => {
  assert.equal((await call('GET', '/tasks/99999')).status, 404);
  assert.equal((await call('PATCH', '/tasks/99999', { status: 'done' })).status, 404);
  assert.equal((await call('DELETE', '/tasks/99999')).status, 404);
  assert.equal((await call('PATCH', '/projects/99999', { name: 'x' })).status, 404);
  assert.equal((await call('DELETE', '/projects/99999')).status, 404);
  assert.equal((await call('GET', '/tasks?status=bogus')).status, 400);
  const { body: t } = await call('POST', '/tasks', { title: 'Temp' });
  assert.equal((await call('PATCH', `/tasks/${t.id}`, { status: 'bogus' })).status, 400);
  assert.equal((await call('POST', '/projects', { name: 'P', status: 'bogus' })).status, 400);
  assert.equal((await call('DELETE', `/tasks/${t.id}`)).status, 204);
  assert.equal((await call('GET', `/tasks/${t.id}`)).status, 404);
});

test('projects: create, rename, change status, delete empty project', async () => {
  const c = await call('POST', '/projects', { name: 'Garden' });
  assert.equal(c.status, 201);
  assert.equal(c.body.status, 'active');
  const r = await call('PATCH', `/projects/${c.body.id}`, { name: 'Garden 2', status: 'someday' });
  assert.equal(r.status, 200);
  assert.equal(r.body.name, 'Garden 2');
  assert.equal(r.body.status, 'someday');
  assert.equal((await call('DELETE', `/projects/${c.body.id}`)).status, 204);
  assert.ok(!(await call('GET', '/projects')).body.some((p) => p.id === c.body.id));
});

test('delete a project with tasks: 409 names the blocking tasks; force unassigns', async () => {
  const p = (await call('POST', '/projects', { name: 'Blocked' })).body;
  const t = (await call('POST', '/tasks', { title: 'Blocker task', project_id: p.id })).body;
  const r = await call('DELETE', `/projects/${p.id}`);
  assert.equal(r.status, 409);
  assert.match(r.body.error, /Blocker task/);
  assert.deepEqual(r.body.blocking_tasks.map((x) => x.id), [t.id]);
  // nothing was orphaned or removed
  assert.equal((await call('GET', `/tasks/${t.id}`)).body.project_id, p.id);
  assert.equal((await call('DELETE', `/projects/${p.id}?force=true`)).status, 204);
  assert.equal((await call('GET', `/tasks/${t.id}`)).body.project_id, null);
});
