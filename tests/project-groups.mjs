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
  // Группа через меню проекта: новая группа «ЭР».
  await page.evaluate(() => { activeProject = 'Бета'; renderAll(); });
  await page.locator('#projectMenuButton').click();
  await page.locator('[data-project-action="__group"]').click();
  await page.locator('.friendly-dialog select[name=f0]').selectOption('__new');
  await page.locator('.friendly-dialog input[name=f1]').fill('ЭР');
  await page.locator('.friendly-dialog button[type=submit]').click();
  await page.evaluate(() => { setProjectGroup('Гамма', 'ЭР'); });
  const heads = () => page.locator('#projects .proj-group-head').evaluateAll((els) => els.map((e) => e.dataset.group));
  assert((await heads()).join() === 'ЭР', 'Group header shown: ' + (await heads()));
  assert((await order()).join() === 'Альфа,Бета,Гамма', 'Grouped projects stay together, ungrouped first: ' + (await order()));
  // Свернуть: активный проект группы остаётся виден, при выборе другого — скрывается.
  await page.evaluate(() => { activeProject = 'Альфа'; renderAll(); });
  await page.locator('.proj-group-head').click();
  const vis = () => page.locator('#projects .project').evaluateAll((els) => els.filter((e) => e.style.display !== 'none').map((e) => e.dataset.project));
  assert((await vis()).join() === 'Альфа', 'Collapsed group hides its projects: ' + (await vis()));
  await page.locator('.proj-group-head').click();
  assert((await vis()).length === 3, 'Expanded again');
  // Порядок групп: стрелки и Alt+стрелки.
  await page.evaluate(() => { setProjectGroup('Альфа', 'НС'); });
  assert((await heads()).join() === 'НС,ЭР', 'Groups follow first appearance: ' + (await heads()));
  await page.locator('.proj-group-head[data-group="НС"] [data-gmv="1"]').click();
  assert((await heads()).join() === 'ЭР,НС', 'Arrow moves the group down: ' + (await heads()));
  await page.locator('.proj-group-head[data-group="НС"]').focus();
  await page.keyboard.press('Alt+ArrowUp');
  assert((await heads()).join() === 'НС,ЭР', 'Alt+Up moves the group up: ' + (await heads()));
  await page.evaluate(() => { moveProjectGroup('НС', 1); });
  assert((await heads()).join() === 'ЭР,НС' && await page.evaluate(() => projectMeta.__groups__.order.join()) === 'ЭР,НС', 'Group order is stored');
  await page.evaluate(() => { setProjectGroup('Альфа', ''); });
  assert((await heads()).join() === 'ЭР', 'Empty group disappears: ' + (await heads()));
  // Сохранение и перезагрузка.
  await page.evaluate(() => cloudWriteNow());
  await page.waitForTimeout(300);
  const st = Array.isArray(lastState) ? lastState[0] : lastState;
  assert(st?.state?.projectMeta?.['Бета']?.group === 'ЭР', 'Group saved to the cloud: ' + JSON.stringify(st?.state?.projectMeta));
  await page.reload();
  await page.locator('.app').waitFor({ state: 'visible' });
  assert((await heads()).join() === 'ЭР', 'Group remembered after reload');
  // Переименование проекта переносит группу; «Без группы» снимает её.
  await page.evaluate(() => { activeProject = 'Бета'; renderAll(); editProjectGroup(); });
  await page.locator('.friendly-dialog select[name=f0]').selectOption('');
  await page.locator('.friendly-dialog button[type=submit]').click();
  assert(await page.evaluate(() => !projectMeta['Бета']?.group), 'Group removed');
  assert((await order()).join() === 'Альфа,Бета,Гамма', 'Order: ' + (await order()));
  // Чек-лист: Enter добавляет, Esc очищает, кнопки «Добавить» нет.
  await page.evaluate(() => { activeProject = 'Альфа'; renderAll(); switchView('tasks'); });
  await page.locator('article.task').first().locator('.tasktitle').click();
  await page.waitForFunction(() => document.querySelector('#drawer').classList.contains('open'));
  assert(await page.locator('#addChecklistItem').count() === 0, 'The add button is gone');
  await page.locator('#newChecklistItem').fill('Первый пункт');
  await page.keyboard.press('Enter');
  assert(await page.locator('#checklistItems .checklist-row').count() === 1, 'Enter adds a checklist item');
  assert(await page.locator('#newChecklistItem').inputValue() === '', 'Input cleared after Enter');
  await page.locator('#newChecklistItem').fill('Не нужно');
  await page.keyboard.press('Escape');
  assert(await page.locator('#newChecklistItem').inputValue() === '' && await page.locator('#drawer.open').count() === 1, 'Esc clears the input and keeps the card open');
  assert(await page.locator('#checklistItems .checklist-row').count() === 1, 'Esc adds nothing');
  // «Мои задачи»: список и «Быстрые заметки» меняют ширину вместе в обе стороны.
  await page.evaluate(() => { standaloneTasks.push({ id: 9001, title: 'Без проекта', status: 'Очередь', owner: '', end: '', description: '', comment: '' }); window.myTasksFilter = 'focus'; switchView('mytasks'); renderMyTasks(); window.renderQuickNotes && window.renderQuickNotes(); });
  await page.keyboard.press('Escape');
  const edges = () => page.evaluate(() => { const l = document.querySelector('#myTasksView .mytask-list'), q = document.querySelector('#myTasksView .qn-panel'); return { l: Math.round(l.getBoundingClientRect().width), q: q ? Math.round(q.getBoundingClientRect().width) : null }; });
  for (const w of [520, 860, 1000]) {
    await page.evaluate((v) => __listWidth.set(v), w);
    const e = await edges();
    assert(e.q === null || Math.abs(e.l - e.q) <= 30, `List and notes must have the same width at ${w}: ${JSON.stringify(e)}`);
    assert(e.l >= Math.min(w, 500) - 10, `List follows the width ${w}: ${JSON.stringify(e)}`);
  }
  await page.evaluate(() => __listWidth.set(0));
  assert(!errors.length, 'Page errors: ' + errors.join('; '));
  console.log('Project groups OK: menu, header, collapse, saved, checklist Enter/Esc');
} finally {
  await browser.close();
  await new Promise((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
}
