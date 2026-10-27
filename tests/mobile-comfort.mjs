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

  // Tasks of a project go as a list by status, like «Мои задачи» (no swiping between columns).
  assert(await page.locator('#statusStrip').isHidden(), 'No column switcher: the board is a list on a phone');
  const cols = await page.locator('.board .column').evaluateAll((els) => els.slice(0, 3).map((e) => { const r = e.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width) }; }));
  assert(cols.length >= 2 && cols[0].x === cols[1].x && cols[1].y > cols[0].y, `Statuses stack one under another: ${JSON.stringify(cols)}`);
  assert(cols[0].w >= 340, `Lists fill the screen width: ${cols[0].w}px`);
  const rowBox = await page.locator('.board article.task').first().boundingBox();
  assert(rowBox.width >= 330 && rowBox.height < 110, `A task is a compact full-width row: ${JSON.stringify(rowBox)}`);

  // Projects open from a button instead of a scrolling ribbon.
  assert(await page.locator('#projects').isHidden(), 'The project ribbon is hidden by default');
  assert(await page.locator('#mbProjectBtn').isVisible(), 'The project button is shown');
  await page.locator('#mbProjectBtn').click();
  await page.locator('#projects .project').first().waitFor({ state: 'visible' });
  assert(await page.evaluate(() => document.body.classList.contains('mb-projects-open')), 'Project sheet opens');
  await page.locator('#projects .project').first().click();
  await page.waitForFunction(() => !document.body.classList.contains('mb-projects-open'));

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

  // Space: the board gets most of the screen; the top bar lives under «Ещё».
  const room = await page.evaluate(() => {
    const col = document.querySelector('.column').getBoundingClientRect();
    const barTop = document.getElementById('mobileBar').getBoundingClientRect().top;
    return { top: col.top, room: barTop - col.top };
  });
  assert(room.top <= 200, `Columns should start high on the screen, got ${room.top}px`);
  assert(room.room >= 0.6 * 844 - 80, `Columns should have most of the screen, got ${room.room}px`);
  assert(await page.locator('#globalSearch').isHidden(), 'Global search is tucked under «Ещё» on a phone');
  await page.locator('#mobileBar [data-mb="more"]').click();
  await page.locator('#globalSearch').waitFor({ state: 'visible' });
  assert(await page.locator('#cloudButton').isVisible() && await page.locator('#teamTopButton').isVisible(), '«Ещё» shows account and participants');
  await page.keyboard.press('Escape');
  await page.locator('#globalSearch').waitFor({ state: 'hidden' });
  await page.locator('#mobileBar [data-mb="more"]').click();
  await page.locator('#cloudButton').click();
  await page.locator('#globalSearch').waitFor({ state: 'hidden' });
  await page.locator('#cloudModal.show').waitFor();
  await page.locator('#cloudModal').evaluate((m) => m.classList.remove('show'));

  // Quick filters live in the filter panel and mark the button when active.
  assert(await page.locator('[data-quick-filter="mine"]').isHidden(), 'Quick filters are folded away by default');
  await page.locator('#toolbarToggle').click();
  await page.locator('[data-quick-filter="mine"]').waitFor({ state: 'visible' });
  await page.locator('[data-quick-filter="mine"]').click();
  await page.locator('#toolbarToggle').click();
  assert((await page.locator('#toolbarToggle').textContent()).includes('•'), 'An active filter should be marked on the button');
  await page.locator('#toolbarToggle').click();
  await page.locator('[data-quick-filter="mine"]').click();
  await page.locator('#toolbarToggle').click();

  // Stability: a focused select must never hide the bar; only a real on-screen keyboard does.
  await page.locator('#toolbarToggle').click();
  await page.locator('#sortFilter').selectOption('date');
  await page.locator('#sortFilter').focus();
  assert(await page.locator('#mobileBar').isVisible(), 'A focused select must not hide the bottom bar');
  await page.locator('#toolbarToggle').click();
  await page.locator('#taskSearch').focus();
  assert(await page.locator('#mobileBar').isVisible(), 'Focus alone (no keyboard) must not hide the bottom bar');
  await page.setViewportSize({ width: 390, height: 440 });
  await page.waitForFunction(() => document.documentElement.classList.contains('kb-open'));
  assert(await page.locator('#mobileBar').isHidden(), 'Bar should hide while the keyboard is open');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#taskSearch').blur();
  await page.waitForFunction(() => !document.documentElement.classList.contains('kb-open'));
  assert(await page.locator('#mobileBar').isVisible(), 'Bar returns when the keyboard closes');

  // The «Ещё» menu never traps the user: navigation closes it and the bar stays usable.
  await page.locator('#mobileBar [data-mb="more"]').click();
  await page.locator('#globalSearch').waitFor({ state: 'visible' });
  assert(await page.locator('#mobileBar').isVisible(), 'Bar stays visible while «Ещё» is open');
  await page.locator('#mobileBar [data-mb="mytasks"]').click();
  await page.locator('#globalSearch').waitFor({ state: 'hidden' });
  assert(await page.evaluate(() => activeView) === 'mytasks', 'Navigation works from the open «Ещё» menu');
  await page.locator('#mobileBar [data-mb="tasks"]').click();

  // Review: active project tab stays visible, drawer actions form a compact grid, touch targets are big enough.
  await page.evaluate(() => switchView('releases'));
  await page.waitForTimeout(150);
  const tabBox = await page.locator('#tabs .tab.active').boundingBox();
  assert(tabBox && tabBox.x >= 0 && tabBox.x + tabBox.width <= 391, `Active tab is visible: ${JSON.stringify(tabBox)}`);
  await page.evaluate(() => { switchView('tasks'); openTask(1); });
  const save = await page.locator('#saveTask').boundingBox();
  const pin = await page.locator('#pinTask').boundingBox();
  assert(save.width > 300 && pin.width < save.width * 0.7, `Drawer actions use a 2-column grid: save ${save.width}, pin ${pin.width}`);
  assert(pin.height >= 40, `Drawer buttons are tall enough: ${pin.height}`);
  await page.evaluate(() => closeDrawer());
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

  console.log('Mobile comfort OK: bottom navigation, project button, task list, desktop untouched');
} finally {
  await browser.close();
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}
