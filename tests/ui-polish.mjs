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
const tk = (id, title) => ({ id, title, status: 'Очередь', owner: 'Яковлев В.', end: '', description: '', comment: '' });
const remoteState = { data: [{ name: 'Альфа', tasks: [tk(1, 'Первая задача с длинным названием'), tk(2, 'Вторая')] }], projectMeta: { 'Альфа': { milestones: [], docs: [], links: [{ title: 'Очень длинное название ссылки для проверки', url: 'https://example.com/very/long/path?x=1' }] } }, standaloneTasks: [], members: [], quickNotes: [{ id: 'n1', text: 'Встреча с ТП Ильёй Мироновым на 28.10', created: Date.now() - 600000, done: false }] };
let lastState = null;
try {
  const context = await browser.newContext({ viewport: { width: 1400, height: 800 } });
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
  // «+ подзадача»
  assert((await page.locator('.subtask-add').first().textContent()).trim() === '＋ подзадача', 'Short subtask label');
  // Rows: narrower block, stays left of the open drawer
  await page.evaluate(() => { document.documentElement.dataset.layout = 'rows'; });
  const bw = await page.locator('#board').evaluate((e) => e.getBoundingClientRect().width);
  assert(bw <= 900, 'Rows block is narrow: ' + bw);
  await page.evaluate(() => openTask(1));
  await page.waitForTimeout(300);
  assert(await page.evaluate(() => document.body.classList.contains('drawer-open')), 'drawer-open class is set');
  const right = await page.locator('#board').evaluate((e) => e.getBoundingClientRect().right);
  const dl = await page.locator('#drawer').evaluate((e) => e.getBoundingClientRect().left);
  assert(right <= dl + 1, `Rows stay visible left of the drawer: board ${right} vs drawer ${dl}`);
  await page.evaluate(() => closeDrawer());
  // Notes layout: text is not squeezed
  await page.locator('#qnTopButton').click();
  const tw = await page.locator('#qnPop .qn-text').first().evaluate((e) => e.getBoundingClientRect().width);
  assert(tw > 150, 'Note text is wide enough: ' + tw);
  await page.keyboard.press('Escape');
  // Background presets + custom upload
  await page.evaluate(() => window.__bg.set('dusk'));
  assert(await page.evaluate(() => document.body.getAttribute('data-bg')) === 'dusk', 'Preset background applied');
  await page.reload(); await page.locator('.app').waitFor({ state: 'visible' });
  assert(await page.evaluate(() => document.body.getAttribute('data-bg')) === 'dusk', 'Background is remembered');
  await page.evaluate(() => cloudOpen());
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  await page.setInputFiles('#bgFile', { name: 'bg.png', mimeType: 'image/png', buffer: png });
  await page.waitForFunction(() => document.body.getAttribute('data-bg') === 'custom');
  await page.locator('#bgClear').click();
  assert(await page.evaluate(() => document.body.getAttribute('data-bg')) === null, 'Background can be removed');
  // Pixel theme is dark
  await page.evaluate(() => applyTheme('pixel'));
  const lum = await page.evaluate(() => { const [r, g, b] = getComputedStyle(document.body).backgroundColor.match(/\d+/g).map(Number); return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; });
  assert(lum < 0.3, 'Pixel theme is dark: ' + lum);
  // Mobile: link title is not squeezed vertically
  await page.setViewportSize({ width: 390, height: 800 });
  await page.evaluate(() => { switchView('links'); renderResources('links'); });
  const lw = await page.locator('#linksView .resource-main a').first().evaluate((e) => e.getBoundingClientRect().width);
  assert(lw > 200, 'Mobile link title is wide: ' + lw);
  assert(!errors.length, 'Page errors: ' + errors.join('; '));
  console.log('UI polish OK: rows, notes, backgrounds, pixel dark, mobile links');
} finally {
  await browser.close();
  await new Promise((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
}
