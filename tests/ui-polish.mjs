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
  const bw = await page.locator('#board .column').first().evaluate((e) => e.getBoundingClientRect().width);
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
  // Only a custom background: upload, remembered, removable; no presets
  await page.evaluate(() => cloudOpen());
  assert(await page.locator('#bgSelect').count() === 0, 'No preset backgrounds are offered');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  await page.setInputFiles('#bgFile', { name: 'bg.png', mimeType: 'image/png', buffer: png });
  await page.waitForFunction(() => document.body.getAttribute('data-bg') === 'custom');
  await page.reload(); await page.locator('.app').waitFor({ state: 'visible' });
  assert(await page.evaluate(() => document.body.getAttribute('data-bg')) === 'custom', 'Custom background is remembered');
  await page.evaluate(() => cloudOpen());
  await page.locator('#bgClear').click();
  assert(await page.evaluate(() => document.body.getAttribute('data-bg')) === null, 'Background can be removed');
  await page.evaluate(() => { document.getElementById('cloudModal').classList.remove('show'); });
  // List width grip
  await page.evaluate(() => { document.documentElement.dataset.layout = 'rows'; switchView('tasks'); });
  await page.waitForTimeout(600);
  const gb = await page.locator('#listWidthGrip').boundingBox();
  assert(gb, 'Width grip is visible for the rows block');
  // Полоса прокрутки доски у правого края области, а не у края блока
  const edge = await page.evaluate(() => { const b = document.getElementById('board').getBoundingClientRect(), m = document.querySelector('.main').getBoundingClientRect(), c = document.querySelector('#board .column').getBoundingClientRect(); return { boardRight: b.right, mainRight: m.right, colWidth: c.width }; });
  assert(Math.abs(edge.boardRight - edge.mainRight) < 3, 'Board scrollbar sits at the right edge: ' + JSON.stringify(edge));
  assert(edge.colWidth <= 881, 'Rows block stays narrow: ' + edge.colWidth);
  const colW = () => page.locator('#board .column').first().evaluate((e) => e.getBoundingClientRect().width);
  const w0 = await colW();
  await page.mouse.move(gb.x + 4, gb.y + 100); await page.mouse.down(); await page.mouse.move(gb.x - 150, gb.y + 100, { steps: 5 }); await page.mouse.up();
  const w1 = await colW();
  assert(w1 < w0 - 100, `Block got narrower by dragging: ${w0} -> ${w1}`);
  assert(await page.evaluate(() => localStorage.getItem('fintech-kanban-list-w')) !== null, 'Width is remembered');
  // Rows look like «Мои задачи»: title above, info line under it, on the left
  const geo = await page.locator('#board article.task').first().evaluate((e) => { const t = e.querySelector('.tasktitle').getBoundingClientRect(), m = e.querySelector('.subtask-add').getBoundingClientRect(), c = e.getBoundingClientRect(); return { below: m.top >= t.bottom - 2, left: m.left - c.left }; });
  assert(geo.below && geo.left < 400, 'Info line is under the title and near the left: ' + JSON.stringify(geo));
  // New column is created with Enter; an empty column has one «Добавить задачу» only
  await page.evaluate(() => { document.documentElement.dataset.layout = 'columns'; switchView('tasks'); });
  await page.locator('#addStatus').click();
  await page.locator('.status-inline-input').fill('Тест-колонка');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('.column[data-status="Тест-колонка"]'));
  assert(await page.locator('.column[data-status="Тест-колонка"] .colhead .plus[data-add]').count() === 0, 'No header plus in an empty column');
  assert(await page.locator('.column[data-status="Тест-колонка"] >> text=Добавить задачу').count() === 1, 'One add-task button in an empty column');
  // Pixel theme is dark
  await page.evaluate(() => applyTheme('pixel'));
  const lum = await page.evaluate(() => { const [r, g, b] = getComputedStyle(document.body).backgroundColor.match(/\d+/g).map(Number); return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; });
  assert(lum < 0.3, 'Pixel theme is dark: ' + lum);
  // Lists in «Мои задачи» are dark in Pixel too (no white blocks with pale text)
  await page.evaluate(() => { switchView('inbox'); const v = document.getElementById('myTasksView'); if (!v.querySelector('.mytask-list')) { const d = document.createElement('div'); d.className = 'mytask-list'; d.innerHTML = '<button class="mytask-row"><span class="mytask-title">Проверка</span></button>'; v.appendChild(d); } });
  const lists = await page.evaluate(() => { const L = (c) => { const [r, g, b] = c.match(/\d+/g).map(Number); return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 }; const l = document.querySelector('#myTasksView .mytask-list'); return { bg: L(getComputedStyle(l).backgroundColor), text: L(getComputedStyle(l.querySelector('.mytask-title')).color) }; });
  assert(lists.bg < 0.3 && lists.text > 0.6, 'Pixel task list is dark with light text: ' + JSON.stringify(lists));
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
