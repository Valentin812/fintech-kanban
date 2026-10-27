import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

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

const session = { access_token: 'mock-access-token', refresh_token: 'r', user: { id: '00000000-0000-4000-8000-000000000001', email: 'owner@example.test', user_metadata: {} } };
const task = (id, title, status) => ({ id, title, status, owner: 'Яковлев В.', end: '', start: '', description: '', comment: '' });
const remoteState = {
  data: [{ name: 'Main', tasks: [task(1, 'Первая задача', 'Очередь'), task(2, 'Вторая задача', 'В работе')] }],
  projectMeta: {},
  standaloneTasks: [],
  members: [{ name: 'Яковлев В.', email: 'owner@example.test', linked: true }],
};

async function openPage(viewport, extra = {}) {
  const page = await browser.newPage({ viewport, ...extra });
  const errors = [];
  const unexpected = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === origin) return route.continue();
    const ok = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.origin !== 'https://vdlfdnhfiiltdyrucdtn.supabase.co') {
      unexpected.push(url.href);
      return route.abort();
    }
    if (url.pathname === '/auth/v1/user') return ok(session.user);
    if (url.pathname === '/rest/v1/kanban_state' && request.method() === 'GET') return ok([{ user_id: session.user.id, state: remoteState }]);
    if (url.pathname === '/rest/v1/kanban_state' && request.method() === 'POST') return route.fulfill({ status: 201, body: '' });
    if (url.pathname === '/functions/v1/admin-users') return ok({ error: 'Forbidden' }, 403);
    if (['/rest/v1/notifications', '/rest/v1/kanban_profiles', '/rest/v1/messenger_accounts', '/rest/v1/shared_projects', '/rest/v1/telegram_inbox', '/rest/v1/kanban_avatars'].includes(url.pathname)) return ok([]);
    unexpected.push(`${request.method()} ${url.pathname}`);
    return ok({ error: 'Unexpected mocked request' }, 501);
  });
  await page.addInitScript((saved) => localStorage.setItem('fintech-kanban-session', JSON.stringify(saved)), session);
  await page.goto(`${origin}/`);
  await page.locator('.app').waitFor({ state: 'visible' });
  await page.evaluate(() => { activeProject = 'Main'; switchView('tasks'); renderAll(); });
  return { page, errors, unexpected };
}

