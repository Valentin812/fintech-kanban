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
  standaloneTasks: [task(50, 'Первая'), task(51, 'Вторая'), task(52, 'Третья')],
  pins: [],
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

  await page.evaluate(() => { window.myTasksFilter = 'noproject'; switchView('mytasks'); });
  const titles = () => page.locator('#myTasksView .mytask-row .mytask-title').allTextContents();
  assert((await titles()).join('|') === 'Вторая|Первая|Третья', `Default order: ${await titles()}`);
  assert(await page.locator('#myTasksView [data-my-grip]').count() === 3, 'Every row has a grip');

  // Drag the first task below the third with the mouse.
  const grip = await page.locator('#myTasksView .mytask-row').nth(0).locator('[data-my-grip]').boundingBox();
  const last = await page.locator('#myTasksView .mytask-row').nth(2).boundingBox();
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + 4, last.y + last.height - 2, { steps: 8 });
  await page.mouse.up();
  assert((await titles()).join('|') === 'Первая|Третья|Вторая', `After drag: ${await titles()}`);
  assert(!(await page.evaluate(() => document.querySelector('#drawer').classList.contains('open'))), 'Dragging must not open the task');
  assert(await page.evaluate(() => (projectMeta.__myorder__.list || []).length) === 3, 'Order is stored');

  // Keyboard: move the last one up.
  await page.locator('#myTasksView .mytask-row').nth(2).locator('[data-my-grip]').focus();
  await page.keyboard.press('ArrowUp');
  assert((await titles()).join('|') === 'Первая|Вторая|Третья', `After keyboard: ${await titles()}`);

  // Order survives a re-render and a brand-new task shows up first.
  await page.evaluate(() => { standaloneTasks.push({ id: 60, title: 'Новая', status: 'Очередь', owner: 'Яковлев В.', end: '', description: '', comment: '' }); renderMyTasks(); });
  assert((await titles()).join('|') === 'Новая|Первая|Вторая|Третья', `After re-render: ${await titles()}`);
  await page.evaluate(() => { window.myTasksFilter = 'focus'; renderMyTasks(); });
  assert((await page.locator('#myTasksView .mytask-group-noproject .mytask-title').allTextContents()).join('|') === 'Новая|Первая|Вторая|Третья', 'Same order in the main view');

  // Click still opens a task.
  await page.locator('#myTasksView .mytask-row').nth(1).locator('.mytask-title').click();
  await page.waitForFunction(() => document.querySelector('#drawer').classList.contains('open'));
  assert(errors.length === 0, `Page errors: ${errors.join('\n')}`);
  assert(unexpected.length === 0, `Unexpected requests: ${unexpected.join(', ')}`);
  console.log('My tasks reorder OK: drag, keyboard, persisted order, new tasks on top');
} finally {
  await browser.close();
  server.close();
}
