'use strict';
/* GTD front end: vanilla JS, talks to the REST API only. */
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const STATUS = { inbox: 'Inbox', next: 'Next', waiting: 'Waiting', done: 'Done' };
const PSTATUS = { active: 'Active', someday: 'Someday', archive: 'Archive' };
const MAX = 200;

const S = { tasks: [], projects: [], loaded: false, loadError: null, filter: 'all', skipped: new Set() };
const main = $('#main');

/* ---------- API ---------- */
async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(data.error || `Request failed (${res.status})`);
    e.status = res.status; e.data = data; throw e;
  }
  return data;
}

/* ---------- toasts ---------- */
function toast(msg, kind = 'info') {
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), kind === 'error' ? 7000 : 3500);
}

/* ---------- optimistic updates with rollback ---------- */
async function optimistic(apply, request, failMsg) {
  const snap = { tasks: S.tasks.map((t) => ({ ...t })), projects: S.projects.map((p) => ({ ...p })) };
  apply(); render();
  try { return { ok: true, result: await request() }; }
  catch (e) {
    S.tasks = snap.tasks; S.projects = snap.projects; render();
    toast(`${failMsg}: ${e.message}`, 'error');
    return { ok: false, error: e };
  }
}

/* ---------- helpers ---------- */
const projectName = (id) => (S.projects.find((p) => p.id === id) || {}).name;
const countFor = (pid) => S.tasks.filter((t) => t.project_id === pid).length;
const replaceTask = (id, row) => { S.tasks = S.tasks.map((t) => (t.id === id ? row : t)); };
const replaceProject = (id, row) => { S.projects = S.projects.map((p) => (p.id === id ? row : p)); };
function validateName(v, label) {
  const t = v.trim();
  if (!t) return `${label} is required.`;
  if (t.length > MAX) return `${label} must be ${MAX} characters or fewer.`;
  return '';
}
function showErr(input, errEl, msg) {
  errEl.textContent = msg; errEl.hidden = !msg;
  if (msg) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid');
}
function projectOptions(selected, placeholder = 'No project') {
  return `<option value="">${esc(placeholder)}</option>` + S.projects
    .map((p) => `<option value="${p.id}"${p.id === selected ? ' selected' : ''}>${esc(p.name)}</option>`).join('');
}
const skeleton = (n = 4) => `<div aria-busy="true" aria-label="Loading"><div class="list">${'<div class="skel"></div>'.repeat(n)}</div></div>`;

/* ---------- routing ---------- */
function parseRoute() {
  const h = location.hash.slice(1);
  if (h === 'process') return { v: 'process' };
  if (h === 'projects') return { v: 'projects' };
  const m = /^project-(\d+)$/.exec(h);
  if (m) return { v: 'project', id: Number(m[1]) };
  return { v: 'tasks' };
}

/* ---------- views ---------- */
function filterTabs(base) {
  const count = (s) => (s === 'all' ? base.length : base.filter((t) => t.status === s).length);
  return `<div class="tabs" role="group" aria-label="Filter by status">` +
    ['all', 'inbox', 'next', 'waiting', 'done'].map((s) =>
      `<button type="button" data-act="filter" data-filter="${s}" data-fk="f-${s}" aria-pressed="${S.filter === s}">${s === 'all' ? 'All' : STATUS[s]} (${count(s)})</button>`).join('') + `</div>`;
}

function taskRow(t) {
  const done = t.status === 'done';
  const dis = t.id < 0 ? ' disabled' : ''; // still being created on the server
  const proj = t.project_id ? projectName(t.project_id) : null;
  return `<li class="row${done ? ' done' : ''}">
    <button type="button" class="check" data-act="toggle" data-id="${t.id}" data-fk="c-${t.id}"${dis} aria-pressed="${done}" aria-label="${done ? 'Reopen' : 'Complete'}: ${esc(t.title)}">${done ? '✓' : ''}</button>
    <div class="title">${esc(t.title)}</div>
    <div class="meta"><span class="pill">${STATUS[t.status]}</span>${proj ? `<a href="#project-${t.project_id}">${esc(proj)}</a>` : ''}</div>
    <div class="ops">
      <button type="button" class="btn small" data-act="edit" data-id="${t.id}" data-fk="e-${t.id}"${dis} aria-label="Edit: ${esc(t.title)}">Edit</button>
      <button type="button" class="btn small" data-act="del" data-id="${t.id}" data-fk="d-${t.id}"${dis} aria-label="Delete: ${esc(t.title)}">Delete</button>
    </div></li>`;
}

