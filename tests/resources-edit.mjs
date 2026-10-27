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
const tk = (id, title, extra = {}) => ({ id, title, status: 'Очередь', owner: '', end: '', description: '', comment: '', ...extra });
const remoteState = {
  data: [
    { name: 'Альфа', tasks: [tk(1, 'Первая', { extraLinks: [{ title: 'Спека', url: 'https://a.example/spec' }] }), tk(2, 'Вторая', { description: 'смотри https://a.example/txt' })] },
    { name: 'Бета', tasks: [tk(11, 'Другая')] },
  ],
  projectMeta: { 'Альфа': { milestones: [], docs: [], links: [{ title: 'Wiki', url: 'https://a.example/wiki' }] } }, standaloneTasks: [], members: [],
};
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
  await page.evaluate(() => { activeProject = 'Альфа'; switchView('links'); });
  const rows = () => page.locator('#linksView .resource').count();
  assert((await rows()) === 3, 'Three links: manual, from task, from text: ' + (await rows()));
  // Rename the manual one
  await page.locator('[data-res-rename="0"]').click();
  await page.locator('.friendly-dialog input[name="f0"]').fill('Wiki команды');
  await page.locator('.friendly-dialog button[type="submit"]').click();
  assert(await page.evaluate(() => projectMeta['Альфа'].links[0].title) === 'Wiki команды', 'Manual link renamed');
  // Rename a task link
  await page.evaluate(() => switchView('links'));
  const specIdx = await page.locator('#linksView .resource').evaluateAll((els) => els.findIndex((e) => e.textContent.includes('Спека')));
  await page.locator(`[data-res-rename="${specIdx}"]`).click();
  await page.locator('.friendly-dialog input[name="f0"]').fill('Спека v2');
  await page.locator('.friendly-dialog button[type="submit"]').click();
  assert(await page.evaluate(() => active().tasks[0].extraLinks[0].title) === 'Спека v2', 'Task link renamed');
  // Rename a link found in the text → stored on the task
  const txtIdx = await page.locator('#linksView .resource').evaluateAll((els) => els.findIndex((e) => e.textContent.includes('a.example/txt')));
  await page.locator(`[data-res-rename="${txtIdx}"]`).click();
  await page.locator('.friendly-dialog input[name="f0"]').fill('Из текста');
  await page.locator('.friendly-dialog button[type="submit"]').click();
  assert(await page.evaluate(() => active().tasks[1].extraLinks?.[0]?.title) === 'Из текста', 'Text link renamed and kept');
  // Bind the wiki to project Бета and task 1
  await page.locator('[data-res-bind="0"]').click();
  await page.locator('.res-bind [data-bp="Бета"]').check();
  await page.locator('.res-bind [data-bt="1"]').check();
  await page.locator('.res-bind [data-save]').click();
  const w = await page.evaluate(() => projectMeta['Альфа'].links[0]);
  assert(w.also.join() === 'Бета' && w.taskIds.join() === '1', 'Bound: ' + JSON.stringify(w));
  // Shows in the other project
  await page.evaluate(() => { activeProject = 'Бета'; switchView('links'); });
  const betaText = await page.locator('#linksView').innerText();
  assert(betaText.includes('Wiki команды') && betaText.includes('из проекта «Альфа»'), 'Appears in Бета: ' + betaText);
  // And on the task card
  await page.evaluate(() => { activeProject = 'Альфа'; switchView('tasks'); openTask(1); });
  const drawerLinks = await page.locator('#dLinks').innerText();
  assert(drawerLinks.includes('Wiki команды') && drawerLinks.includes('привязано') && drawerLinks.includes('Спека v2'), 'Task shows bound link: ' + drawerLinks);
  // Rename from the drawer
  await page.locator('#dLinks [data-edit-link]').last().click();
  await page.locator('.friendly-dialog input[name="f0"]').fill('Wiki 2');
  await page.locator('.friendly-dialog button[type="submit"]').click();
  assert(await page.evaluate(() => projectMeta['Альфа'].links[0].title) === 'Wiki 2', 'Renamed from the drawer');
  await page.keyboard.press('Escape');
  // Unlink in Бета
  await page.evaluate(() => { activeProject = 'Бета'; switchView('links'); });
  await page.locator('[data-res-unlink="0"]').click();
  assert(await page.evaluate(() => projectMeta['Альфа'].links[0].also.length) === 0, 'Unlinked from Бета');
  assert(!errors.length, 'Page errors: ' + errors.join('; '));
  console.log('Resources OK: rename, bind to projects and tasks, unlink');
} finally {
  await browser.close();
  await new Promise((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
}
