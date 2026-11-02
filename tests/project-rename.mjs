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

function assert(condition, message) { if (!condition) throw new Error(message); }

const ME = '00000000-0000-4000-8000-000000000001';
const session = { access_token: 'mock-access-token', refresh_token: 'r', user: { id: ME, email: 'owner@example.test', user_metadata: {} } };
const pad = (n) => String(n).padStart(2, '0');
const ddmmyy = (offsetDays) => { const d = new Date(Date.now() + offsetDays * 864e5); return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${String(d.getFullYear()).slice(2)}`; };
const task = (id, title, extra = {}) => ({ id, title, status: 'Очередь', owner: 'Яковлев В.', end: '', description: '', comment: '', ...extra });
let remoteState = {
  data: [
    { name: 'Alpha', tasks: [task(1, 'Первая'), task(2, 'Вторая')] },
    { name: 'Beta', tasks: [task(3, 'Чужая')] },
  ],
  projectMeta: { Alpha: { projectDescription: 'описание' }, __meetings__: { list: [{ id: 'mlocal1', title: 'Планёрка', project: 'Alpha', projects: ['Alpha', 'Beta'] }] }, __myorder__: { list: ['Alpha\u00011', 'Beta\u00013'] } },
  standaloneTasks: [],
  pins: ['Alpha\u00011'],
  projectOrder: ['Alpha', 'Beta'],
  members: [{ name: 'Яковлев В.', email: 'owner@example.test', linked: true }],
};
const patches = [];
const saves = [];

try {
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
  const errors = [];
  const unexpected = [];
  page.on('pageerror', (error) => errors.push(error.stack || error.message));
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === origin) return route.continue();
    const ok = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.origin !== 'https://vdlfdnhfiiltdyrucdtn.supabase.co') { unexpected.push(url.href); return route.abort(); }
    if (url.pathname === '/auth/v1/user') return ok(session.user);
    if (url.pathname === '/rest/v1/kanban_state' && request.method() === 'GET') return ok([{ user_id: ME, state: remoteState }]);
    if (url.pathname === '/rest/v1/kanban_state') { saves.push(request.postDataJSON()); return route.fulfill({ status: 201, body: '' }); }
    if (url.pathname === '/functions/v1/admin-users') return ok({ error: 'Forbidden' }, 403);
    if (request.method() === 'PATCH') { patches.push(`${url.pathname}${url.search} ${request.postData()}`); return route.fulfill({ status: 204, body: '' }); }
    if (url.pathname === '/rest/v1/project_releases' && url.search.includes('tags=cs')) return ok([{ id: 'r1', tags: ['prj:Alpha', 'x'] }]);
    if (url.pathname.startsWith('/rest/v1/')) return ok([]);
    unexpected.push(`${request.method()} ${url.pathname}`);
    return ok({ error: 'Unexpected mocked request' }, 501);
  });
  await page.addInitScript((saved) => localStorage.setItem('fintech-kanban-session', JSON.stringify(saved)), session);
  await page.goto(`${origin}/`);
  await page.locator('.app').waitFor({ state: 'visible' });
  await page.evaluate(() => { activeProject = 'Alpha'; switchView('tasks'); renderAll(); });

  await page.locator('#projectMenuBtn, #projectMenuButton, [aria-controls="projectMenu"]').first().click();
  assert(await page.locator('[data-project-action="__rename"]').isVisible(), 'Menu has the rename item');
  await page.locator('[data-project-action="__rename"]').click();
  const input = page.locator('.friendly-dialog input').first();
  assert(await input.inputValue() === 'Alpha', 'The dialog starts with the current name');
  await input.fill('Beta');
  await page.locator('.friendly-dialog button.primary').click();
  assert((await page.locator('.friendly-error').textContent()).includes('уже есть'), 'A taken name is refused');
  await input.fill('Омега');
  await page.locator('.friendly-dialog button.primary').click();
  await page.waitForFunction(() => data.some((p) => p.name === 'Омега'));

  const st = await page.evaluate(() => ({ names: data.map((p) => p.name), active: activeProject, meta: projectMeta['Омега']?.projectDescription, oldMeta: projectMeta.Alpha, pins: pinnedTasks, order: projectOrder, my: projectMeta.__myorder__.list, mt: projectMeta.__meetings__.list[0] }));
  assert(st.names.join() === 'Омега,Beta' && st.active === 'Омега', `Names: ${st.names} / ${st.active}`);
  assert(st.meta === 'описание' && st.oldMeta === undefined, 'Project meta moved to the new name');
  assert(st.pins.join() === 'Омега\u00011', `Pins: ${st.pins}`);
  assert(st.order.join() === 'Омега,Beta', `Order: ${st.order}`);
  assert(st.my.join() === 'Омега\u00011,Beta\u00013', `My order: ${st.my}`);
  assert(st.mt.project === 'Омега' && st.mt.projects.join() === 'Омега,Beta', `Meeting: ${JSON.stringify(st.mt)}`);
  await page.waitForFunction(() => document.querySelector('#projects').textContent.includes('Омега'));
  await new Promise((r) => setTimeout(r, 500));
  const joined = patches.join('\n');
  assert(joined.includes('/rest/v1/project_releases') && joined.includes('"project_name":"Омега"'), `Releases patch: ${joined}`);
  assert(joined.includes('prj:Омега'), 'Release tags are renamed');
  assert(joined.includes('/rest/v1/meetings?project_name=eq.Alpha'), 'Hub meetings are renamed');
  assert(errors.length === 0, `Page errors: ${errors.join('\n')}`);
  assert(unexpected.length === 0, `Unexpected requests: ${unexpected.join(', ')}`);
  console.log('Project rename OK: names, pins, order, meetings, releases');
} finally {
  await browser.close();
  server.close();
}