function taskListSection(base, emptyMsg) {
  const vis = (S.filter === 'all' ? base : base.filter((t) => t.status === S.filter)).slice().sort((a, b) => b.id - a.id);
  return filterTabs(base) + (vis.length
    ? `<ul class="list">${vis.map(taskRow).join('')}</ul>`
    : `<p class="empty">${emptyMsg}</p>`);
}

function viewTasks() {
  if (!S.loaded) return skeleton();
  return `<h2>Tasks</h2>` + taskListSection(S.tasks, S.filter === 'all' ? 'No tasks yet. Add one above.' : `Nothing with status “${STATUS[S.filter]}”.`);
}

function viewProcess() {
  if (!S.loaded) return skeleton(2);
  const inbox = S.tasks.filter((t) => t.status === 'inbox').sort((a, b) => a.id - b.id);
  const queue = inbox.filter((t) => t.id > 0 && !S.skipped.has(t.id));
  let body;
  if (!inbox.length) body = `<p class="empty">Inbox zero. Nothing to process.</p>`;
  else if (!queue.length) body = `<p class="empty">You skipped the remaining ${inbox.length} item(s).<br><button type="button" class="btn" data-act="unskip" data-fk="unskip">Review skipped items</button></p>`;
  else {
    const t = queue[0];
    body = `<p class="progress">${queue.length} left to process</p>
    <section class="card" tabindex="-1" data-fk="card" aria-label="Current inbox item">
      <div class="big">${esc(t.title)}</div>
      <div class="choices">
        <button type="button" class="btn primary" data-act="p-done" data-id="${t.id}" data-fk="p-done">Done</button>
        <button type="button" class="btn" data-act="p-next" data-id="${t.id}" data-fk="p-next">Defer to Next</button>
        <button type="button" class="btn" data-act="p-waiting" data-id="${t.id}" data-fk="p-waiting">Defer to Waiting</button>
        <button type="button" class="btn" data-act="p-skip" data-id="${t.id}" data-fk="p-skip">Skip for now</button>
      </div>
      <div class="assign">
        <div><label for="pProject">Assign to a project (moves it to Next)</label>
          <select id="pProject" aria-describedby="pErr">${projectOptions(null, 'Choose a project…')}</select>
          <p id="pErr" class="err" role="alert" hidden></p></div>
        <button type="button" class="btn" data-act="p-assign" data-id="${t.id}" data-fk="p-assign">Assign</button>
      </div>
    </section>`;
  }
  return `<h2>Process inbox</h2>${body}`;
}

function viewProjects() {
  if (!S.loaded) return skeleton(3);
  const rows = S.projects.map((p) => { const d = p.id < 0 ? ' disabled' : ''; return `<li class="proj-row">
    <div><a href="#project-${p.id}">${esc(p.name)}</a><br><span class="pill">${countFor(p.id)} task${countFor(p.id) === 1 ? '' : 's'}</span></div>
    <div class="ops">
      <label class="sr" for="ps-${p.id}">Status of ${esc(p.name)}</label>
      <select id="ps-${p.id}" data-act="pstatus" data-id="${p.id}"${d}>${Object.entries(PSTATUS).map(([k, v]) => `<option value="${k}"${k === p.status ? ' selected' : ''}>${v}</option>`).join('')}</select>
      <button type="button" class="btn small" data-act="prename" data-id="${p.id}" data-fk="pr-${p.id}"${d} aria-label="Rename ${esc(p.name)}">Rename</button>
      <button type="button" class="btn small" data-act="pdel" data-id="${p.id}" data-fk="pd-${p.id}"${d} aria-label="Delete ${esc(p.name)}">Delete</button>
    </div></li>`; }).join('');
  return `<h2>Projects</h2>
    <form id="projForm" class="proj-form" novalidate>
      <div><label class="sr" for="projName">New project name</label>
      <input id="projName" type="text" placeholder="New project name" autocomplete="off" aria-describedby="projErr" maxlength="300"></div>
      <button type="submit" class="btn primary">Create project</button>
      <p id="projErr" class="err" role="alert" hidden></p>
    </form>
    ${S.projects.length ? `<ul class="list">${rows}</ul>` : `<p class="empty">No projects yet.</p>`}`;
}

