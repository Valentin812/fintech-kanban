import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

// The server exposes an ETag so the app can detect a new deployment.
let versionTag = '"v1"';
const html = await readFile('index.html');
const server = createServer((request, response) => {
  if (new URL(request.url, 'http://x').pathname !== '/') {
    response.writeHead(404).end('Not found');
    return;
  }
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', ETag: versionTag });
  response.end(request.method === 'HEAD' ? undefined : html);
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();
const origin = `http://127.0.0.1:${port}`;
const launchOptions = { headless: true };
if (process.env.CHROMIUM_EXECUTABLE) launchOptions.executablePath = process.env.CHROMIUM_EXECUTABLE;
const browser = await chromium.launch(launchOptions);

const pad = (n) => String(n).padStart(2, '0');
const ru = (d) => `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
const today = new Date();
const yesterday = new Date(Date.now() - 864e5);
const nextWeek = new Date(Date.now() + 7 * 864e5);

const session = {
  access_token: 'mock-access-token',
  refresh_token: 'mock-refresh-token',
  token_type: 'bearer',
  expires_in: 3600,
  user: { id: '00000000-0000-4000-8000-000000000001', aud: 'authenticated', role: 'authenticated', email: 'owner@example.test', app_metadata: {}, user_metadata: {} },
};
const task = (id, title, status, owner, end, comment = '') => ({ id, title, start: '', end, status, owner, description: '', comment, link: '', mt: '' });
const remoteState = {
  data: [{ name: 'Extras project', tasks: [
    task(1, 'Overdue mine', 'В работе', 'Яковлев В.', ru(yesterday), '22.10.2026, 10:00:00 — Первый комментарий\n\n23.10.2026, 11:00:00 — Второй <b>комментарий</b>'),
    task(2, 'Due today mine', 'Очередь', 'Яковлев В.', ru(today)),
    task(3, 'Someone else', 'Очередь', 'Сухов Е.', ru(yesterday)),
    task(4, 'Done overdue', 'Готово', 'Яковлев В.', ru(yesterday)),
    task(5, 'Later mine', 'На анализе', 'Яковлев В.', ru(nextWeek)),
  ] }],
  projectMeta: {},
  standaloneTasks: [],
  members: [{ name: 'Яковлев В.', email: 'owner@example.test', linked: true }],
};
const serverNotifications = [
  { id: 7, sender_name: 'Коллега (colleague@example.test)', kind: 'assignment', title: 'Assigned by colleague', project: 'Их проект', due: '01.12.26', created_at: new Date().toISOString(), read_at: null },
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  const writes = [];
  const patches = [];
  const unexpected = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('dialog', (dialog) => dialog.accept());
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
    if (url.pathname === '/rest/v1/kanban_state' && request.method() === 'POST') {
      writes.push(request.postDataJSON());
      return route.fulfill({ status: 201, body: '' });
    }
    if (url.pathname === '/rest/v1/notifications' && request.method() === 'GET') return ok(serverNotifications);
    if (url.pathname === '/rest/v1/notifications' && request.method() === 'PATCH') {
      patches.push({ query: url.search, body: request.postDataJSON() });
      return route.fulfill({ status: 204, body: '' });
    }
    if (url.pathname === '/rest/v1/kanban_profiles' || url.pathname === '/rest/v1/messenger_accounts' || url.pathname === '/rest/v1/shared_projects' || url.pathname === '/rest/v1/telegram_inbox') return ok([]);
    unexpected.push(`${request.method()} ${url.pathname}`);
    return ok({ error: 'Unexpected mocked request' }, 501);
  });
  await page.addInitScript((saved) => localStorage.setItem('fintech-kanban-session', JSON.stringify(saved)), session);
  await page.goto(`${origin}/`);
  await page.locator('.app').waitFor({ state: 'visible' });

  // 1. Columns can be reordered and the order is saved per project.
  const columnOrder = () => page.locator('#board .column').evaluateAll((cols) => cols.map((c) => c.dataset.status));
  assert(JSON.stringify(await columnOrder()) === JSON.stringify(['Очередь', 'В работе', 'На анализе', 'Готово']), 'Unexpected initial column order');
  assert(await page.locator('#board .col-move-btn, #board [data-move-status]').count() === 0, 'Columns are reordered with the mouse only — no arrow buttons');
  const headerBox = async (st) => page.locator(`.column[data-status="${st}"]`).boundingBox();
  let box = await headerBox('На анализе');
  await page.locator('.column[data-status="Готово"] .col-grip').dragTo(page.locator('.column[data-status="На анализе"]'), { targetPosition: { x: 8, y: 20 } });
  box = await headerBox('В работе');
  await page.locator('.column[data-status="Очередь"] .col-grip').dragTo(page.locator('.column[data-status="В работе"]'), { targetPosition: { x: Math.round(box.width) - 8, y: 20 } });
  const reordered = ['В работе', 'Очередь', 'Готово', 'На анализе'];
  assert(JSON.stringify(await columnOrder()) === JSON.stringify(reordered), `Columns were not reordered: ${await columnOrder()}`);
  await page.waitForTimeout(1200);
  assert(JSON.stringify(writes.at(-1)?.state?.projectMeta?.['Extras project']?.statusOrder) === JSON.stringify(reordered), 'Column order must be saved to the cloud');
  await page.evaluate(() => openTask(5));
  assert(await page.locator('label', { hasText: 'Колонка' }).first().isVisible(), 'Task drawer should call the field «Колонка»');
  const options = await page.locator('#dStatus option').evaluateAll((o) => o.map((x) => x.value));
  assert(JSON.stringify(options) === JSON.stringify(reordered), `Task drawer should list columns in board order: ${options}`);
  await page.locator('#closeDrawer').click();
  assert(await page.locator('#addStatus', { hasText: 'Добавить колонку' }).count() === 1, 'Add button should say «Добавить колонку»');

  // 2. Comments can be previewed without opening the card.
  const peekButton = page.locator('article.task[data-id="1"] [data-comment-peek]');
  assert((await peekButton.textContent()).includes('2'), 'Comment indicator should show the number of comments');
  await peekButton.hover();
  await page.locator('#commentPeek:not([hidden])').waitFor();
  const peekText = await page.locator('#commentPeek').textContent();
  assert(peekText.includes('Первый комментарий') && peekText.includes('Второй <b>комментарий</b>'), `Preview should show comments as plain text: ${peekText}`);
  assert(!(await page.locator('#drawer').evaluate((d) => d.classList.contains('open'))), 'Hovering the indicator must not open the task');
  await peekButton.click();
  assert(!(await page.locator('#drawer').evaluate((d) => d.classList.contains('open'))), 'Clicking the indicator must not open the task');
  await page.mouse.move(5, 5);
  await page.locator('#commentPeek').waitFor({ state: 'hidden' });

  // 3. In-app notifications: assignment from a colleague + my deadlines.
  await page.locator('#notifButton').waitFor({ state: 'visible' });
  await page.waitForFunction(() => !document.querySelector('#notifBadge').hidden);
  assert(await page.locator('#notifBadge').textContent() === '3', `Badge should count 1 assignment + 2 deadlines, got ${await page.locator('#notifBadge').textContent()}`);
  await page.locator('#notifButton').click();
  await page.locator('#notifPanel:not([hidden])').waitFor();
  const panel = await page.locator('#notifPanel').textContent();
  assert(panel.includes('Assigned by colleague') && panel.includes('Коллега'), 'Panel should show the assignment and who sent it');
  assert(panel.includes('Overdue mine') && panel.includes('Due today mine'), 'Panel should show my overdue and due-today tasks');
  assert(!panel.includes('Someone else') && !panel.includes('Done overdue') && !panel.includes('Later mine'), 'Panel must skip other people, finished and later tasks');
  await page.waitForFunction(() => document.querySelector('#notifBadge').hidden);
  assert(patches.length === 1 && patches[0].query.includes('read_at=is.null') && patches[0].body.read_at, `Opening the panel should mark notifications read: ${JSON.stringify(patches)}`);
  await page.locator('#notifPanel [data-notif-task="1"]').click();
  await page.waitForFunction(() => document.querySelector('#drawer').classList.contains('open'));
  assert((await page.locator('#dTitle').textContent()).includes('Overdue mine'), 'Clicking a deadline should open that task');
  await page.locator('#closeDrawer').click();

  // 4. A new deployment shows the update banner.
  assert(await page.locator('#updateBanner').count() === 0, 'No update banner before a new version');
  versionTag = '"v2"';
  await page.evaluate(() => checkForAppUpdate());
  await page.locator('#updateBanner').waitFor();
  assert((await page.locator('#updateBanner').textContent()).includes('новая версия'), 'Banner should announce the new version');
  await page.locator('#updateLater').click();
  assert(await page.locator('#updateBanner').count() === 0, '«Позже» should hide the banner');

  assert(!unexpected.length, `Unexpected network requests: ${unexpected.join('; ')}`);
  assert(!errors.length, `Browser page errors: ${errors.join('; ')}`);
  console.log('Board extras OK: column reorder + wording, comment preview, in-app notifications and deadlines, update banner');
} finally {
  await browser.close();
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}