try {
  // 1. Themes «Латте» and «Капучино».
  const d = await openPage({ width: 1300, height: 900 });
  const options = await d.page.locator('#themeToggle option').evaluateAll((els) => els.map((o) => [o.value, o.textContent]));
  assert(options.some(([v, t]) => v === 'latte' && t === 'Латте') && options.some(([v, t]) => v === 'cappuccino' && t === 'Капучино'), `Theme list should offer Latte and Cappuccino: ${JSON.stringify(options)}`);
  const colors = {};
  for (const theme of ['light', 'latte', 'cappuccino']) {
    await d.page.evaluate((t) => { themeToggle.value = t; themeToggle.dispatchEvent(new Event('change')); }, theme);
    const state = await d.page.evaluate(() => ({
      theme: document.body.dataset.theme,
      saved: localStorage.getItem('fintech-kanban-theme'),
      bg: getComputedStyle(document.body).backgroundColor,
      card: getComputedStyle(document.querySelector('.task')).backgroundColor,
      ink: getComputedStyle(document.querySelector('.tasktitle, .task')).color,
    }));
    assert(state.theme === theme && state.saved === theme, `Theme ${theme} should be applied and remembered: ${JSON.stringify(state)}`);
    colors[theme] = state;
  }
  const lum = (css) => { const [r, g, b] = css.match(/[\d.]+/g).map(Number); return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; };
  assert(lum(colors.latte.bg) > 0.85 && lum(colors.latte.card) > lum(colors.latte.bg), `Latte should be light with lighter cards: ${JSON.stringify(colors.latte)}`);
  assert(lum(colors.cappuccino.bg) > 0.3 && lum(colors.cappuccino.bg) < 0.55 && lum(colors.cappuccino.card) > lum(colors.cappuccino.bg) && lum(colors.cappuccino.ink) > 0.9, `Cappuccino should be a mid-tone mocha with light text: ${JSON.stringify(colors.cappuccino)}`);
  assert(/^rgb\(\s*(\d+),\s*(\d+),\s*(\d+)\)$/.test(colors.latte.bg) && colors.latte.bg.match(/\d+/g).map(Number).every((v, i, a) => i === 0 || v <= a[0]), 'Latte background should be warm, not blue');
  await d.page.evaluate(() => { themeToggle.value = 'light'; themeToggle.dispatchEvent(new Event('change')); });

  // 2. Compact task drawer: the whole empty card fits on a normal laptop screen.
  await d.page.evaluate(() => openTask(1));
  await d.page.waitForTimeout(350);
  const bottom = await d.page.locator('#drawer .draweractions').evaluate((el) => el.getBoundingClientRect().bottom);
  assert(bottom <= 900, `Drawer actions should be visible without scrolling at 900px height, bottom=${bottom}`);
  await d.page.evaluate(() => closeDrawer());

  // 3. Phone layout: compact header, filters behind a button, no sideways page scroll.
  const m = await openPage({ width: 390, height: 844 }, { hasTouch: true, isMobile: true });
  const layout = await m.page.evaluate(() => ({
    boardTop: document.querySelector('#board').getBoundingClientRect().top,
    sw: document.documentElement.scrollWidth,
    iw: innerWidth,
    ownerShown: getComputedStyle(document.querySelector('#ownerFilter')).display !== 'none',
  }));
  assert(layout.boardTop < 380, `Board should start high on a phone, got ${layout.boardTop}px`);
  assert(layout.sw <= layout.iw, `No horizontal page scroll on a phone: ${layout.sw} > ${layout.iw}`);
  assert(!layout.ownerShown, 'Owner/sort filters should be hidden behind «Фильтры» on a phone');
  await m.page.locator('#toolbarToggle').tap();
  assert(await m.page.locator('#ownerFilter').isVisible() && await m.page.locator('#sortFilter').isVisible(), 'The «Фильтры» button should reveal the filters');
  assert(await m.page.locator('#toolbarToggle').getAttribute('aria-expanded') === 'true', 'Toggle should report its state');
  await m.page.locator('#toolbarToggle').tap();
  assert(!(await m.page.locator('#ownerFilter').isVisible()), 'The second tap should collapse the filters again');
  await m.page.evaluate(() => switchView('roadmap'));
  assert(await m.page.locator('#taskToolbar').isHidden(), 'Task filters must not show on other tabs');
  const tiny = await m.page.evaluate(() => [...document.querySelectorAll('#projects .project, .sidebar .side-actions button, .projecthead .tab, .home-nav, .sidebar-inbox')]
    .filter((e) => e.offsetParent).map((e) => ({ n: e.id || e.className, h: e.getBoundingClientRect().height })).filter((x) => x.h < 34));
  assert(!tiny.length, `Main navigation targets should be at least 34px tall: ${JSON.stringify(tiny)}`);
  await m.page.evaluate(() => { switchView('tasks'); openTask(1); });
  await m.page.waitForTimeout(350);
  const drawer = await m.page.evaluate(() => { const r = document.querySelector('#drawer').getBoundingClientRect(); return { left: r.left, right: r.right, iw: innerWidth }; });
  assert(drawer.left >= 0 && drawer.right <= drawer.iw + 1, `Drawer must fit the phone width: ${JSON.stringify(drawer)}`);

  const errors = [...d.errors, ...m.errors];
  const unexpected = [...d.unexpected, ...m.unexpected];
  assert(!unexpected.length, `Unexpected network requests: ${unexpected.join('; ')}`);
  assert(!errors.length, `Browser page errors: ${errors.join('; ')}`);
  console.log('Mobile + themes OK: Latte/Cappuccino, compact drawer, phone header and filters, tap targets, no overflow');
} finally {
  await browser.close();
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}
