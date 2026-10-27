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
const task = (id, title, status, owner = 'Яковлев В.') => ({ id, title, status, owner, end: '', description: '', comment: '' });
const remoteState = {
  data: [{ name: 'Main', tasks: [task(1, 'Первая', 'Очередь'), task(2, 'Вторая', 'В работе'), task(3, 'Третья', 'Готово')] }],
  projectMeta: {},
  standaloneTasks: [task(50, 'Без проекта', 'Очередь')],
  members: [{ name: 'Яковлев В.', email: 'owner@example.test', linked: true }],
};

async function open(viewport) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const errors = [];
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === origin) return route.continue();
    const ok = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.origin !== 'https://vdlfdnhfiiltdyrucdtn.supabase.co') return route.abort();
    if (url.pathname === '/auth/v1/user') return ok(session.user);
    if (url.pathname === '/rest/v1/kanban_state' && request.method() === 'GET') return ok([{ user_id: ME, state: remoteState }]);
    if (url.pathname === '/rest/v1/kanban_state') return route.fulfill({ status: 201, body: '' });
    if (url.pathname === '/functions/v1/admin-users') return ok({ error: 'Forbidden' }, 403);
    if (url.pathname.startsWith('/rest/v1/')) return ok([]);
    return ok({ error: 'Unexpected' }, 501);
  });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript((saved) => localStorage.setItem('fintech-kanban-session', JSON.stringify(saved)), session);
  await page.goto(`${origin}/`);
  await page.locator('.app').waitFor({ state: 'visible' });
  await page.evaluate(() => { activeProject = 'Main'; switchView('tasks'); renderAll(); });
  return { page, errors, context };
}

try {
  const { page, errors } = await open({ width: 1300, height: 800 });
  const height = () => page.locator('article.task[data-id="1"]').evaluate((e) => e.getBoundingClientRect().height);
  const normal = await height();
  await page.locator('#viewModeToggle').click();
  const compact = await height();
  assert(await page.evaluate(() => document.documentElement.dataset.density) === 'compact', 'Density is switched on');
  assert(compact < normal * 0.75, `Compact cards are noticeably lower: ${normal} → ${compact}`);
  await page.reload();
  await page.locator('.app').waitFor({ state: 'visible' });
  assert(await page.evaluate(() => document.documentElement.dataset.density) === 'compact', 'The choice is remembered');
  await page.locator('#viewModeToggle').click();
  await page.locator('#viewModeToggle').click();
  assert(await page.evaluate(() => document.documentElement.dataset.density) === 'normal', 'Switches back');
  assert(!errors.length, `Page errors: ${errors.join('; ')}`);
  console.log('Compact cards OK: lower cards, remembered, switchable');
} finally {
  await browser.close();
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}
