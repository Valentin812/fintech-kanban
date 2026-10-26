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

function assert(condition, message) { if (!condition) throw new Error(message); }

const ME = '00000000-0000-4000-8000-000000000001';
const session = { access_token: 'mock-access-token', refresh_token: 'r', user: { id: ME, email: 'owner@example.test', user_metadata: {} } };
const pad = (n) => String(n).padStart(2, '0');
const ddmmyy = (offsetDays) => { const d = new Date(Date.now() + offsetDays * 864e5); return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${String(d.getFullYear()).slice(2)}`; };
const task = (id, title, extra = {}) => ({ id, title, status: 'Очередь', owner: 'Яковлев В.', end: '', description: '', comment: '', ...extra });
let remoteState = {
  data: [
    { name: 'Alpha', tasks: [
      task(1, 'Просроченная', { end: ddmmyy(-3) }),
      task(2, 'Закреплю потом', { owner: 'Сухов Е.' }),
      task(3, 'Помечу важной'),
      task(4, 'На завтра', { end: ddmmyy(1) }),
      task(5, 'Обычная', { end: ddmmyy(20) }),
      task(6, 'Готовая', { status: 'Готово' }),
    ] },
  ],
  projectMeta: {},
  standaloneTasks: [task(50, 'Быстрая без проекта'), task(51, 'Вторая без проекта')],
  pins: ['Alpha\u00014'],
  members: [{ name: 'Яковлев В.', email: 'owner@example.test', linked: true }],
};
const saves = [];

try {
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
  const errors = [];
  const unexpected = [];
  page.on('pageerror', (error) => errors.push(error.stack || error.message));
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === origin) return route.continue();
    const ok = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.origin !== 'https://vdlfdnhfiiltdyrucdtn.supabase.co') { unexpected.push(url.href); return route.abort(); }
    if (url.pathname === '/auth/v1/user') return ok(session.user);
    if (url.pathname === '/rest/v1/kanban_state' && request.method() === 'GET') return ok([{ user_id: ME, state: remoteState }]);
    if (url.pathname === '/rest/v1/kanban_state') { saves.push(request.postDataJSON()); return route.fulfill({ status: 201, body: '' }); }
    if (url.pathname === '/functions/v1/admin-users') return ok({ error: 'Forbidden' }, 403);
    if (url.pathname.startsWith('/rest/v1/')) return ok([]);
    unexpected.push(`${request.method()} ${url.pathname}`);
    return ok({ error: 'Unexpected mocked request' }, 501);
  });
  await page.addInitScript((saved) => localStorage.setItem('fintech-kanban-session', JSON.stringify(saved)), session);
  await page.goto(`${origin}/`);
  await page.locator('.app').waitFor({ state: 'visible' });
  await page.evaluate(() => { activeProject = 'Alpha'; switchView('tasks'); renderAll(); });

  // Complete from a project task and from a standalone task; undo; reopen.
  await page.evaluate(() => openTask(5));
  assert(await page.locator('#completeTask').textContent() === '✔ Завершить', 'Complete button is offered');
  await page.locator('#completeTask').click();
  assert(await page.evaluate(() => active().tasks.find((t) => t.id === 5).status) === 'Готово', 'Task moves to «Готово»');
  assert(!(await page.evaluate(() => document.querySelector('#drawer').classList.contains('open'))), 'Drawer closes after completing');
  await page.locator('#undoToast button').click();
  assert(await page.evaluate(() => active().tasks.find((t) => t.id === 5).status) === 'Очередь', 'Undo restores the old status');
  await page.evaluate(() => openTask(5));
  await page.locator('#completeTask').click();
  await page.evaluate(() => openTask(5));
  assert(await page.locator('#completeTask').textContent() === '↩ Вернуть в работу', 'Done tasks offer to reopen');
  await page.locator('#completeTask').click();
  assert(await page.evaluate(() => active().tasks.find((t) => t.id === 5).status) === 'Очередь', 'Reopen returns to the queue');
  await page.evaluate(() => openStandaloneTask(50));
  await page.locator('#completeTask').click();
  await page.evaluate(() => { window.myTasksFilter = 'done'; switchView('mytasks'); });
  assert((await page.locator('#myTasksView').textContent()).includes('Быстрая без проекта'), 'A completed standalone task is found under «Завершённые»');
  assert(!unexpected.length, `Unexpected requests: ${unexpected.join('; ')}`);
  assert(!errors.length, `Browser page errors: ${errors.join('; ')}`);
  console.log('Complete button OK: project and standalone tasks, undo, reopen, found in finished');
} finally {
  await browser.close();
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}
