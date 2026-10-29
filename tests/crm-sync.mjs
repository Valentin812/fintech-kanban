import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const html = await readFile('index.html');
const server = createServer((request, response) => {
  if (request.url !== '/') {
    response.writeHead(404).end('Not found');
    return;
  }
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(html);
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();
const launchOptions = { headless: true };
if (process.env.CHROMIUM_EXECUTABLE) launchOptions.executablePath = process.env.CHROMIUM_EXECUTABLE;
const browser = await chromium.launch(launchOptions);

const T = (o) => ({ productId: 7, description: '', priority: 3, due: '', dueTime: '', dueTz: 'Asia/Yekaterinburg', assignee: 'Валентин', requester: 'Сергей Админ', protocolId: '', comments: 0, createdAt: '2026-10-27T08:00:00Z', updatedAt: '', archived: false, start: '', clTotal: 0, clDone: 0, checklist: null, ...o });
const crm = { calls: [], conflictNext: false, created: null, nextItem: 700, comments: [{ id: '800', task_id: '220', body: 'Ждём ответа банка', created_at: '2026-10-27T10:00:00Z', author_name: 'Сергей Админ', created_by: '104' }], sentKeys: new Map(), tasks: [
  T({ id: '220', title: 'Провести встречу', status: 'new', version: 3, protocolId: '35', comments: 1, start: '2026-10-26', due: '2026-10-30', clTotal: 2, clDone: 1, checklist: [{ id: '600', title: 'Позвонить', completed: true }, { id: '601', title: 'Согласовать время', completed: false }] }),
  T({ id: '221', title: 'Организовать встречу', status: 'active', version: 5, due: '2026-10-28', dueTime: '18:00' }),
  T({ id: '222', title: 'Отменённая', status: 'cancelled', version: 2 }),
] };
const listView = (t) => ({ ...t, checklist: null });
const sync = (t) => { t.clTotal = (t.checklist || []).length; t.clDone = (t.checklist || []).filter((i) => i.completed).length; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 8000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await wait(150); } throw new Error('Timeout waiting for condition'); }
try {
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('dialog', (d) => d.accept());
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.route('https://vdlfdnhfiiltdyrucdtn.supabase.co/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === '/auth/v1/token' && request.method() === 'POST') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          access_token: 'mock-access-token',
          refresh_token: 'mock-refresh-token',
          token_type: 'bearer',
          expires_in: 3600,
          user: {
            id: '00000000-0000-4000-8000-000000000001',
            aud: 'authenticated',
            role: 'authenticated',
            email: 'smoke@example.test',
            app_metadata: {},
            user_metadata: {},
          },
        }),
      });
      return;
    }
    if (url.pathname === '/rest/v1/kanban_state' && request.method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      return;
    }
    if ((url.pathname === '/rest/v1/telegram_inbox' || url.pathname === '/rest/v1/kanban_avatars') && request.method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      return;
    }
    if (url.pathname === '/rest/v1/shared_projects' && request.method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      return;
    }
    if (url.pathname === '/rest/v1/notifications' && request.method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      return;
    }
    if (url.pathname === '/rest/v1/kanban_profiles' && request.method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ user_id: '00000000-0000-4000-8000-000000000002', display_name: 'Илья Бекетов', email: 'beketov@example.test', created_at: '2026-01-01T00:00:00Z' }]) });
      return;
    }
    if (url.pathname === '/rest/v1/kanban_state' && request.method() === 'POST') {
      try { globalThis.__lastState = JSON.parse(request.postData()); } catch {}
      await route.fulfill({ status: 201, body: '' });
      return;
    }
    if (url.pathname.startsWith('/storage/v1/object/sign/')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ signedURL: '/object/sign/x?token=t' }) });
      return;
    }
    if (url.pathname.startsWith('/storage/v1/object/project-releases/') && request.method() === 'POST') {
      globalThis.__uploaded = decodeURIComponent(url.pathname);
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"Key":"ok"}' });
      return;
    }
    if (url.pathname.startsWith('/storage/v1/object/project-releases/') && request.method() === 'DELETE') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      return;
    }
    if (url.pathname === '/functions/v1/crm-sync') {
      const b = JSON.parse(request.postData() || '{}');
      crm.calls.push(b);
      const ok = (o, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(o) });
      if (b.action === 'pull') { await ok({ me: { id: '101', name: 'Валентин' }, crmUrl: 'https://crm.example.test', products: [{ id: 7, name: 'Ремонты', complete: true, tasks: crm.tasks.filter((x) => !x.hidden).map(listView) }, { id: 8, name: 'Продажи', complete: true, tasks: [] }] }); return; }
      if (b.action === 'products') { await ok({ products: [{ id: 7, name: 'Ремонты' }, { id: 8, name: 'Продажи' }] }); return; }
      if (b.action === 'task') { await ok({ task: crm.tasks.find((x) => x.id === b.id) }); return; }
      if (b.action === 'update') {
        const t = crm.tasks.find((x) => x.id === b.id);
        if (crm.conflictNext) { crm.conflictNext = false; t.version++; t.title = 'Изменено в CRM'; await ok({ conflict: true, task: listView(t) }, 409); return; }
        if (b.base.version !== t.version) { await ok({ conflict: true, task: listView(t) }, 409); return; }
        const f = b.fields;
        if (f.title !== undefined) t.title = f.title;
        if (f.description !== undefined) t.description = f.description;
        if (f.status !== undefined) t.status = f.status;
        if (f.due !== undefined) t.due = f.due;
        if (f.start !== undefined) t.start = f.start;
        t.version++;
        await ok({ task: listView(t) });
        return;
      }
      if (b.action === 'checklist') {
        const t = crm.tasks.find((x) => x.id === b.id);
        if (b.version !== t.version) { await ok({ conflict: true, task: t }, 409); return; }
        t.checklist = t.checklist || [];
        if (b.op === 'add') t.checklist.push({ id: String(crm.nextItem++), title: b.title, completed: false });
        if (b.op === 'set') t.checklist.find((i) => i.id === b.itemId).completed = !!b.completed;
        if (b.op === 'delete') t.checklist = t.checklist.filter((i) => i.id !== b.itemId);
        sync(t); t.version++;
        await ok({ task: t, duplicate: false });
        return;
      }
      if (b.action === 'comment') {
        const task = crm.tasks.find((x) => x.id === b.id);
        if (crm.sentKeys.has(b.requestKey)) { await ok({ comment: { id: crm.sentKeys.get(b.requestKey), body: b.body }, version: task.version, duplicate: true }); return; }
        const id = String(900 + crm.comments.length);
        crm.comments.push({ id, task_id: b.id, body: b.body, created_at: '2026-10-28T15:55:00Z', author_name: 'Валентин', created_by: '101' });
        crm.sentKeys.set(b.requestKey, id);
        task.version++; task.comments = (task.comments || 0) + 1;
        await ok({ comment: { id, body: b.body }, version: task.version, duplicate: false });
        return;
      }
      if (b.action === 'comments') { await ok({ comments: crm.comments.filter((c) => c.task_id === b.id).reverse().map((c) => ({ id: c.id, body: c.body, createdAt: c.created_at, author: c.author_name, by: c.created_by })) }); return; }
      if (b.action === 'operators') { await ok({ operators: [{ id: '102', name: 'Лена' }, { id: '103', name: 'Андрей' }] }); return; }
      if (b.action === 'create') {
        crm.created = b;
        const t = T({ id: '300', productId: b.productId, title: b.title, description: b.description, status: b.status, version: 1 + b.checklist.length, due: b.due, start: b.start, assignee: b.assignedTo === '102' ? 'Лена' : 'Валентин', checklist: b.checklist.map((title, i) => ({ id: String(500 + i), title, completed: false })) });
        sync(t); crm.tasks.push(t);
        await ok({ task: t, duplicate: false, checklistFailed: false });
        return;
      }
      await ok({ error: 'unknown' }, 400);
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.locator('#authEmail').fill('smoke@example.test');
  await page.locator('#authPassword').fill('mock-password');
  await page.locator('#authSubmit').click();
  await page.locator('.app').waitFor({ state: 'visible' });
  await page.waitForTimeout(1500);
  if (crm.calls.length) throw new Error('No CRM calls until the integration is turned on');
  const ST = (id) => page.evaluate((i) => { const t = standaloneTasks.find((x) => x.crm && x.crm.id === i); return t ? JSON.parse(JSON.stringify(t)) : null; }, id);
  const syncNow = async () => { await until(() => page.evaluate(() => !window.__crm.state.busy)); await page.evaluate(() => window.__crm.sync(true)); await until(() => page.evaluate(() => !window.__crm.state.busy)); };
  // Подключение: задачи «мои» приходят в «Задачи без проекта», отдельный проект не создаётся.
  await page.evaluate(() => document.getElementById('crmConnectButton').click());
  await until(() => page.evaluate(() => standaloneTasks.length >= 2));
  await until(async () => (await ST('220'))?.checklist?.length === 2);
  if (await page.evaluate(() => data.some((p) => p.name.includes('Этажи') || p.name.includes('Ремонты')))) throw new Error('No CRM project must be created');
  const t220 = await ST('220'), t221 = await ST('221');
  if (await page.evaluate(() => standaloneTasks.length) !== 2 || await ST('222')) throw new Error('Cancelled task must not be imported');
  if (t220.status !== 'Очередь' || t221.status !== 'В работе' || t221.end !== '28.10.2026' || t220.source !== 'crm' || t220.owner !== 'Валентин') throw new Error('Mapping wrong: ' + JSON.stringify([t220, t221]));
  if (t220.start !== '26.10.2026' || t220.end !== '30.10.2026') throw new Error('Start date from CRM: ' + t220.start);
  if (t221.start !== '27.10.2026') throw new Error('Without start in CRM the created date is used: ' + t221.start);
  if (t220.checklist.map((i) => i.text + (i.done ? '+' : '-')).join('|') !== 'Позвонить+|Согласовать время-' || t220.checklist[0].cid !== '600') throw new Error('Checklist from CRM: ' + JSON.stringify(t220.checklist));
  if (t220.crm.pn !== 'Ремонты' || 'priority' in t220.crm) throw new Error('Project name stored, priority not');
  if (await page.evaluate(() => !projectMeta.__crm__?.enabled)) throw new Error('Enabled flag must be stored');
  if (crm.calls.some((c) => c.action === 'update' || c.action === 'checklist')) throw new Error('Nothing must be pushed back right after the pull: ' + JSON.stringify(crm.calls.filter((c) => c.action === 'update' || c.action === 'checklist')));
  // Метка «внешняя CRM» в списке задач без проекта, фильтр и карточка.
  await page.evaluate(() => { switchView('inbox'); renderMyTasks(); });
  await page.locator('#myTasksView .crm-badge', { hasText: 'CRM №220' }).waitFor();
  if (await page.locator('#myTasksView .crm-badge', { hasText: 'Этажи' }).count()) throw new Error('Old name must not be shown');
  await page.evaluate(() => { standaloneTasks.push({ id: 9001, title: 'Личная', status: 'Очередь' }); renderMyTasks(); });
  if (await page.locator('#myTasksView .mytask-row:visible').count() !== 3) throw new Error('All three rows expected');
  await page.locator('[data-crm-only]').click();
  if (await page.locator('#myTasksView .mytask-row:visible').count() !== 2) throw new Error('Filter must hide non-CRM rows');
  await page.locator('[data-crm-only]').click();
  if (await page.locator('#myTasksView .mytask-row:visible').count() !== 3) throw new Error('Filter must show all again');
  await page.evaluate(() => { standaloneTasks = standaloneTasks.filter((t) => t.id !== 9001); });
  await page.evaluate((id) => openStandaloneTask(id), t220.id);
  const info = await page.locator('#crmInfo').textContent();
  if (!info.includes('№220') || !info.includes('протокол №35') || !info.includes('Сергей Админ') || !info.includes('Ремонты') || /важност/i.test(info)) throw new Error('Drawer info: ' + info);
  await page.evaluate(() => closeDrawer());
  // Изменения уходят в CRM: статус, срок, дата начала; у задачи с точным временем передаётся время.
  await page.evaluate(([a, b]) => { const x = standaloneTasks.find((t) => t.id === a), y = standaloneTasks.find((t) => t.id === b); x.status = 'В работе'; x.end = '05.11.2026'; x.start = '28.10.2026'; y.end = '30.10.2026'; save(); }, [t220.id, t221.id]);
  await until(() => crm.calls.filter((c) => c.action === 'update').length >= 2, 10000);
  const u220 = crm.calls.find((c) => c.action === 'update' && c.id === '220'), u221 = crm.calls.find((c) => c.action === 'update' && c.id === '221');
  if (u220.fields.status !== 'active' || u220.fields.due !== '2026-11-05' || u220.fields.start !== '2026-10-28' || u220.base.version !== 3 || u220.productId !== 7) throw new Error('Update 220: ' + JSON.stringify(u220));
  if (u221.fields.due !== '2026-10-30' || u221.base.dueTime !== '18:00' || u221.fields.status || u221.fields.start) throw new Error('Update 221: ' + JSON.stringify(u221));
  await until(async () => (await ST('220')).crm.version === 4);
  // Чек-лист карточки → CRM: отметка, новый пункт, удаление.
  await page.evaluate((id) => { const t = standaloneTasks.find((x) => x.id === id); t.checklist[1].done = true; t.checklist.push({ text: 'Подготовить зал', done: false }); t.checklist.splice(0, 1); save(); }, t220.id);
  await until(() => crm.calls.filter((c) => c.action === 'checklist').length >= 3, 12000);
  const ops = crm.calls.filter((c) => c.action === 'checklist').map((c) => c.op).sort().join(',');
  if (ops !== 'add,delete,set') throw new Error('Checklist ops: ' + ops);
  await until(async () => { const t = await ST('220'); return t.crm.version === crm.tasks[0].version && t.checklist.length === 2 && t.checklist.every((i) => i.cid); });
  const srv = crm.tasks[0].checklist.map((i) => i.title + (i.completed ? '+' : '-')).join('|');
  if (srv !== 'Согласовать время+|Подготовить зал-') throw new Error('Checklist in CRM: ' + srv);
  const addOp = crm.calls.find((c) => c.action === 'checklist' && c.op === 'add');
  if (addOp.title !== 'Подготовить зал' || !/^kanban-cl-/.test(addOp.requestKey)) throw new Error('Add op: ' + JSON.stringify(addOp));
  // Чек-лист CRM → карточка: отмечено и добавлено в CRM.
  crm.tasks[0].checklist[1].completed = true; crm.tasks[0].checklist.push({ id: '777', title: 'Из CRM', completed: false }); sync(crm.tasks[0]); crm.tasks[0].version++;
  await syncNow();
  await until(async () => (await ST('220')).checklist.length === 3);
  const cl = (await ST('220')).checklist;
  if (!cl[1].done || cl[2].text !== 'Из CRM' || cl[2].cid !== '777') throw new Error('Checklist pull: ' + JSON.stringify(cl));
  if (crm.calls.filter((c) => c.action === 'checklist').length !== 3) throw new Error('Pulled checklist must not be echoed back');
  // Задача, связанная до появления комментариев (без sent/cids/cseen), не ломает синхронизацию.
  await page.evaluate((id) => { const x = standaloneTasks.find((q) => q.id === id); delete x.crm.sent; delete x.crm.cids; delete x.crm.cseen; x.comment = ''; }, t221.id);
  await syncNow();
  await wait(500);
  if (await page.evaluate(() => document.body.textContent.includes('Cannot read properties'))) throw new Error('Legacy linked task must not break the sync');
  // Комментарии из CRM подтягиваются в задачу.
  await until(async () => ((await ST('220')).comment || '').includes('Сергей Админ: Ждём ответа банка'));
  // Комментарий из канбана уходит в CRM один раз, версия задачи обновляется.
  await page.evaluate((id) => { const t = standaloneTasks.find((x) => x.id === id); t.comment = (t.comment ? t.comment + '\n\n' : '') + '28.10.2026, 20:50:12 — Договорился на пятницу'; save(); }, t220.id);
  await until(() => crm.comments.some((c) => c.body === 'Договорился на пятницу'), 10000);
  await wait(1500);
  const sent = crm.calls.filter((c) => c.action === 'comment');
  if (sent.length !== 1 || sent[0].id !== '220' || sent[0].productId !== 7 || !/^[A-Za-z0-9_-]{12,128}$/.test(sent[0].requestKey)) throw new Error('Comment push: ' + JSON.stringify(sent));
  if (crm.comments.filter((c) => c.body === 'Ждём ответа банка').length !== 1) throw new Error('Pulled comment must not be echoed back');
  const after = await ST('220');
  if (after.comment.split('\n\n').length !== 2 || after.crm.version !== crm.tasks[0].version) throw new Error('Version/comments after push: ' + JSON.stringify([after.crm.version, crm.tasks[0].version]));
  // Трёхстороннее слияние: в CRM поменяли название, у нас — описание; оба изменения сохраняются.
  const merged = await page.evaluate((id) => { const t = standaloneTasks.find((x) => x.id === id); t.description = 'Локальная заметка'; window.__crm.merge(t, { ...t.crm, id: '220', productId: 7, title: 'Новое из CRM', description: '', status: 'active', due: '2026-11-05', start: '2026-10-28', version: 99 }); return { title: t.title, description: t.description, diff: window.__crm.diff(t) }; }, t220.id);
  if (merged.title !== 'Новое из CRM' || merged.description !== 'Локальная заметка' || merged.diff?.description !== 'Локальная заметка' || merged.diff.title) throw new Error('Merge: ' + JSON.stringify(merged));
  await page.evaluate((id) => { const t = standaloneTasks.find((x) => x.id === id); t.description = ''; t.title = 'Провести встречу'; window.__crm.merge(t, { id: '220', productId: 7, title: 'Провести встречу', description: '', status: 'active', due: '2026-11-05', start: '2026-10-28', version: crm_version() }); function crm_version() { return t.crm.version; } }, t220.id);
  // Конфликт версии: CRM вернула 409 — подтягиваем свежую версию.
  crm.conflictNext = true;
  await page.evaluate((id) => { const t = standaloneTasks.find((x) => x.id === id); t.title = 'Локальное название'; save(); }, t221.id);
  await until(async () => (await ST('221')).title === 'Изменено в CRM', 10000);
  // Личная задача CRM, которой нет в общем списке, остаётся связанной: карточку проверяем напрямую.
  crm.tasks.push(T({ id: '230', title: 'Личная в CRM', status: 'active', version: 2, hidden: true }));
  await page.evaluate(() => { standaloneTasks.push({ id: 9200, title: 'Личная в CRM', status: 'В работе', start: '', end: '', crm: { id: '230', productId: 7, version: 1, sent: [], cids: [], cseen: 0, cl: { ids: [], tot: 0, done: 0 }, cancelled: false, snap: { title: 'Личная в CRM', description: '', status: 'В работе', end: '', start: '' } } }); });
  await syncNow();
  await wait(800);
  const hid = await ST('230');
  if (hid.crm.gone || hid.crm.cancelled || hid.crm.st !== 'active') throw new Error('Hidden personal task must stay linked: ' + JSON.stringify(hid.crm));
  // Отменена в CRM — «Готово», но не в архиве; снята с меня — остаётся, помечена, ничего не удаляется.
  crm.tasks = crm.tasks.filter((t) => t.id !== '220');
  crm.tasks.find((t) => t.id === '221').status = 'cancelled';
  crm.tasks.find((t) => t.id === '221').version++;
  await syncNow();
  await until(async () => (await ST('221')).crm.cancelled && (await ST('220')).crm.gone);
  const c221 = await ST('221'), c220 = await ST('220');
  if (c221.status !== 'Готово' || c221.archived || c220.archived || c221.crm.why !== 'cancelled') throw new Error('Cancelled/gone must not be archived before asking: ' + JSON.stringify([c221.status, c221.archived, c220.archived]));
  await page.evaluate((id) => openStandaloneTask(id), c221.id);
  const cinfo = await page.locator('#crmInfo').textContent();
  if (!cinfo.includes('отменена в CRM') || !cinfo.includes('статус в CRM: отменена')) throw new Error('Drawer must show the CRM state: ' + cinfo);
  await page.evaluate(() => closeDrawer());
  if (await page.evaluate(() => standaloneTasks.filter((t) => t.crm).length) < 3) throw new Error('Tasks must not be deleted');
  // Приложение спрашивает, что делать с закрытой в CRM карточкой.
  const ask = page.locator('.friendly-dialog', { hasText: 'Задача закрыта в CRM' });
  await ask.waitFor();
  const first = (await ask.locator('.mini').textContent());
  const which = first.includes('№221') ? '221' : '220';
  await ask.locator('[name=f0]').selectOption(which === '221' ? 'archive' : 'keep');
  await ask.locator('button[type=submit]').click();
  const ask2 = page.locator('.friendly-dialog', { hasText: 'Задача закрыта в CRM' });
  await ask2.waitFor();
  await ask2.locator('[name=f0]').selectOption(which === '221' ? 'keep' : 'archive');
  await ask2.locator('button[type=submit]').click();
  await until(async () => { const a = await ST('221'), b = await ST('220'); return (which === '221' ? a?.archived && !b : !a && b?.archived) || (which === '221' ? (a?.archived && !b) : false); }, 5000).catch(() => {});
  const arch = await page.evaluate(() => standaloneTasks.filter((t) => t.archived).map((t) => ({ id: t.crm?.id, status: t.status, completed: !!t.completedAt })));
  if (arch.length !== 1 || arch[0].status !== 'Готово' || !arch[0].completed) throw new Error('Exactly one card archived: ' + JSON.stringify(arch));
  if (await page.evaluate(() => standaloneTasks.filter((t) => t.crm && (t.crm.id === '221' || t.crm.id === '220')).length) !== 1) throw new Error('The other card must be unlinked');
  if (await page.evaluate(() => !standaloneTasks.some((t) => t.title === 'Организовать встречу' || t.title === 'Изменено в CRM') && !standaloneTasks.some((t) => t.title === 'Провести встречу'))) throw new Error('Cards must not be deleted');
  // Завершили сами в канбане, CRM заархивировала — окно вопроса не появляется.
  await page.evaluate(() => { standaloneTasks.push({ id: 9400, title: 'Закрою сам', status: 'В работе', start: '', end: '', crm: { id: '240', productId: 7, version: 1, sent: [], cids: [], cseen: 0, cl: { ids: [], tot: 0, done: 0 }, cancelled: false, snap: { title: 'Закрою сам', description: '', status: 'В работе', end: '', start: '' } } }); });
  crm.tasks.push(T({ id: '240', title: 'Закрою сам', status: 'active', version: 1 }));
  await page.evaluate(() => { standaloneTasks.find((t) => t.id === 9400).status = 'Готово'; save(); });
  await until(() => crm.calls.some((c) => c.action === 'update' && c.id === '240' && c.fields.status === 'done'), 10000);
  crm.tasks.find((x) => x.id === '240').archived = true; crm.tasks = crm.tasks.filter((x) => x.id !== '240');
  crm.tasks.push(T({ id: '240', title: 'Закрою сам', status: 'done', version: 3, archived: true, hidden: true }));
  await syncNow();
  await wait(1500);
  if (await page.locator('.friendly-dialog', { hasText: 'Задача закрыта в CRM' }).count()) throw new Error('No prompt for a closure made in the kanban');
  if (!(await ST('240')).crm.asked) throw new Error('Own closure is marked as handled');
  // Метка на своей карточке: проект CRM → исполнитель → задача создаётся в CRM со статусом, сроками и чек-листом.
  await page.evaluate(() => { standaloneTasks.push({ id: 9100, title: 'Сверить смету', start: '20.10.2026', end: '10.11.2026', status: 'В работе', owner: '', description: 'Материалы и работы', comment: '', checklist: [{ text: 'Материалы', done: false }, { text: 'Работы', done: true }] }); openStandaloneTask(9100); });
  await page.locator('[data-crm-attach]').click();
  let dlg = page.locator('.friendly-dialog');
  await dlg.waitFor();
  await dlg.locator('[name=f0]').selectOption('8');
  await dlg.locator('button[type=submit]').click();
  await dlg.locator('[name=f0]').selectOption('102');
  await page.locator('.friendly-dialog button[type=submit]').click();
  await until(() => !!crm.created);
  const cr = crm.created;
  if (cr.title !== 'Сверить смету' || cr.productId !== 8 || cr.assignedTo !== '102' || cr.due !== '2026-11-10' || cr.start !== '2026-10-20' || cr.status !== 'active' || cr.description !== 'Материалы и работы' || cr.checklist.join('|') !== 'Материалы|Работы' || !/^[A-Za-z0-9_-]{12,128}$/.test(cr.requestKey)) throw new Error('Create: ' + JSON.stringify(cr));
  await until(async () => !!(await ST('300')));
  const n300 = await ST('300');
  if (n300.crm.pn !== 'Продажи' || n300.owner !== 'Лена' || n300.checklist.map((i) => i.cid).join(',') !== '500,501' || n300.source !== 'crm') throw new Error('Linked after create: ' + JSON.stringify(n300));
  await until(async () => (await page.locator('#crmInfo').textContent()).includes('№300'));
  // Отметка, поставленная локально до отправки, уходит следующим шагом (в CRM пункты создаются невыполненными).
  await until(() => crm.calls.some((c) => c.action === 'checklist' && c.op === 'set' && c.itemId === '501' && c.completed === true), 12000);
  // Снять метку: выбор «Отмена», задача в CRM закрыта, карточка остаётся без связи.
  await page.locator('[data-crm-detach]').click();
  await page.locator('.friendly-dialog [name=f0]').selectOption('cancelled');
  await page.locator('.friendly-dialog button[type=submit]').click();
  await until(() => crm.calls.some((c) => c.action === 'update' && c.id === '300'));
  const un = crm.calls.find((c) => c.action === 'update' && c.id === '300');
  if (un.fields.status !== 'cancelled' || un.productId !== 8) throw new Error('Detach update: ' + JSON.stringify(un));
  await until(() => page.evaluate(() => { const t = standaloneTasks.find((x) => x.id === 9100); return !!t && !t.crm && !t.source; }));
  if (await page.evaluate(() => standaloneTasks.find((x) => x.id === 9100).checklist.some((i) => i.cid || i.csnap))) throw new Error('Checklist links must be removed');
  if (!(await page.locator('[data-crm-attach]').count())) throw new Error('Label button must be available again after detaching');
  await page.evaluate(() => closeDrawer());
  // Старые проекты «Этажи · …»: задачи переезжают в «Мои задачи», проекты убираются, остальные данные не теряются.
  await page.evaluate(() => { data.push({ name: 'Этажи · Старый', tasks: [{ id: 9300, title: 'Старая из CRM', status: 'Очередь', comment: '28.10.2026, 10:00:00 — привет', checklist: [{ text: 'п1', done: false, cid: '1', csnap: { text: 'п1', done: false } }], crm: { id: '231', productId: 7, version: 1, sent: [], cids: [], cseen: 0, cancelled: false, snap: { title: 'Старая из CRM', description: '', status: 'Очередь', end: '', start: '' } } }, { id: 9301, title: 'Локальная в проекте', status: 'В работе' }] }); projectMeta['Этажи · Старый'] = { crm: { productId: 7 } }; });
  crm.tasks.push(T({ id: '231', title: 'Старая из CRM', status: 'new', version: 1 }));
  await syncNow();
  const mv = page.locator('.friendly-dialog', { hasText: 'Перенести задачи CRM' });
  await mv.waitFor();
  await mv.locator('.btn.primary').click();
  await until(() => page.evaluate(() => !data.some((p) => p.name === 'Этажи · Старый')));
  const moved = await page.evaluate(() => ({ crm: standaloneTasks.find((t) => t.id === 9300), loc: standaloneTasks.find((t) => t.title === 'Локальная в проекте'), meta: 'Этажи · Старый' in projectMeta }));
  if (!moved.crm || moved.crm.crm.id !== '231' || !moved.crm.comment.includes('привет') || moved.crm.checklist[0].cid !== '1' || !moved.loc || moved.meta) throw new Error('Legacy move: ' + JSON.stringify(moved));
  // Отключение: синхронизация останавливается.
  await page.evaluate(() => document.getElementById('crmConnectButton').click());
  await page.locator('.friendly-dialog .btn.primary').click();
  const before = crm.calls.length;
  await page.evaluate(() => { standaloneTasks.find((t) => t.crm).title = 'После отключения'; save(); });
  await page.waitForTimeout(5000);
  if (crm.calls.length !== before) throw new Error('No CRM calls after turning off');
  if (pageErrors.length) throw new Error('Page errors: ' + pageErrors.join('; '));
  console.log('CRM sync OK');
} finally {
  await browser.close();
  server.close();
}
