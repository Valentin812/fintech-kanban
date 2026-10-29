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

  assert(await page.evaluate(() => isPinned('Alpha', 4)), 'Pins stored in the cloud state are restored on load');
  await page.evaluate(() => togglePin('Alpha', 4));

  // Pin from the board card and flag a task as important from the drawer.
  await page.locator('article.task[data-id="2"] [data-pin-task]').click();
  assert(await page.locator('article.task[data-id="2"] [data-pin-task]').getAttribute('aria-pressed') === 'true', 'Pin button should show the pinned state');
  assert(await page.evaluate(() => isPinned('Alpha', 2)), 'Task 2 should be pinned');
  assert(!(await page.evaluate(() => document.querySelector('#drawer').classList.contains('open'))), 'Pinning must not open the task');
  await page.locator('article.task[data-id="3"] .tasktitle').click();
  await page.waitForFunction(() => document.querySelector('#drawer').classList.contains('open'));
  assert(await page.locator('#pinTask').isVisible() && await page.locator('#importantTask').isVisible(), 'Drawer offers pin and important');
  await page.locator('#importantTask').click();
  assert(await page.locator('#importantTask').getAttribute('aria-pressed') === 'true', 'Important should be toggled on');
  await page.keyboard.press('Escape');

  // «Мои задачи»: no-project first, then pinned, then hot, then the rest.
  await page.evaluate(() => { window.myTasksFilter = undefined; switchView('mytasks'); });
  const chips = await page.locator('.mytask-filters [data-my-filter]').evaluateAll((els) => els.map((e) => e.dataset.myFilter));
  assert(chips.slice(0, 4).join() === 'focus,noproject,pinned,hot', `Chip order: ${chips}`);
  assert(await page.locator('[data-my-filter="focus"]').getAttribute('aria-pressed') === 'true', '«Главное» is the default');
  const titles = await page.locator('#myTasksView .mytask-group h4').allTextContents();
  assert(titles.map((t) => t.replace(/\s*\d+$/, '')).join('|') === 'Без проекта|Закреплённые|Горят и просрочены|Остальные активные', `Section order: ${titles}`);
  const rows = async (cls) => page.locator(`#myTasksView .mytask-group-${cls} .mytask-title`).allTextContents();
  assert((await rows('noproject')).join('|').includes('Быстрая без проекта'), 'No-project tasks come first');
  assert((await rows('pinned')).join('|').includes('Закреплю потом'), 'A pinned task of someone else shows up under pinned');
  const hot = (await rows('hot')).join('|');
  assert(hot.includes('Просроченная') && hot.includes('Помечу важной') && hot.includes('На завтра'), `Hot section: ${hot}`);
  assert(!hot.includes('Закреплю потом') && (await rows('rest')).join('|').includes('Обычная'), 'Tasks are listed once, plain ones go to the rest');
  assert(!(await page.locator('#myTasksView').textContent()).includes('Готовая'), 'Finished tasks stay out of the main view');
  const accent = await page.locator('[data-my-filter="noproject"]').evaluate((e) => getComputedStyle(e).fontWeight);
  assert(Number(accent) >= 600, 'The no-project chip is emphasised');

  // Unpin from the list, filters work, and everything is saved with the state.
  await page.locator('#myTasksView [data-pin-toggle="2"]').click();
  assert(!(await page.evaluate(() => isPinned('Alpha', 2))), 'Unpinning from the list works');
  await page.locator('#myTasksView [data-pin-toggle="5"]').click();
  await page.locator('[data-my-filter="pinned"]').click();
  assert((await page.locator('#myTasksView .mytask-title').allTextContents()).join('|').includes('Обычная'), 'Pinned filter lists pinned tasks only');
  await page.locator('[data-my-filter="hot"]').click();
  assert((await page.locator('#myTasksView .mytask-title').count()) === 3, 'Hot filter lists three tasks');
  await page.evaluate(() => cloudWriteNow());
  const last = saves.at(-1);
  assert(last && last.state && JSON.stringify(last.state.pins) === JSON.stringify(['Alpha\u00015']), `Pins are saved with the state: ${JSON.stringify(last?.state?.pins)}`);
  assert(last.state.data[0].tasks.find((t) => t.id === 3).important === true, 'Important flag is saved on the task');

  // The inline «add subtask» form works (Enter creates, Escape cancels) and never throws.
  await page.evaluate(() => { activeProject = 'Alpha'; switchView('tasks'); renderAll(); });
  await page.locator('article.task[data-id="5"] .subtask-add').click();
  await page.locator('.subtask-inline-input').fill('Новая подзадача');
  await page.keyboard.press('Enter');
  assert(await page.evaluate(() => active().tasks.some((t) => t.title === 'Новая подзадача' && t.parent === '5')), 'Enter creates the subtask');
  await page.locator('article.task[data-id="5"] .subtask-add').click();
  await page.locator('.subtask-inline-cancel').click();
  assert(await page.locator('.subtask-inline-editor').count() === 0, 'Cancel closes the inline form');

  assert(!unexpected.length, `Unexpected requests: ${unexpected.join('; ')}`);
  // «＋ Задача без проекта» в «Мои задачи»: новая задача сразу видна в списке без перезагрузки.
  await page.evaluate(() => { window.myTasksFilter = 'noproject'; switchView('mytasks'); });
  await page.locator('#addInboxTask').click();
  await page.locator('#standaloneTaskModal.show').waitFor();
  await page.locator('#standaloneTitle').fill('Создана из списка');
  await page.locator('#confirmStandaloneTask').click();
  await page.locator('#myTasksView .mytask-row', { hasText: 'Создана из списка' }).waitFor({ timeout: 3000 });
  // Перенос в новый проект: создаётся проект, задача переезжает в него.
  await page.evaluate(() => openMoveTaskModal(standaloneTasks.find((x) => x.title === 'Создана из списка').id));
  await page.locator('.move-new-project').click();
  await page.locator('.move-modal-search').fill('Проект из переноса');
  await page.locator('.move-new-project').click();
  await page.waitForFunction(() => data.some((p) => p.name === 'Проект из переноса' && p.tasks.some((t) => t.title === 'Создана из списка')) && !standaloneTasks.some((x) => x.title === 'Создана из списка'), null, { timeout: 3000 });
  // Ширина списка «Мои задачи» не должна менять ширину быстрых заметок.
  await page.evaluate(() => { window.myTasksFilter = 'noproject'; switchView('mytasks'); });
  const widths = async () => page.evaluate(() => ({ list: document.querySelector('#myTasksView .mytask-list')?.getBoundingClientRect().width, notes: document.querySelector('#myTasksView .qn-panel')?.getBoundingClientRect().width }));
  const w0 = await widths();
  await page.evaluate(() => window.__listWidth.set(520));
  const w1 = await widths();
  console.log('widths', JSON.stringify(w0), JSON.stringify(w1));
  assert(w0.notes && Math.abs(w1.notes - w0.notes) < 2, 'Quick notes width must not follow the list width: ' + JSON.stringify([w0, w1]));
  await page.evaluate(() => window.__listWidth.set(0));
  assert(!errors.length, `Browser page errors: ${errors.join('; ')}`);
  console.log('My tasks focus OK: no-project first, pinned, hot/overdue, rest; pin + important saved; subtask form');
} finally {
  await browser.close();
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}
