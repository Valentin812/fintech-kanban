import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const html = await readFile('index.html');
const server = createServer((request, response) => {
  if (new URL(request.url, 'http://x').pathname !== '/') { response.writeHead(404).end('Not found'); return; }
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(html);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const launchOptions = { headless: true };
if (process.env.CHROMIUM_EXECUTABLE) launchOptions.executablePath = process.env.CHROMIUM_EXECUTABLE;
const browser = await chromium.launch(launchOptions);
function assert(c, m) { if (!c) throw new Error(m); }
const ME = '00000000-0000-4000-8000-000000000001';
const session = { access_token: 'm', refresh_token: 'r', user: { id: ME, email: 'o@example.test', user_metadata: {} } };
const tk = (id, title) => ({ id, title, status: 'Очередь', owner: '', end: '', description: '', comment: '' });
const remoteState = { data: [{ name: 'Альфа', tasks: [tk(1, 'Первая')] }, { name: 'Бета', tasks: [tk(11, 'Другая')] }], projectMeta: {}, standaloneTasks: [], members: [], quickNotes: [{ id: 'n1', text: 'Позвонить клиенту', created: Date.now(), done: false }] };
let lastState = null;
try {
  const context = await browser.newContext({ viewport: { width: 1300, height: 800 } });
  const page = await context.newPage();
  const errors = [];
  await page.route('**/*', async (route) => {
    const request = route.request(); const url = new URL(request.url());
    if (url.origin === origin) return route.continue();
    const ok = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.origin !== 'https://vdlfdnhfiiltdyrucdtn.supabase.co') return route.abort();
    if (url.pathname === '/auth/v1/user') return ok(session.user);
    if (url.pathname === '/rest/v1/kanban_state' && request.method() === 'GET') return ok([{ user_id: ME, state: (Array.isArray(lastState) ? lastState[0] : lastState)?.state ?? remoteState }]);
    if (url.pathname === '/rest/v1/kanban_state') { try { lastState = JSON.parse(request.postData()); } catch (e) {} return route.fulfill({ status: 201, body: '' }); }
    if (url.pathname === '/functions/v1/admin-users') return ok({ error: 'F' }, 403);
    if (url.pathname.startsWith('/rest/v1/')) return ok([]);
    return ok({}, 501);
  });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript((s) => localStorage.setItem('fintech-kanban-session', JSON.stringify(s)), session);
  await page.goto(`${origin}/`);
  await page.locator('.app').waitFor({ state: 'visible' });
  await page.evaluate(() => { activeProject = 'Альфа'; switchView('tasks'); });
  // Quick task button next to the project name
  assert(await page.locator('#projectQuickTask').isVisible(), 'Quick task button is visible next to the project name');
  await page.locator('#projectQuickTask').click();
  assert(await page.locator('#modal.show').count() === 1, 'Quick task dialog opens');
  await page.locator('#newTitle').fill('Быстрая задача');
  await page.locator('#createTask').click();
  assert(await page.evaluate(() => active().tasks.some((t) => t.title === 'Быстрая задача')), 'Task is created in the current project');
  // Note straight to a project
  await page.evaluate(() => switchView('mytasks'));
  const sel = page.locator('select[data-qn-proj="n1"]').first();
  await sel.waitFor({ state: 'visible' });
  await sel.selectOption('Бета');
  const res = await page.evaluate(() => ({ note: quickNotes.length, task: data.find((p) => p.name === 'Бета').tasks.some((t) => t.title === 'Позвонить клиенту' && t.status === 'Очередь') }));
  assert(res.note === 0 && res.task, 'Note became a task in the chosen project: ' + JSON.stringify(res));
  await page.locator('#undoToast button').click();
  const back = await page.evaluate(() => ({ note: quickNotes.length, task: data.find((p) => p.name === 'Бета').tasks.some((t) => t.title === 'Позвонить клиенту') }));
  assert(back.note === 1 && !back.task, 'Undo restores the note: ' + JSON.stringify(back));
  assert(!errors.length, 'Page errors: ' + errors.join('; '));
  console.log('Quick task OK: button by project name, note to project, undo');
} finally {
  await browser.close();
  await new Promise((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
}