function viewProject(id) {
  if (!S.loaded) return skeleton();
  const p = S.projects.find((x) => x.id === id);
  if (!p) return `<p class="empty">Project not found. <a href="#projects">Back to projects</a></p>`;
  const base = S.tasks.filter((t) => t.project_id === id);
  return `<a class="back" href="#projects">← All projects</a>
    <div class="head-row"><h2>${esc(p.name)}</h2>
      <label class="sr" for="ps-${p.id}">Project status</label>
      <select id="ps-${p.id}" data-act="pstatus" data-id="${p.id}">${Object.entries(PSTATUS).map(([k, v]) => `<option value="${k}"${k === p.status ? ' selected' : ''}>${v}</option>`).join('')}</select>
      <button type="button" class="btn small" data-act="prename" data-id="${p.id}" data-fk="pr-${p.id}">Rename</button></div>
    ${taskListSection(base, 'No tasks in this project yet. New tasks added from this page land here.')}`;
}

/* ---------- render (keeps keyboard focus across re-renders) ---------- */
let renderPending = false;
function render(navigated = false) {
  // While a modal is open, keep the page behind it untouched so the element that opened it stays in the DOM
  // and the browser can return focus to it. The deferred render runs when the dialog closes.
  if (!navigated && document.querySelector('dialog[open]')) { renderPending = true; return; }
  renderPending = false;
  const r = parseRoute();
  const fk = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.fk : null;
  const sel = document.activeElement && document.activeElement.id && main.contains(document.activeElement) ? document.activeElement.id : null;

  if (S.loadError) {
    main.innerHTML = `<p class="empty" role="alert">Could not load data: ${esc(S.loadError)}<br><button type="button" class="btn" data-act="retry">Retry</button></p>`;
  } else {
    main.innerHTML = { tasks: viewTasks, process: viewProcess, projects: viewProjects, project: () => viewProject(r.id) }[r.v]();
  }
  document.querySelectorAll('nav a[data-nav]').forEach((a) => {
    const on = a.dataset.nav === r.v || (r.v === 'project' && a.dataset.nav === 'projects');
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  const n = S.tasks.filter((t) => t.status === 'inbox').length;
  const badge = $('#inboxBadge'); badge.hidden = !S.loaded || n === 0; badge.textContent = n;
  const titles = { tasks: 'Tasks', process: 'Process inbox', projects: 'Projects', project: (S.projects.find((p) => p.id === r.id) || {}).name || 'Project' };
  document.title = `${titles[r.v]} · GTD`;

  if (navigated) { main.focus(); return; }
  const target = (fk && main.querySelector(`[data-fk="${fk}"]`)) || (sel && main.querySelector('#' + sel));
  if (target) target.focus();
}

/* ---------- dialogs ---------- */
document.addEventListener('click', (e) => {
  const c = e.target.closest('[data-close]'); if (c) c.closest('dialog').close();
});
function confirmDialog(title, message, okLabel) {
  rememberOpener();
  const dlg = $('#confirmDlg');
  $('#confirmTitle').textContent = title; $('#confirmMsg').textContent = message; $('#confirmOk').textContent = okLabel;
  $('#confirmOk').value = 'ok';
  return new Promise((resolve) => {
    dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok'), { once: true });
    dlg.returnValue = ''; dlg.showModal();
  });
}

/* Restore focus to whatever opened a dialog, even if a re-render replaced that element while it was open. */
let openerKey = null;
const rememberOpener = () => { const a = document.activeElement; openerKey = a && a.dataset ? a.dataset.fk || null : null; };
document.querySelectorAll('dialog').forEach((dlg) => dlg.addEventListener('close', () => {
  const key = openerKey; openerKey = null;
  if (renderPending) render();
  const a = document.activeElement;
  if (key && (!a || a === document.body || !a.isConnected)) { const el = main.querySelector(`[data-fk="${key}"]`); if (el) el.focus(); }
}));

let editId = null;
function openEdit(id) {
  const t = S.tasks.find((x) => x.id === id); if (!t) return;
  rememberOpener(); editId = id;
  $('#eTitle').value = t.title; $('#eStatus').value = t.status;
  $('#eProject').innerHTML = projectOptions(t.project_id);
  showErr($('#eTitle'), $('#eErr'), '');
  $('#editDlg').showModal(); $('#eTitle').focus();
}
$('#editForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = validateName($('#eTitle').value, 'Title');
  showErr($('#eTitle'), $('#eErr'), msg);
  if (msg) { $('#eTitle').focus(); return; }
  const id = editId; const cur = S.tasks.find((t) => t.id === id);
  const patch = { title: $('#eTitle').value.trim(), status: $('#eStatus').value, project_id: $('#eProject').value ? Number($('#eProject').value) : null };
  $('#editDlg').close();
  const r = await optimistic(() => replaceTask(id, { ...cur, ...patch }), () => api('PATCH', `/tasks/${id}`, patch), 'Could not save task');
  if (r.ok) replaceTask(id, r.result), render();
});

let renameId = null;
function openRename(id) {
  const p = S.projects.find((x) => x.id === id); if (!p) return;
  rememberOpener(); renameId = id; $('#rName').value = p.name; showErr($('#rName'), $('#rErr'), '');
  $('#renameDlg').showModal(); $('#rName').focus();
}
$('#renameForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = validateName($('#rName').value, 'Name');
  showErr($('#rName'), $('#rErr'), msg);
  if (msg) { $('#rName').focus(); return; }
  const id = renameId; const cur = S.projects.find((p) => p.id === id); const name = $('#rName').value.trim();
  $('#renameDlg').close();
  const r = await optimistic(() => replaceProject(id, { ...cur, name }), () => api('PATCH', `/projects/${id}`, { name }), 'Could not rename project');
  if (r.ok) replaceProject(id, r.result), render();
});

