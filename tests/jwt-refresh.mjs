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
const user = { id: ME, email: 'owner@example.test', user_metadata: {} };
const session = { access_token: 'old-token', refresh_token: 'refresh-1', user };
let refreshCalls = 0;
const staleCalls = [];

try {
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === origin) return route.continue();
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.origin !== 'https://vdlfdnhfiiltdyrucdtn.supabase.co') return route.abort();
    if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'refresh_token') {
      refreshCalls++;
      return json({ access_token: 'fresh-token', refresh_token: 'refresh-2', token_type: 'bearer', expires_in: 3600, user });
    }
    const auth = request.headers()['authorization'] || '';
    if (auth === 'Bearer old-token') { staleCalls.push(url.pathname); return json({ message: 'JWT expired', code: 'PGRST303' }, 401); }
    if (url.pathname === '/auth/v1/user') return json(user);
    if (url.pathname === '/rest/v1/kanban_state' && request.method() === 'GET') return json([{ user_id: ME, state: { data: [{ name: 'Облачный', tasks: [] }], projectMeta: {}, standaloneTasks: [] } }]);
    if (url.pathname === '/rest/v1/meetings' && request.method() === 'GET') return json([{ id: '11111111-1111-4111-8111-111111111111', title: 'Созвон после обновления токена', held_at: '2026-10-27T09:30:00Z', summary: [], decisions: [], tasks: [], open_questions: [] }]);
    if (url.pathname.startsWith('/rest/v1/')) return route.fulfill({ status: request.method() === 'POST' ? 201 : 200, contentType: 'application/json', body: request.method() === 'POST' ? '' : '[]' });
    return json({});
  });
  await page.addInitScript((s) => localStorage.setItem('fintech-kanban-session', JSON.stringify(s)), session);
  await page.goto(`${origin}/`);
  await page.locator('.app').waitFor({ state: 'visible' });
  await page.waitForFunction(() => data.some((p) => p.name === 'Облачный'), null, { timeout: 8000 });
  assert(staleCalls.length >= 1, 'The expired token must have been tried first');
  assert(refreshCalls === 1, 'Session must be refreshed exactly once, got ' + refreshCalls);
  assert(await page.evaluate(() => JSON.parse(localStorage.getItem('fintech-kanban-session')).access_token) === 'fresh-token', 'Fresh token must be stored');
  // Later calls use the fresh token: meetings from the Hub load without errors.
  await page.locator('#meetingsNav').click();
  await page.locator('#meetingsView .mt-card.hub', { hasText: 'Созвон после обновления токена' }).waitFor({ timeout: 5000 });
  assert(!errors.length, 'Page errors: ' + errors.join('; '));
  console.log('JWT refresh OK');
} finally {
  await browser.close();
  await new Promise((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
}
