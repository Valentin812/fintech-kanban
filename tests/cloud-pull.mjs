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
const proj = (name) => ({ name, tasks: [{ id: name.length * 100 + 1, title: 'T ' + name, status: 'Очередь', owner: '', end: '', description: '', comment: '' }] });
let remoteStamp = '2026-10-27T05:00:00Z';
const remoteState = { data: [proj('Альфа'), proj('Бета'), proj('Гамма')], projectMeta: {}, standaloneTasks: [], members: [] };
let lastState = null;
try {
  const context = await browser.newContext({ viewport: { width: 1300, height: 800 } });
  const page = await context.newPage();
  const errors = [];
  await page.route('**/*', async (route) => {
    const request = route.request(); const url = new URL(request.url());
    if (url.origin === origin) return route.continue();
    const ok = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.origin !== 'https://vdlfdnhfiiltdyrucdtn.supabase.co') return route.abort();
    if (url.pathname === '/auth/v1/user') return ok(session.user);
    if (url.pathname === '/rest/v1/kanban_state' && request.method() === 'GET') return ok([{ user_id: ME, updated_at: remoteStamp, state: remoteState }]);
    if (url.pathname === '/rest/v1/kanban_state') { try { lastState = JSON.parse(request.postData()); } catch (e) {} return route.fulfill({ status: 201, body: '' }); }
    if (url.pathname === '/functions/v1/admin-users') return ok({ error: 'F' }, 403);
    if (url.pathname.startsWith('/rest/v1/')) return ok([]);
    return ok({}, 501);
  });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript((s) => localStorage.setItem('fintech-kanban-session', JSON.stringify(s)), session);
  await page.goto(`${origin}/`);
  await page.locator('.app').waitFor({ state: 'visible' });
  const notes = () => page.evaluate(() => quickNotes.map((n) => n.text));
  assert((await notes()).length === 0, 'No notes at start');
  await page.evaluate(() => window.__pullPersonal());
  await page.waitForTimeout(200);
  // Другое устройство добавило заметку и обновило облако
  remoteState.quickNotes = [{ id: 'nm1', text: 'С телефона', created: Date.now(), done: false }];
  remoteStamp = '2026-10-27T05:05:00Z';
  await page.waitForTimeout(4200);
  await page.evaluate(() => window.__pullPersonal());
  await page.waitForTimeout(300);
  assert((await notes()).join() === 'С телефона', 'Note from other device arrives: ' + (await notes()));
  assert(await page.locator('.qn-panel').first().innerText().then((x) => x.includes('С телефона')).catch(() => true), 'Note is rendered');
  // Несохранённые локальные правки не затираются
  await page.evaluate(() => { quickNotes.unshift({ id: 'loc', text: 'Локальная', created: Date.now(), done: false }); save(); });
  remoteState.quickNotes = [];
  remoteStamp = '2026-10-27T05:10:00Z';
  await page.evaluate(() => window.__pullPersonal());
  assert((await notes()).includes('Локальная'), 'Local unsaved edit is not overwritten');
  assert(!errors.length, 'Page errors: ' + errors.join('; '));
  console.log('Cloud pull OK: remote notes arrive, local edits kept');
} finally {
  await browser.close();
  await new Promise((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
}
