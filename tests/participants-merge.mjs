import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const html = await readFile('index.html');
const server = createServer((request, response) => {
  if (request.url !== '/') {
    response.writeHead(404).end('Not found');
    return;
  }
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(html);
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();
const origin = `http://127.0.0.1:${port}`;
const launchOptions = { headless: true };
if (process.env.CHROMIUM_EXECUTABLE) launchOptions.executablePath = process.env.CHROMIUM_EXECUTABLE;
const browser = await chromium.launch(launchOptions);

const session = {
  access_token: 'mock-access-token',
  refresh_token: 'mock-refresh-token',
  token_type: 'bearer',
  expires_in: 3600,
  user: { id: '00000000-0000-4000-8000-000000000001', aud: 'authenticated', role: 'authenticated', email: 'owner@example.test', app_metadata: {}, user_metadata: {} },
};
const task = (id, title, owner) => ({ id, title, start: '', end: '', status: 'Очередь', owner, description: '', comment: '', link: '', mt: '' });
const remoteState = {
  data: [{ name: 'Merge project', tasks: [
    task(1, 'Manual name task', 'Лимарь Андрей'),
    task(2, 'Account name task', 'a.s.limar, Яковлев В.'),
    task(3, 'Unrelated task', 'Яковлев В.'),
    task(4, 'Unassigned task', ''),
  ] }],
  projectMeta: {},
  standaloneTasks: [task(5, 'Standalone task', 'Лимарь Андрей')],
  members: [{ name: 'Лимарь Андрей', email: '' }],
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  const writes = [];
  const notifications = [];
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
    if (url.pathname === '/rest/v1/kanban_profiles') {
      return ok([{ user_id: '00000000-0000-4000-8000-000000000002', display_name: 'a.s.limar', email: 'a.s.limar@example.test', created_at: '2026-10-21T06:07:12Z' }]);
    }
    if (url.pathname === '/rest/v1/messenger_accounts' || url.pathname === '/rest/v1/notifications' || url.pathname === '/rest/v1/shared_projects' || url.pathname === '/rest/v1/telegram_inbox') return ok([]);
    if (url.pathname === '/functions/v1/telegram-notify') {
      notifications.push(request.postDataJSON());
      return ok({ sent: true });
    }
    unexpected.push(`${request.method()} ${url.pathname}`);
    return ok({ error: 'Unexpected mocked request' }, 501);
  });
  await page.addInitScript((saved) => localStorage.setItem('fintech-kanban-session', JSON.stringify(saved)), session);
  await page.goto(`${origin}/`);
  await page.locator('.app').waitFor({ state: 'visible' });

  await page.evaluate(async () => { await loadRegisteredParticipants(); switchView('people'); });
  await page.locator('#peopleView [data-merge-person="Лимарь Андрей"]').first().waitFor();
  const before = await page.evaluate(() => allParticipants().map((p) => p.name));
  assert(before.includes('Лимарь Андрей') && before.includes('a.s.limar'), `Both records should exist before merging: ${before}`);

  await page.locator('#peopleView .person-row', { hasText: 'Лимарь Андрей' }).locator('[data-merge-person]').first().click();
  await page.locator('#mergeModal.show').waitFor();
  assert(await page.locator('#mergeTarget').inputValue() === 'a.s.limar', 'The registered account should be suggested as the merge target');
  assert(await page.locator('#mergeFinalName').inputValue() === 'Лимарь Андрей', 'The human-readable manual name should be kept by default');
  const preview = await page.locator('#mergePreview').textContent();
  assert(preview.includes('a.s.limar@example.test') && preview.includes('3'), `Preview should mention the account email and 3 tasks: ${preview}`);

  const saved = page.waitForResponse((r) => r.url().includes('/rest/v1/kanban_state') && r.request().method() === 'POST');
  await page.locator('#mergeConfirm').click();
  await saved;

  const after = await page.evaluate(() => ({
    participants: allParticipants().map((p) => ({ name: p.name, email: p.email, registered: !!p.registered })),
    owners: [...data[0].tasks.map((t) => t.owner), ...standaloneTasks.map((t) => t.owner)],
    members,
  }));
  const limar = after.participants.filter((p) => p.email === 'a.s.limar@example.test' || p.name.includes('Лимарь') || p.name === 'a.s.limar');
  assert(limar.length === 1, `Exactly one merged participant expected: ${JSON.stringify(after.participants)}`);
  assert(limar[0].name === 'Лимарь Андрей' && limar[0].registered, `Merged participant should keep the chosen name and the account: ${JSON.stringify(limar[0])}`);
  assert(JSON.stringify(after.owners) === JSON.stringify(['Лимарь Андрей', 'Лимарь Андрей, Яковлев В.', 'Яковлев В.', '', 'Лимарь Андрей']),
    `Task owners were not renamed correctly: ${JSON.stringify(after.owners)}`);
  const savedState = writes.at(-1)?.state;
  assert(savedState?.members?.some((m) => m.name === 'Лимарь Андрей' && m.email === 'a.s.limar@example.test' && m.linked), 'Merged member must be saved to the cloud');
  assert(await page.locator('#peopleView .person-row', { hasText: 'a.s.limar@example.test' }).count() === 1, 'People list should show one merged row');

  // Assigning the merged person notifies their account email, only for newly added assignees.
  await page.evaluate(() => { switchView('tasks'); openTask(3); });
  await page.locator('#dOwner').fill('Яковлев В., Лимарь Андрей');
  const notified = page.waitForResponse((r) => r.url().includes('/functions/v1/telegram-notify'));
  await page.locator('#saveTask').evaluate((button) => button.click());
  await notified;
  await page.waitForTimeout(300);
  assert(notifications.length === 1, `Only the newly added assignee should be notified: ${JSON.stringify(notifications)}`);
  assert(notifications[0].owner === 'a.s.limar@example.test', `Notification should target the account email: ${JSON.stringify(notifications[0])}`);

  assert(!unexpected.length, `Unexpected network requests: ${unexpected.join('; ')}`);
  assert(!errors.length, `Browser page errors: ${errors.join('; ')}`);
  console.log('Participants merge OK: manual + registered merged, tasks renamed, saved, notifications go to the account email');
} finally {
  await browser.close();
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}
