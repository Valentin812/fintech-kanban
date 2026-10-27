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
const tk = (id, title) => ({ id, title, status: 'Очередь', owner: '', end: '', description: '', comment: '' });
const remoteState = { data: [{ name: 'Альфа', tasks: [tk(1, 'Первая'), tk(2, 'Вторая'), tk(3, 'Третья')] }], projectMeta: {}, standaloneTasks: [], members: [], quickNotes: [] };
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
  await page.waitForFunction(() => cloudStateReady);
  await page.waitForTimeout(500);
  await page.evaluate(() => { activeProject = 'Альфа'; switchView('tasks'); });
  const titles = () => page.evaluate(() => active().tasks.map((t) => t.title).join());
  const act = async (fn) => { await page.evaluate(fn); await page.waitForTimeout(1000); };
  await act(() => { active().tasks[0].title = 'Первая*'; save(); });
  await act(() => { active().tasks.splice(1, 1); save(); renderAll(); });
  await act(() => { active().tasks.push({ id: 9, title: 'Новая', status: 'Очередь', owner: '', end: '', description: '', comment: '' }); save(); renderAll(); });
  assert((await titles()) === 'Первая*,Третья,Новая', 'After three actions: ' + (await titles()));
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+z');
  assert((await titles()) === 'Первая*,Третья', 'Undo 1: ' + (await titles()));
  await page.keyboard.press('Control+z');
  assert((await titles()) === 'Первая*,Вторая,Третья', 'Undo 2: ' + (await titles()));
  await page.keyboard.press('Control+z');
  assert((await titles()) === 'Первая,Вторая,Третья', 'Undo 3: ' + (await titles()));
  await page.keyboard.press('Control+Shift+z');
  assert((await titles()) === 'Первая*,Вторая,Третья', 'Redo: ' + (await titles()));
  // Undo is saved to the cloud
  await page.waitForTimeout(1200);
  const st = Array.isArray(lastState) ? lastState[0] : lastState;
  assert(st?.state?.data?.[0]?.tasks?.map((t) => t.title).join() === 'Первая*,Вторая,Третья', 'Undo state saved to cloud');
  // Typing in a field keeps native undo (no board undo)
  await page.evaluate(() => switchView('tasks'));
  await page.locator('#taskSearch').click();
  await page.keyboard.press('Control+z');
  assert((await titles()) === 'Первая*,Вторая,Третья', 'Ctrl+Z in an input does not touch the board');
  assert(!errors.length, 'Page errors: ' + errors.join('; '));
  console.log('Undo OK: multi-step undo/redo, saved, ignores inputs');
} finally {
  await browser.close();
  await new Promise((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
}