/* Keep Tab / Shift+Tab inside whichever dialog is open (native modals can let focus wrap out to the browser UI). */
document.querySelectorAll('dialog').forEach((dlg) => dlg.addEventListener('keydown', (e) => {
  if (e.key !== 'Tab') return;
  const f = [...dlg.querySelectorAll('button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])')].filter((x) => !x.disabled && !x.hidden && x.offsetParent !== null);
  if (!f.length) return;
  const first = f[0], last = f[f.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}));

/* ---------- task actions ---------- */
async function patchTask(id, patch, failMsg) {
  const cur = S.tasks.find((t) => t.id === id); if (!cur) return { ok: false };
  const r = await optimistic(() => replaceTask(id, { ...cur, ...patch }), () => api('PATCH', `/tasks/${id}`, patch), failMsg);
  if (r.ok) { replaceTask(id, r.result); render(); }
  return r;
}
async function deleteTask(id) {
  const cur = S.tasks.find((t) => t.id === id); if (!cur) return;
  const r = await optimistic(() => { S.tasks = S.tasks.filter((t) => t.id !== id); }, () => api('DELETE', `/tasks/${id}`), 'Could not delete task');
  if (r.ok) toast(`Deleted “${cur.title}”`);
}

$('#quickAdd').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $('#quickInput'); const err = $('#quickErr');
  const msg = validateName(input.value, 'Task title');
  showErr(input, err, msg);
  if (msg) { input.focus(); return; }
  const title = input.value.trim(); input.value = '';
  const r0 = parseRoute(); const project_id = r0.v === 'project' && S.projects.some((p) => p.id === r0.id) ? r0.id : null;
  const tempId = -Date.now(); const stamp = new Date().toISOString();
  const r = await optimistic(
    () => { S.tasks.push({ id: tempId, title, status: 'inbox', project_id, created_at: stamp, updated_at: stamp }); },
    () => api('POST', '/tasks', project_id ? { title, project_id } : { title }), 'Could not add task');
  if (r.ok) replaceTask(tempId, r.result), render(), toast('Added to inbox');
  else input.value = title;
});
$('#quickInput').addEventListener('input', () => showErr($('#quickInput'), $('#quickErr'), ''));

/* ---------- project actions ---------- */
async function createProject(name) {
  const tempId = -Date.now(); const stamp = new Date().toISOString();
  const r = await optimistic(
    () => { S.projects.push({ id: tempId, name, status: 'active', created_at: stamp, updated_at: stamp }); },
    () => api('POST', '/projects', { name }), 'Could not create project');
  if (r.ok) { replaceProject(tempId, r.result); render(); toast(`Created project “${name}”`); }
  return r.ok;
}
async function deleteProject(id) {
  const p = S.projects.find((x) => x.id === id); if (!p) return;
  const n = countFor(id); let force = false;
  if (n > 0) {
    const titles = S.tasks.filter((t) => t.project_id === id).map((t) => `“${t.title}”`);
    const shown = titles.slice(0, 5).join(', ') + (titles.length > 5 ? `, and ${titles.length - 5} more` : '');
    const ok = await confirmDialog(`Delete “${p.name}”?`, `This project has ${n} task${n === 1 ? '' : 's'} (${shown}). The tasks are kept but removed from the project.`, 'Delete project');
    if (!ok) { render(); return; }
    force = true;
  }
  const wasProjectView = parseRoute().v === 'project';
  const r = await optimistic(() => {
    S.projects = S.projects.filter((x) => x.id !== id);
    S.tasks = S.tasks.map((t) => (t.project_id === id ? { ...t, project_id: null } : t));
  }, () => api('DELETE', `/projects/${id}${force ? '?force=true' : ''}`), 'Could not delete project');
  if (r.ok) { toast(`Deleted project “${p.name}”`); if (wasProjectView) location.hash = '#projects'; }
}

