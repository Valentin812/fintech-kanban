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

async function open(viewport, mobile) {
  const context = await browser.newContext({ viewport, hasTouch: mobile, isMobile: mobile });
  const page = await context.newPage();
  const errors = [];
  const unexpected = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === origin) return route.continue();
    const ok = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.origin !== 'https://vdlfdnhfiiltdyrucdtn.supabase.co') { unexpected.push(url.href); return route.abort(); }
    if (url.pathname === '/auth/v1/user') return ok(session.user);
    if (url.pathname === '/rest/v1/kanban_state' && request.method() === 'GET') return ok([{ user_id: ME, state: remoteState }]);
    if (url.pathname === '/rest/v1/kanban_state') return route.fulfill({ status: 201, body: '' });
    if (url.pathname === '/functions/v1/admin-users') return ok({ error: 'Forbidden' }, 403);
    if (url.pathname.startsWith('/rest/v1/')) return ok([]);
    unexpected.push(`${request.method()} ${url.pathname}`);
    return ok({ error: 'Unexpected mocked request' }, 501);
  });
  await page.addInitScript((saved) => localStorage.setItem('fintech-kanban-session', JSON.stringify(saved)), session);
  await page.goto(`${origin}/`);
  await page.locator('.app').waitFor({ state: 'visible' });
  await page.evaluate(() => { activeProject = 'Main'; switchView('tasks'); renderAll(); });
  return { page, context, errors, unexpected };
}

try {
  // Phone: bottom navigation, column switcher, full-width columns.
  const phone = await open({ width: 390, height: 844 }, true);
  const { page } = phone;
  assert(await page.locator('#mobileBar').isVisible(), 'Bottom navigation should be visible on a phone');
  const bar = await page.locator('#mobileBar').boundingBox();
  assert(Math.abs(bar.y + bar.height - 844) <= 1, 'Bottom navigation should be pinned to the bottom edge');
  assert(await page.locator('#mobileBar [data-mb="tasks"].active').count() === 1, 'The board tab should be active in a project');
  const headerBottom = await page.locator('#taskToolbar').boundingBox();
  assert(headerBottom.y < 170, `Header should be compact, toolbar starts at ${headerBottom.y}px`);

  const strip = page.locator('#statusStrip button');
  assert(await strip.count() >= 3, 'Column switcher should list the columns');
  assert((await strip.first().textContent()).includes('1'), 'Column switcher shows task counts');
  const colWidth = (await page.locator('.column').first().boundingBox()).width;
  assert(colWidth >= 340, `Columns should almost fill the screen, got ${colWidth}px`);

  await strip.nth(1).click();
  await page.waitForFunction(() => document.querySelector('#board').scrollLeft > 100);
  await page.waitForFunction(() => document.querySelectorAll('#statusStrip button')[1].classList.contains('active'));
  await strip.nth(2).click();
  await page.waitForFunction(() => document.querySelectorAll('#statusStrip button')[2].classList.contains('active'));

  // «+» creates a task in the current context.
  await page.locator('#mobileBar [data-mb="add"]').click();
  await page.locator('#modal.show').waitFor();
  await page.locator('#modal.show').evaluate((m) => m.classList.remove('show'));
  await page.locator('#mobileBar [data-mb="mytasks"]').click();
  await page.waitForFunction(() => activeView === 'mytasks');
  assert(await page.locator('#statusStrip').isHidden(), 'Column switcher is only for the board');
  await page.locator('#mobileBar [data-mb="add"]').click();
  await page.locator('#standaloneTaskModal.show').waitFor();
  await page.locator('#standaloneTaskModal.show').evaluate((m) => m.classList.remove('show'));
  await page.locator('#mobileBar [data-mb="home"]').click();
  await page.waitForFunction(() => activeView === 'home');
  assert(await page.locator('#mobileBar [data-mb="home"].active').count() === 1, 'Home tab should become active');
  await page.locator('#mobileBar [data-mb="tasks"]').click();
  await page.waitForFunction(() => activeView === 'tasks');

  // Typing hides the bar so it never covers the keyboard.
  await page.locator('#taskSearch').focus();
  assert(await page.locator('#mobileBar').isHidden(), 'Bar should hide while typing');
  await page.locator('#taskSearch').blur();

  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No horizontal page scroll on a phone');
  assert(!phone.unexpected.length, `Unexpected requests: ${phone.unexpected.join('; ')}`);
  assert(!phone.errors.length, `Page errors: ${phone.errors.join('; ')}`);
  await phone.context.close();

  // Desktop: nothing of this should appear.
  const desktop = await open({ width: 1300, height: 900 }, false);
  assert(await desktop.page.locator('#mobileBar').isHidden(), 'Bottom navigation must not appear on desktop');
  assert(await desktop.page.locator('#statusStrip').isHidden(), 'Column switcher must not appear on desktop');
  assert(await desktop.page.locator('#homeNav').isVisible(), 'Sidebar navigation stays on desktop');
  assert(!desktop.errors.length, `Page errors: ${desktop.errors.join('; ')}`);
  await desktop.context.close();

  console.log('Mobile comfort OK: bottom navigation, column switcher, full-width columns, desktop untouched');
} finally {
  await browser.close();
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}
