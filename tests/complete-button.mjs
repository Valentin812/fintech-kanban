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
    { name: 'Alpha', tasks: [
      task(1, 'Просроченная', { end: ddmmyy(-3) }),
      task(2, 'Закреплю потом', { owner: 'Сухов Е.' }),
      task(3, 'Помечу важной'),
      task(4, 'На завтра', { end: ddmmyy(1) }),
      task(5, 'Обычная', { end: ddmmyy(20) }),
      task(6, 'Готовая', { status: 'Готово' }),
    ] },
  ],
  projectMeta: {},
  standaloneTasks: [task(50, 'Быстрая без проекта'), task(51, 'Вторая без проекта')],
  pins: ['Alpha\u00014'],
  members: [{ name: 'Яковлев В.', email: 'owner@example.test', linked: true }],
};
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
    if (url.pathname.startsWith('/rest/v1/')) return ok([]);
    unexpected.push(`${request.method()} ${url.pathname}`);
    return ok({ error: 'Unexpected mocked request' }, 501);
  });
  await page.addInitScript((saved) => localStorage.setItem('fintech-kanban-session', JSON.stringify(saved)), session);
  await page.goto(`${origin}/`);
  await page.locator('.app').waitFor({ state: 'visible' });
  await page.evaluate(() => { activeProject = 'Alpha'; switchView('tasks'); renderAll(); });

  const T = (id) => page.evaluate((i) => { const x = active().tasks.find((t) => t.id === i); return x ? { status: x.status, archived: !!x.archived, completedAt: x.completedAt || '' } : null; }, id);
  const onBoard = (id) => page.locator(`#board article.task[data-id="${id}"]`).count();

  // «Завершить» on a board task: Готово + off the board + completion date; undo restores everything.
  await page.evaluate(() => openTask(5));
  assert(await page.locator('#completeTask').textContent() === '✔ Завершить', 'Complete button is offered');
  await page.locator('#completeTask').click();
  let s5 = await T(5);
  assert(s5.status === 'Готово' && s5.archived && /^\d{4}-\d\d-\d\d/.test(s5.completedAt), 'Task is done, archived and dated: ' + JSON.stringify(s5));
  assert(!(await page.evaluate(() => document.querySelector('#drawer').classList.contains('open'))), 'Drawer closes after completing');
  assert((await onBoard(5)) === 0, 'Completed task leaves the board');
  await page.locator('#undoToast button').click();
  s5 = await T(5);
  assert(s5.status === 'Очередь' && !s5.archived && !s5.completedAt && (await onBoard(5)) === 1, 'Undo restores the task: ' + JSON.stringify(s5));

  // Archived tasks never sit on the board; they live in the «Завершённые» tab with a count.
  await page.evaluate(() => openTask(5)); await page.locator('#completeTask').click();
  assert((await page.locator('#tabs [data-view="completed"]').textContent()).includes('2'), 'Tab counts archived tasks (incl. the old «Готово» task)');
  assert((await onBoard(5)) === 0, 'Archived card is not on the board');
  await page.locator('#tabs [data-view="completed"]').click();
  assert((await page.locator('#completedView .cp-row').count()) === 2 && (await page.locator('#completedView').textContent()).includes('завершено'), 'Tab lists the task with its completion date');
  await page.locator('#cpSearch').fill('нет такой');
  assert((await page.locator('#completedView .cp-row').count()) === 0, 'Search filters the list');
  await page.locator('#cpSearch').fill('');
  await page.locator('[data-cp-open="5"]').click();
  assert(await page.locator('#completeTask').textContent() === '↩ Вернуть в работу', 'Archived task offers to reopen');
  assert((await page.locator('#dCompleted').textContent()).startsWith('Завершено: '), 'Drawer shows the completion date');
  await page.keyboard.press('Escape');
  await page.locator('[data-cp-restore="5"]').click();
  s5 = await T(5);
  assert(s5.status === 'Очередь' && !s5.archived && !s5.completedAt && (await page.locator('#completedView .cp-row').count()) === 1, 'Restore from the tab clears archive and date: ' + JSON.stringify(s5));
  await page.locator('#tabs [data-view="tasks"]').click();

  // The «Готово» column no longer exists: old done cards are moved to «Завершённые» automatically.
  assert((await T(6)).status === 'Готово' && (await T(6)).archived && (await onBoard(6)) === 0, 'Old done task is archived automatically');
  assert((await page.locator('#board .column[data-status="Готово"]').count()) === 0, 'No «Готово» column on the board');
  await page.evaluate(() => { active().tasks.push({ id: 7, title: 'Ещё готовая', status: 'Готово', owner: '', end: '', description: '', comment: '' }); renderAll(); });
  assert((await onBoard(7)) === 0 && (await T(7)).archived, 'A task that reaches «Готово» leaves the board');

  // Delete forever asks for confirmation.
  await page.evaluate(() => openTask(7));
  assert(await page.locator('#deleteForever').isVisible(), 'Delete forever is offered for done tasks');
  await page.locator('#deleteForever').click();
  await page.locator('.confirm-modal [data-no]').click();
  assert(await page.evaluate(() => active().tasks.some((t) => t.id === 7)), 'Cancel keeps the task');
  await page.locator('#deleteForever').click();
  await page.locator('.confirm-modal [data-yes]').click();
  await page.waitForFunction(() => !active().tasks.some((t) => t.id === 7));
  assert(await page.locator('#undoToast').count() === 0, 'No undo after deleting forever');
  await page.evaluate(() => { active().tasks.push({ id: 8, title: 'Удалить из вкладки', status: 'Готово', archived: true, completedAt: new Date().toISOString(), owner: '', end: '', description: '', comment: '' }); switchView('completed'); });
  await page.locator('[data-cp-del="8"]').click();
  await page.locator('.confirm-modal [data-yes]').click();
  await page.waitForFunction(() => !active().tasks.some((t) => t.id === 8));
  await page.evaluate(() => switchView('tasks'));
  await page.evaluate(() => openTask(1));
  assert(await page.locator('#deleteForever').isHidden(), 'Open tasks do not offer delete forever');
  await page.keyboard.press('Escape');

  // Standalone task + «Мои задачи»: finished list shows the date.
  await page.evaluate(() => openStandaloneTask(50));
  await page.locator('#completeTask').click();
  await page.evaluate(() => { window.myTasksFilter = 'noproject'; switchView('mytasks'); });
  assert(!(await page.locator('#myTasksView').textContent()).includes('Быстрая без проекта'), 'Completed standalone task leaves «Без проекта»');
  await page.evaluate(() => { window.myTasksFilter = 'done'; switchView('mytasks'); });
  const text = await page.locator('#myTasksView').textContent();
  assert(text.includes('Быстрая без проекта') && /завершено \d\d\.\d\d\.\d{4}/.test(text), 'My finished tasks show the completion date');
  assert(!unexpected.length, `Unexpected requests: ${unexpected.join('; ')}`);
  assert(!errors.length, `Browser page errors: ${errors.join('; ')}`);
  console.log('Completed OK: dates, archive from board and Done column, chip, reopen, delete forever with confirm');
} finally {
  await browser.close();
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}
