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
  const order = () => page.locator('#projects .project').evaluateAll((els) => els.map((e) => e.dataset.project));
  assert((await order()).join() === 'Альфа,Бета,Гамма', 'Initial order: ' + (await order()));
  await page.locator('#projects .project[data-project="Гамма"]').dragTo(page.locator('#projects .project[data-project="Альфа"]'), { targetPosition: { x: 20, y: 2 } });
  assert((await order()).join() === 'Гамма,Альфа,Бета', 'After drag: ' + (await order()));
  await page.evaluate(() => cloudWriteNow());
  await page.waitForTimeout(300);
  const st = Array.isArray(lastState) ? lastState[0] : lastState;
  assert(JSON.stringify(st?.state?.projectOrder) === JSON.stringify(['Гамма', 'Альфа', 'Бета']), 'Saved to cloud: ' + JSON.stringify(st?.state?.projectOrder));
  await page.reload();
  await page.locator('.app').waitFor({ state: 'visible' });
  assert((await order()).join() === 'Гамма,Альфа,Бета', 'Order is remembered after reload: ' + (await order()));
  await page.locator('#projects .project[data-project="Альфа"]').focus();
  await page.keyboard.press('Alt+ArrowDown');
  assert((await order()).join() === 'Гамма,Бета,Альфа', 'Alt+Down moves: ' + (await order()));
  // Архив проектов: скрыть, пережить перезагрузку, вернуть, удалить навсегда.
  await page.evaluate(() => { activeProject = 'Бета'; renderAll(); archiveActiveProject(); });
  await page.locator('.friendly-dialog .btn.primary').click();
  assert(!(await order()).includes('Бета'), 'Archived project must leave the list: ' + (await order()));
  await page.evaluate(() => cloudWriteNow());
  await page.waitForTimeout(300);
  const st2 = Array.isArray(lastState) ? lastState[0] : lastState;
  assert(st2?.state?.archived?.some((a) => a.name === 'Бета'), 'Archive saved to the cloud');
  await page.reload();
  await page.locator('.app').waitFor({ state: 'visible' });
  assert(!(await order()).includes('Бета') && await page.evaluate(() => archivedProjects.some((a) => a.name === 'Бета')), 'Archive survives reload');
  await page.evaluate(() => openArchive());
  await page.locator('[data-arch-restore="0"]').click();
  assert((await order()).includes('Бета') && await page.evaluate(() => archivedProjects.length === 0), 'Restored project is back');
  await page.evaluate(() => { activeProject = 'Бета'; renderAll(); archiveActiveProject(); });
  await page.locator('.friendly-dialog .btn.primary').click();
  await page.evaluate(() => openArchive());
  await page.locator('[data-arch-del="0"]').click();
  await page.locator('.friendly-dialog .btn.primary').click();
  assert(await page.evaluate(() => archivedProjects.length === 0 && !data.some((p) => p.name === 'Бета') && projectBackups.some((b) => b.name === 'Бета')), 'Deleted forever, backup kept');
  assert(!errors.length, 'Page errors: ' + errors.join('; '));
  console.log('Project order OK: drag, keyboard, saved, remembered');
} finally {
  await browser.close();
  await new Promise((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
}