/* ---------- delegated clicks / changes inside <main> ---------- */
main.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-act]'); if (!b || b.tagName === 'SELECT') return;
  const id = Number(b.dataset.id); const t = S.tasks.find((x) => x.id === id);
  switch (b.dataset.act) {
    case 'filter': S.filter = b.dataset.filter; render(); break;
    case 'toggle': if (t) await patchTask(id, { status: t.status === 'done' ? 'next' : 'done' }, 'Could not update task'); break;
    case 'edit': openEdit(id); break;
    case 'del': await deleteTask(id); break;
    case 'retry': init(); break;
    case 'prename': openRename(id); break;
    case 'pdel': await deleteProject(id); break;
    case 'unskip': S.skipped.clear(); render(); break;
    case 'p-done': if (t) { const r = await patchTask(id, { status: 'done' }, 'Could not update task'); if (r.ok) toast(`Done: “${t.title}”`); } break;
    case 'p-next': if (t) { const r = await patchTask(id, { status: 'next' }, 'Could not update task'); if (r.ok) toast(`Moved to Next: “${t.title}”`); } break;
    case 'p-waiting': if (t) { const r = await patchTask(id, { status: 'waiting' }, 'Could not update task'); if (r.ok) toast(`Moved to Waiting: “${t.title}”`); } break;
    case 'p-skip': S.skipped.add(id); render(); break;
    case 'p-assign': {
      const sel = $('#pProject'); const err = $('#pErr');
      if (!sel.value) { err.textContent = 'Choose a project first.'; err.hidden = false; sel.setAttribute('aria-invalid', 'true'); sel.focus(); break; }
      const pid = Number(sel.value);
      const r = await patchTask(id, { project_id: pid, status: 'next' }, 'Could not assign task');
      if (r.ok && t) toast(`Assigned to “${projectName(pid)}”`);
      break;
    }
  }
});
main.addEventListener('change', async (e) => {
  const s = e.target.closest('select[data-act="pstatus"]'); if (!s) return;
  const id = Number(s.dataset.id); const cur = S.projects.find((p) => p.id === id); if (!cur) return;
  const status = s.value;
  const r = await optimistic(() => replaceProject(id, { ...cur, status }), () => api('PATCH', `/projects/${id}`, { status }), 'Could not change project status');
  if (r.ok) replaceProject(id, r.result), render();
});
main.addEventListener('submit', async (e) => {
  if (e.target.id !== 'projForm') return;
  e.preventDefault();
  const input = $('#projName'); const msg = validateName(input.value, 'Project name');
  showErr(input, $('#projErr'), msg);
  if (msg) { input.focus(); return; }
  const name = input.value.trim(); input.value = '';
  if (!(await createProject(name))) { const i = $('#projName'); if (i) i.value = name; }
  else $('#projName').focus();
});
main.addEventListener('input', (e) => { if (e.target.id === 'projName') showErr(e.target, $('#projErr'), ''); });

/* ---------- keyboard shortcuts ---------- */
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (document.querySelector('dialog[open]')) return;
  const el = e.target; const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || el.isContentEditable) return;
  if (e.key === 'n') { e.preventDefault(); $('#quickInput').focus(); }
  else if (e.key === '?') { e.preventDefault(); $('#helpDlg').showModal(); }
});
$('#helpBtn').addEventListener('click', () => $('#helpDlg').showModal());

/* ---------- boot ---------- */
async function init() {
  S.loadError = null; S.loaded = false; render();
  try {
    const [tasks, projects] = await Promise.all([api('GET', '/tasks'), api('GET', '/projects')]);
    S.tasks = tasks; S.projects = projects; S.loaded = true;
  } catch (e) { S.loadError = e.message; }
  render();
}
window.addEventListener('hashchange', () => render(true));
init();
