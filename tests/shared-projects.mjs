import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const html = await readFile('index.html');
const server = createServer((request, response) => {
  if (new URL(request.url, 'http://x').pathname !== '/') {
    response.writeHead(404).end('Not found');
    return;
  }
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(html);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const launchOptions = { headless: true };
if (process.env.CHROMIUM_EXECUTABLE) launchOptions.executablePath = process.env.CHROMIUM_EXECUTABLE;
const browser = await chromium.launch(launchOptions);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// ---- A tiny fake of the Supabase backend, shared by both browsers ----
const users = {
  'token-a': { id: '00000000-0000-4000-8000-00000000000a', email: 'owner@example.test' },
  'token-b': { id: '00000000-0000-4000-8000-00000000000b', email: 'member@example.test' },
};
const db = {
  kanbanState: {
    [users['token-a'].id]: { data: [
      { name: 'Personal', tasks: [{ id: 1, title: 'Private task', status: 'Очередь', owner: '', end: '' }] },
      { name: 'Team', tasks: [
        { id: 11, title: 'Shared one', status: 'Очередь', owner: '', end: '', description: '' },
        { id: 12, title: 'Shared two', status: 'В работе', owner: '', end: '', description: '' },
      ] },
    ], projectMeta: { Team: { milestones: [], docs: [], links: [], extraStatuses: ['Ревью'] } }, standaloneTasks: [], members: [] },
    [users['token-b'].id]: { data: [{ name: 'Mine', tasks: [] }], projectMeta: {}, standaloneTasks: [], members: [] },
  },
  projects: [],
  members: [],
  tasks: [],
  calls: [],
};
const isMember = (pid, uid) => db.members.some((m) => m.project_id === pid && m.user_id === uid);
const inList = (v) => (v?.match(/^in\.\((.*)\)$/)?.[1] ?? '').split(',').filter(Boolean);
const eq = (v) => v?.replace(/^eq\./, '');

async function handle(route, token) {
  const request = route.request();
  const url = new URL(request.url());
  const q = url.searchParams;
  const me = users[token];
  const ok = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  const method = request.method();
  const path = url.pathname;
  if (path === '/auth/v1/user') return ok(me);
  if (path === '/rest/v1/kanban_state' && method === 'GET') return ok([{ user_id: me.id, state: db.kanbanState[me.id] }]);
  if (path === '/rest/v1/kanban_state' && method === 'POST') {
    db.kanbanState[me.id] = request.postDataJSON().state;
    return route.fulfill({ status: 201, body: '' });
  }
  if (['/rest/v1/notifications', '/rest/v1/kanban_profiles', '/rest/v1/messenger_accounts'].includes(path)) {
    return method === 'GET' ? ok([]) : route.fulfill({ status: 204, body: '' });
  }
  if (path === '/rest/v1/shared_projects' && method === 'GET') return ok(db.projects.filter((p) => isMember(p.id, me.id)));
  if (path === '/rest/v1/shared_projects' && method === 'PATCH') {
    const p = db.projects.find((x) => x.id === eq(q.get('id')));
    if (!p || !isMember(p.id, me.id)) return ok({ message: 'denied' }, 403);
    Object.assign(p, request.postDataJSON());
    db.calls.push(['patch-project', me.email]);
    return route.fulfill({ status: 204, body: '' });
  }
  if (path === '/rest/v1/shared_project_members' && method === 'GET') {
    return ok(db.members.filter((m) => m.user_id === eq(q.get('user_id'))).map(({ project_id, role }) => ({ project_id, role })));
  }
  if (path === '/rest/v1/shared_tasks' && method === 'GET') {
    const ids = inList(q.get('project_id')).filter((id) => isMember(id, me.id));
    const rows = db.tasks.filter((t) => ids.includes(t.project_id));
    const offset = Number(q.get('offset') || 0), limit = Number(q.get('limit') || 1000);
    return ok(rows.slice(offset, offset + limit));
  }
  if (path === '/rest/v1/shared_tasks' && method === 'POST') {
    for (const row of request.postDataJSON()) {
      if (!isMember(row.project_id, me.id) || row.updated_by !== me.id) return ok({ message: 'denied' }, 403);
      const i = db.tasks.findIndex((t) => t.project_id === row.project_id && t.task_id === row.task_id);
      if (i >= 0) db.tasks[i] = row; else db.tasks.push(row);
    }
    db.calls.push(['upsert', me.email]);
    return route.fulfill({ status: 201, body: '' });
  }
  if (path === '/rest/v1/shared_tasks' && method === 'DELETE') {
    const pid = eq(q.get('project_id')), ids = inList(q.get('task_id')).map(Number);
    if (!isMember(pid, me.id)) return ok({ message: 'denied' }, 403);
    db.tasks = db.tasks.filter((t) => !(t.project_id === pid && ids.includes(t.task_id)));
    db.calls.push(['delete', me.email, ids]);
    return route.fulfill({ status: 204, body: '' });
  }
  if (path === '/functions/v1/shared-projects') {
    const body = request.postDataJSON();
    db.calls.push(['fn', me.email, body.action]);
    if (body.action === 'create') {
      const id = randomUUID();
      db.projects.push({ id, name: body.name, meta: body.meta, owner_id: me.id });
      db.members.push({ project_id: id, user_id: me.id, role: 'owner' });
      body.tasks.forEach((t) => db.tasks.push({ project_id: id, task_id: t.id, data: t, updated_by: me.id }));
      return ok({ project: { id, name: body.name, meta: body.meta, owner_id: me.id, role: 'owner' } });
    }
    const role = db.members.find((m) => m.project_id === body.project_id && m.user_id === me.id)?.role;
    if (!role) return ok({ error: 'Not a member of this project' }, 403);
    if (body.action === 'members') {
      return ok({ me: { role }, members: db.members.filter((m) => m.project_id === body.project_id).map((m) => {
        const u = Object.values(users).find((x) => x.id === m.user_id);
        return { user_id: m.user_id, role: m.role, email: u.email, name: '', is_self: u.id === me.id };
      }) });
    }
    if (body.action === 'leave') {
      db.members = db.members.filter((m) => !(m.project_id === body.project_id && m.user_id === me.id));
      return ok({ ok: true });
    }
    if (role !== 'owner') return ok({ error: 'Only the project owner can do this' }, 403);
    if (body.action === 'invite') {
      const u = Object.values(users).find((x) => x.email === body.email.toLowerCase());
      if (!u) return ok({ error: 'user_not_found' }, 404);
      if (!isMember(body.project_id, u.id)) db.members.push({ project_id: body.project_id, user_id: u.id, role: 'editor' });
      return ok({ member: { user_id: u.id, role: 'editor', email: u.email } });
    }
    if (body.action === 'delete') {
      db.projects = db.projects.filter((p) => p.id !== body.project_id);
      db.members = db.members.filter((m) => m.project_id !== body.project_id);
      db.tasks = db.tasks.filter((t) => t.project_id !== body.project_id);
      return ok({ ok: true });
    }
    return ok({ error: 'Unknown action' }, 400);
  }
  return ok({ error: `Unexpected ${method} ${path}` }, 501);
}

async function openAs(token) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('dialog', (dialog) => dialog.accept());
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === origin) return route.continue();
    if (url.origin !== 'https://vdlfdnhfiiltdyrucdtn.supabase.co') return route.abort();
    return handle(route, token);
  });
  await page.addInitScript(([t, u]) => localStorage.setItem('fintech-kanban-session', JSON.stringify({ access_token: t, refresh_token: 'r', user: { ...u, user_metadata: {} } })), [token, users[token]]);
  await page.goto(`${origin}/`);
  await page.locator('.app').waitFor({ state: 'visible' });
  return { page, errors };
}
const confirmDialog = (page) => page.locator('.friendly-dialog .btn.primary').click();
const sync = (page) => page.evaluate(async () => { await pushSharedChanges(); await loadSharedProjects(); });
const sharedProject = (page) => page.evaluate(() => { const p = data.find((x) => x.shared); return p ? { name: p.name, role: p.shared.role, tasks: p.tasks.map((t) => ({ id: t.id, description: t.description || '', status: t.status })), order: projectStatuses.call ? null : null } : null; });

