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

const session = {
  access_token: 'mock-access-token',
  refresh_token: 'r',
  user: { id: '00000000-0000-4000-8000-000000000001', email: 'owner@example.test', user_metadata: {} },
};
const remoteState = {
  data: [
    { name: 'Автооплата ГП', tasks: [{ id: 1, title: 'Existing', status: 'Очередь', owner: 'Яковлев В.', end: '' }] },
    { name: 'Мобильное приложение', tasks: [] },
    { name: 'Мобильный банк', tasks: [] },
  ],
  projectMeta: { 'Автооплата ГП': { milestones: [], docs: [], links: [], statusOrder: ['В работе', 'Очередь', 'На анализе', 'Готово'] } },
  standaloneTasks: [],
  members: [{ name: 'Яковлев В.', email: 'owner@example.test', linked: true }],
};
const pad = (n) => String(n).padStart(2, '0');
const tomorrow = new Date(Date.now() + 864e5);
const tomorrowRu = `${pad(tomorrow.getDate())}.${pad(tomorrow.getMonth() + 1)}.${tomorrow.getFullYear()}`;

let inbox = [
  { id: 1, title: 'Позвонить в банк', description: 'Уточнить тариф', due: 'завтра', project_hint: '', created_at: new Date().toISOString(), consumed_at: null },
  { id: 2, title: 'Отчёт по тарифам', description: '', due: '30.10', project_hint: 'автооплата', created_at: new Date().toISOString(), consumed_at: null },
  { id: 3, title: 'Неоднозначный проект', description: '', due: '', project_hint: 'мобильн', created_at: new Date().toISOString(), consumed_at: null },
  { id: 4, title: 'Уже забрана другой вкладкой', description: '', due: '', project_hint: '', created_at: new Date().toISOString(), consumed_at: null, claimedElsewhere: true },
];

try {
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
  const errors = [];
  const writes = [];
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
    if (url.pathname === '/rest/v1/kanban_state' && request.method() === 'POST') {
      writes.push(request.postDataJSON());
      return route.fulfill({ status: 201, body: '' });
    }
    if (url.pathname === '/rest/v1/telegram_inbox' && request.method() === 'GET') {
      return ok(inbox.filter((r) => !r.consumed_at).map(({ claimedElsewhere, consumed_at, ...r }) => r));
    }
    if (url.pathname === '/rest/v1/telegram_inbox' && request.method() === 'PATCH') {
      const id = Number(url.searchParams.get('id').replace('eq.', ''));
      assert(url.searchParams.get('consumed_at') === 'is.null', 'Claim must only take unconsumed rows');
      const row = inbox.find((r) => r.id === id);
      if (!row || row.consumed_at || row.claimedElsewhere) {
        if (row) row.consumed_at = 'elsewhere';
        return ok([]);
      }
      row.consumed_at = request.postDataJSON().consumed_at;
      return ok([row]);
    }
    if (['/rest/v1/notifications', '/rest/v1/kanban_profiles', '/rest/v1/messenger_accounts', '/rest/v1/shared_projects'].includes(url.pathname)) return ok([]);
    unexpected.push(`${request.method()} ${url.pathname}`);
    return ok({ error: 'Unexpected mocked request' }, 501);
  });
  await page.addInitScript((saved) => localStorage.setItem('fintech-kanban-session', JSON.stringify(saved)), session);
  await page.goto(`${origin}/`);
  await page.locator('.app').waitFor({ state: 'visible' });
  await page.waitForFunction(() => standaloneTasks.length >= 2, null, { timeout: 8000 });

  const result = await page.evaluate(() => ({
    standalone: standaloneTasks.map((t) => ({ title: t.title, owner: t.owner, end: t.end, description: t.description, source: t.source, comment: t.comment })),
    auto: data.find((p) => p.name === 'Автооплата ГП').tasks.map((t) => ({ title: t.title, status: t.status, end: t.end, owner: t.owner })),
  }));
  const call = result.standalone.find((t) => t.title === 'Позвонить в банк');
  assert(call && call.owner === 'Яковлев В.' && call.end === tomorrowRu && call.description === 'Уточнить тариф' && call.source === 'telegram',
    `Task without a project goes to me with a normalised due date: ${JSON.stringify(call)}`);
  assert(call.comment.includes('Создано из Telegram'), 'Task history should say it came from Telegram');
  const report = result.auto.find((t) => t.title === 'Отчёт по тарифам');
  assert(report && report.status === 'В работе' && report.end === `30.10.${new Date().getFullYear()}` && report.owner === 'Яковлев В.',
    `#hint should place the task into the matching project, first column: ${JSON.stringify(report)}`);
  assert(result.standalone.some((t) => t.title === 'Неоднозначный проект'), 'An ambiguous #hint falls back to «Мои задачи»');
  assert(!JSON.stringify(result).includes('Уже забрана другой вкладкой'), 'A row claimed by another tab must not be imported twice');
  assert(inbox.every((r) => r.consumed_at), 'All rows should be consumed');

  await page.waitForTimeout(1200);
  const saved = writes.at(-1)?.state;
  assert(saved?.standaloneTasks?.some((t) => t.title === 'Позвонить в банк'), 'Imported tasks must be saved to the cloud');

  // Second poll does not duplicate anything.
  await page.evaluate(() => importTelegramInbox());
  assert(await page.evaluate(() => standaloneTasks.filter((t) => t.title === 'Позвонить в банк').length) === 1, 'Polling again must not duplicate tasks');

  // «Мои задачи» shows tasks without a project and opens them.
  await page.evaluate(() => switchView('mytasks'));
  const row = page.locator('#myTasksView .mytask-row', { hasText: 'Позвонить в банк' });
  assert((await row.textContent()).includes('Без проекта') && (await row.textContent()).includes('из Telegram'), 'My tasks should label tasks without a project and from Telegram');
  await row.click();
  await page.waitForFunction(() => document.querySelector('#drawer').classList.contains('open'));
  assert((await page.locator('#dTitle').textContent()).includes('Позвонить в банк'), 'Clicking a task without a project should open it');

  assert(!unexpected.length, `Unexpected network requests: ${unexpected.join('; ')}`);
  assert(!errors.length, `Browser page errors: ${errors.join('; ')}`);
  console.log('Telegram inbox OK: tasks land in «Мои задачи» or the #project, due dates normalised, no duplicates, saved, visible and openable in My tasks');
} finally {
  await browser.close();
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}
