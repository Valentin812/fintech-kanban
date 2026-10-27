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

const session = {
  access_token: 'mock-access-token',
  refresh_token: 'mock-refresh-token',
  token_type: 'bearer',
  expires_in: 3600,
  user: { id: '00000000-0000-4000-8000-000000000001', aud: 'authenticated', role: 'authenticated', email: 'owner@example.test', app_metadata: {}, user_metadata: {} },
};
const task = (id, title, status, owner, end) => ({ id, title, start: '', end, status, owner, description: '', comment: '', link: '', mt: '' });
const remoteState = {
  data: [
    { name: 'Main', tasks: [
      task(1, 'Mine overdue', 'В работе', 'Яковлев В.', '01.10.26'),
      task(2, 'Other overdue', 'Очередь', 'Сухов Е.', '02.10.26'),
      task(3, 'Mine later', 'Очередь', 'Яковлев В.', '01.12.99'),
      task(4, 'Done overdue', 'Готово', 'Яковлев В.', '01.10.26'),
    ] },
    { name: 'Second', tasks: [task(10, 'Second task', 'Очередь', 'Бекетов Г.', '')] },
  ],
  projectMeta: {},
  standaloneTasks: [],
  members: [{ name: 'Яковлев В.', email: 'owner@example.test', linked: true }],
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  const writes = [];
  const unexpected = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('dialog', (dialog) => dialog.dismiss());
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
    if (['/rest/v1/notifications', '/rest/v1/kanban_profiles', '/rest/v1/messenger_accounts', '/rest/v1/shared_projects', '/rest/v1/telegram_inbox', '/rest/v1/kanban_avatars'].includes(url.pathname)) return ok([]);
    unexpected.push(`${request.method()} ${url.pathname}`);
    return ok({ error: 'Unexpected mocked request' }, 501);
  });
  await page.addInitScript((saved) => localStorage.setItem('fintech-kanban-session', JSON.stringify(saved)), session);
  await page.goto(`${origin}/`);
  await page.locator('.app').waitFor({ state: 'visible' });
  await page.evaluate(() => { activeProject = 'Main'; switchView('tasks'); renderAll(); });
  const lastSavedTask = (id) => writes.at(-1)?.state?.data?.flatMap((p) => p.tasks).find((t) => t.id === id);
  const visibleCards = () => page.locator('#board article.task').evaluateAll((els) => els.map((e) => Number(e.dataset.id)).sort((a, b) => a - b));

  // 1. Autosave: edits are saved while the drawer stays open; Escape cancels (with undo), outside click saves.
  await page.evaluate(() => openTask(3));
  assert(await page.locator('#saveTask').textContent() === 'Готово', 'Save button should read «Готово»');
  await page.locator('#dDescription').fill('Autosaved description');
  await page.waitForFunction(() => document.querySelector('#autosaveNote')?.classList.contains('saved'), null, { timeout: 4000 });
  await page.waitForTimeout(1100);
  assert(lastSavedTask(3)?.description === 'Autosaved description', 'Description should be autosaved to the cloud');
  assert(await page.locator('#drawer').evaluate((d) => d.classList.contains('open')), 'Autosave must not close the drawer');

  // 2. Dates: typed short dates are normalised; the calendar button exists.
  assert(await page.locator('#dEnd').locator('xpath=..').locator('.date-btn').count() === 1, 'Due date should have a calendar button');
  await page.locator('#dEnd').fill('5.11');
  await page.locator('#dDescription').click();
  const year = new Date().getFullYear();
  assert(await page.locator('#dEnd').inputValue() === `05.11.${year}`, `Short date should be normalised, got ${await page.locator('#dEnd').inputValue()}`);
  await page.locator('#dEnd').fill('31.02.2026');
  await page.locator('#dDescription').click();
  assert(await page.locator('#dEnd').inputValue() === '31.02.2026', 'Impossible dates are left as typed');
  await page.locator('#dEnd').fill('01.12.2099');
  await page.locator('#newComment').fill('Comment kept on Escape');
  // Escape cancels: the task returns to the state it had when the drawer opened...
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('#drawer').classList.contains('open'));
  const reverted = await page.evaluate(() => active().tasks.find((t) => t.id === 3));
  assert(reverted.description !== 'Autosaved description' && reverted.end !== '01.12.2099' && !(reverted.comment || '').includes('Comment kept on Escape'), `Escape should cancel the edits: ${JSON.stringify(reverted)}`);
  // ...and «Отменить» in the toast brings everything back, including the unsent comment.
  await page.locator('#undoToast button').click();
  await page.waitForTimeout(1100);
  assert((lastSavedTask(3)?.comment || '').includes('Comment kept on Escape'), 'Undo should restore the typed comment');
  assert(lastSavedTask(3)?.end === '01.12.2099', 'Undo should restore the typed due date');
  assert(lastSavedTask(3)?.description === 'Autosaved description', 'Undo should restore the description');
  // Clicking outside (the overlay) saves and closes.
  await page.evaluate(() => openTask(3));
  await page.locator('#dDescription').fill('Saved by outside click');
  await page.locator('#overlay').click({ position: { x: 5, y: 5 } });
  await page.waitForFunction(() => !document.querySelector('#drawer').classList.contains('open'));
  await page.waitForTimeout(1100);
  assert(lastSavedTask(3)?.description === 'Saved by outside click', 'Outside click should save');

  // 3. Quick filters + home tile.
  await page.locator('[data-quick-filter="overdue"]').click();
  assert(JSON.stringify(await visibleCards()) === '[1,2]', `Overdue filter should show open overdue tasks only: ${await visibleCards()}`);
  await page.locator('[data-quick-filter="mine"]').click();
  assert(JSON.stringify(await visibleCards()) === '[1]', `Mine + overdue should show only my overdue task: ${await visibleCards()}`);
  assert(await page.locator('[data-quick-filter="mine"]').getAttribute('aria-pressed') === 'true', 'Active filter should be marked pressed');
  await page.locator('[data-quick-filter="overdue"]').click();
  assert(JSON.stringify(await visibleCards()) === '[1,3]', `Mine filter should show all my tasks: ${await visibleCards()}`);
  await page.locator('[data-quick-filter="mine"]').click();
  assert((await visibleCards()).length === 3, 'Turning filters off should show everything (done tasks are archived)');
  await page.evaluate(() => { activeProject = 'Second'; switchView('home'); });
  await page.locator('[data-home-overdue]').click();
  await page.waitForFunction(() => activeProject === 'Main' && activeView === 'tasks');
  assert(JSON.stringify(await visibleCards()) === '[1,2]', 'Home «Просрочено» should open the overdue filter');
  await page.locator('[data-quick-filter="overdue"]').click();

  // 4. Undo after deleting a task.
  await page.evaluate(() => openTask(2));
  await page.locator('#deleteTask').click();
  assert(!(await visibleCards()).includes(2), 'Task should be deleted immediately');
  await page.locator('#undoToast button').click();
  await page.waitForFunction(() => document.querySelector('#board article.task[data-id="2"]'));
  assert(await page.evaluate(() => data[0].tasks.map((t) => t.id).join(',')) === '1,2,3,4', 'Undo should restore the task at its place');

  // 5. Project actions live in a labelled menu.
  assert(await page.locator('#exportBtn').isHidden() && await page.locator('#deleteProject').isHidden(), 'Cryptic icon buttons should be hidden');
  await page.locator('#projectMenuButton').click();
  const menuItems = await page.locator('#projectMenu [role="menuitem"]').allTextContents();
  assert(menuItems.includes('Удалить проект') && menuItems.includes('Экспорт данных (JSON)'), `Menu should list labelled actions: ${menuItems}`);
  await page.keyboard.press('Escape');
  assert(await page.locator('#projectMenu').isHidden(), 'Escape should close the project menu');

  // 6. Theme picker moved into the account menu.
  assert(await page.locator('#cloudModal #themeToggle').count() === 1, 'Theme picker should live in the account menu');
  assert(await page.locator('.top #themeToggle').count() === 0, 'Theme picker should not take space in the top bar');

  // 7. Sorting: clearer label and «by owner».
  const sortOptions = await page.locator('#sortFilter option').allTextContents();
  assert(sortOptions[0] === 'Мой порядок' && sortOptions.includes('По ответственному'), `Unexpected sort options: ${sortOptions}`);

  // 8. Columns can be dragged by their header.
  const order = () => page.locator('#board .column').evaluateAll((cols) => cols.map((c) => c.dataset.status));
  await page.locator('.column[data-status="На анализе"] .col-grip').dragTo(page.locator('.column[data-status="Очередь"]'), { targetPosition: { x: 10, y: 60 } });
  assert(JSON.stringify(await order()) === JSON.stringify(['На анализе', 'Очередь', 'В работе']), `Column drag should reorder: ${await order()}`);
  await page.waitForTimeout(1100);
  assert(JSON.stringify((writes.at(-1)?.state?.projectMeta?.Main?.statusOrder || []).filter((s) => s !== 'Готово')) === JSON.stringify(['На анализе', 'Очередь', 'В работе']), 'Dragged order should be saved');
  assert(await page.evaluate(() => data[0].tasks.length) === 4, 'Dragging a column must not move or lose tasks');

  // Cards still move between columns by drag and drop.
  await page.locator('article.task[data-id="3"]').dragTo(page.locator('.column[data-status="В работе"] .cards'));
  await page.waitForFunction(() => data[0].tasks.find((t) => t.id === 3).status === 'В работе');

  // My tasks: grouped list, active by default, rows open the task.
  await page.evaluate(() => switchView('mytasks'));
  const groupTitles = await page.locator('#myTasksView .mytask-group h4').allTextContents();
  assert(groupTitles[0].startsWith('Горят и просрочены') && !groupTitles.some((g) => g.startsWith('Завершённые')), `Default «Главное» view should start with hot/overdue (no standalone or pinned tasks here) and hide finished: ${groupTitles}`);
  await page.locator('[data-my-filter="active"]').click();
  const activeTitles = await page.locator('#myTasksView .mytask-group h4').allTextContents();
  assert(activeTitles[0].startsWith('Просрочено') && !activeTitles.some((g) => g.startsWith('Завершённые')), `Active filter should start with overdue and hide finished: ${activeTitles}`);
  await page.locator('[data-my-filter="done"]').click();
  assert(await page.locator('#myTasksView .mytask-row.is-done').count() === 1, 'Finished filter should show my finished task');
  await page.locator('[data-my-filter="active"]').click();
  await page.locator('#myTasksView .mytask-row').first().click();
  await page.waitForFunction(() => document.querySelector('#drawer').classList.contains('open'));
  await page.keyboard.press('Escape');

  assert(!unexpected.length, `Unexpected network requests: ${unexpected.join('; ')}`);
  assert(!errors.length, `Browser page errors: ${errors.join('; ')}`);
  console.log('Usability OK: autosave, date input, quick filters + home tile, undo delete, project menu, theme in account menu, sorting, column drag');
} finally {
  await browser.close();
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}