try {
  // 1. Owner turns a personal project into a shared one and invites a colleague.
  const a = await openAs('token-a');
  await a.page.evaluate(() => { activeProject = 'Team'; switchView('tasks'); renderAll(); });
  await a.page.locator('#projectMenuButton').click();
  await a.page.locator('#projectMenu [data-project-action="__share"]').click();
  await confirmDialog(a.page);
  await a.page.locator('#sharedModal.show #sharedInviteEmail').waitFor();
  assert(db.projects.length === 1 && db.tasks.length === 2, 'Shared project with both tasks should be created on the server');
  assert((await a.page.locator('#projects .project', { hasText: 'Team' }).textContent()).includes('👥'), 'Shared project should be marked in the sidebar');
  await a.page.waitForTimeout(1200);
  const personalA = db.kanbanState[users['token-a'].id];
  assert(!personalA.data.some((p) => p.name === 'Team') && personalA.data.some((p) => p.name === 'Personal'), 'Personal state must no longer contain the shared project');
  assert(personalA.backups?.length === 1 && personalA.backups[0].tasks.length === 2, 'A backup of the project should be stored before sharing');
  assert(!personalA.projectMeta.Team, 'Shared project columns must not stay in personal state');
  await a.page.locator('#sharedInviteEmail').fill('stranger@example.test');
  await a.page.locator('#sharedInviteForm button[type="submit"]').click();
  await a.page.locator('#sharedInviteStatus', { hasText: 'Такого пользователя нет' }).waitFor();
  await a.page.locator('#sharedInviteEmail').fill('member@example.test');
  await a.page.locator('#sharedInviteForm button[type="submit"]').click();
  await a.page.locator('#sharedBody', { hasText: 'member@example.test' }).waitFor();
  await a.page.locator('#sharedClose').click();

  // 2. The colleague sees the project with its tasks and columns.
  const b = await openAs('token-b');
  await b.page.waitForFunction(() => data.some((p) => p.shared));
  let seen = await sharedProject(b.page);
  assert(seen.name === 'Team' && seen.role === 'editor' && seen.tasks.length === 2, `Member should see the shared project: ${JSON.stringify(seen)}`);
  assert(await b.page.evaluate(() => { activeProject = 'Team'; return projectStatuses().includes('Ревью'); }), 'Member should get the project columns');
  assert(db.kanbanState[users['token-b'].id].data.every((p) => !p.shared && p.name !== 'Team'), 'Shared project must not leak into the member personal state');

  // 3. Both edit different tasks at the same time — nothing is lost.
  await b.page.evaluate(() => { const t = data.find((p) => p.shared).tasks.find((x) => x.id === 11); t.description = 'Edited by member'; save(); });
  await a.page.evaluate(() => { const t = data.find((p) => p.shared).tasks.find((x) => x.id === 12); t.description = 'Edited by owner'; save(); });
  await sync(b.page);
  await sync(a.page);
  await sync(b.page);
  for (const who of [a, b]) {
    const s = await sharedProject(who.page);
    const d = Object.fromEntries(s.tasks.map((t) => [t.id, t.description]));
    assert(d[11] === 'Edited by member' && d[12] === 'Edited by owner', `Concurrent edits of different tasks must both survive: ${JSON.stringify(d)}`);
  }

  // 4. Column order changed by the member reaches the owner.
  await b.page.evaluate(() => { activeProject = 'Team'; switchView('tasks'); renderAll(); moveStatus('Готово', -1); });
  await sync(b.page);
  await sync(a.page);
  const orderA = await a.page.evaluate(() => { activeProject = 'Team'; return projectStatuses(); });
  assert(orderA.indexOf('Готово') < orderA.indexOf('На анализе'), `Owner should see the new column order: ${orderA}`);

  // 5. Deleting a task removes it for everyone.
  await a.page.evaluate(() => { activeProject = 'Team'; switchView('tasks'); renderAll(); openTask(12); });
  await a.page.locator('#deleteTask').click();
  await sync(a.page);
  await sync(b.page);
  seen = await sharedProject(b.page);
  assert(JSON.stringify(seen.tasks.map((t) => t.id)) === '[11]', `Deleted task should disappear for the member: ${JSON.stringify(seen.tasks)}`);
  assert(db.calls.some((c) => c[0] === 'delete' && c[2].includes(12)), 'Delete should be sent to the server');

  // Bell: an assignment in a shared project opens the task, an invite opens the project.
  const pid = db.projects[0].id;
  await a.page.evaluate((id) => { inAppNotifications = [
    { id: 1, kind: 'assignment', title: 'Shared one', project: 'Team', due: '', sender_name: 'member', created_at: new Date().toISOString(), read_at: null, project_id: id, task_id: 11 },
    { id: 2, kind: 'invite', title: 'Team', project: 'Team', due: '', sender_name: 'owner', created_at: new Date().toISOString(), read_at: null, project_id: id, task_id: null },
  ]; openNotifPanel(); }, pid);
  assert(await a.page.locator('#notifPanel [data-notif-open-project="Team"]').count() === 1, 'Invite should link to the shared project');
  await a.page.locator('#notifPanel [data-notif-task="11"]').click();
  await a.page.waitForFunction(() => document.querySelector('#drawer').classList.contains('open'));
  assert((await a.page.locator('#dTitle').textContent()).includes('Shared one'), 'Assignment should open the shared task');
  await a.page.keyboard.press('Escape');

  // 6. Member leaves; the project disappears for them only.
  await b.page.evaluate(() => { activeProject = 'Team'; switchView('tasks'); renderAll(); });
  await b.page.locator('#projectMenuButton').click();
  await b.page.locator('#projectMenu [data-project-action="__leave"]').click();
  await confirmDialog(b.page);
  await b.page.waitForFunction(() => !data.some((p) => p.shared));
  assert(db.members.length === 1 && (await sharedProject(a.page)) !== null, 'Owner keeps the project after the member leaves');

  // 7. Owner deletes the shared project; a backup can be restored as a personal copy.
  await a.page.evaluate(() => { activeProject = 'Team'; switchView('tasks'); renderAll(); });
  await a.page.locator('#projectMenuButton').click();
  await a.page.locator('#projectMenu [data-project-action="deleteProject"]').click();
  await confirmDialog(a.page);
  await a.page.waitForFunction(() => !data.some((p) => p.shared));
  assert(db.projects.length === 0, 'Shared project should be deleted on the server');
  await a.page.waitForTimeout(1200);
  assert(db.kanbanState[users['token-a'].id].backups.length === 2, 'Deleting should add a second backup');
  await a.page.locator('#projectMenuButton').click();
  await a.page.locator('#projectMenu [data-project-action="__backups"]').click();
  await a.page.locator('[data-restore-backup]').first().click();
  const restored = await a.page.evaluate(() => { const p = data.find((x) => x.name.startsWith('Team (копия')); return p ? { shared: !!p.shared, ids: p.tasks.map((t) => t.id) } : null; });
  assert(restored && !restored.shared && JSON.stringify(restored.ids) === '[11]', `Latest backup should restore as a personal project: ${JSON.stringify(restored)}`);

  const errors = [...a.errors, ...b.errors];
  assert(!errors.length, `Browser page errors: ${errors.join('; ')}`);
  console.log('Shared projects OK: share with backup, invite, member sees tasks and columns, concurrent edits, column order, delete task, leave, delete project, restore backup');
} finally {
  await browser.close();
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}
