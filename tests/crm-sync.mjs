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

const T = (o) => ({ productId: 7, description: '', priority: 3, due: '', dueTime: '', dueTz: 'Asia/Yekaterinburg', assignee: 'Валентин', requester: 'Сергей Админ', protocolId: '', comments: 0, createdAt: '2026-10-27T08:00:00Z', updatedAt: '', archived: false, ...o });
const crm = { calls: [], conflictNext: false, created: null, tasks: [
  T({ id: '220', title: 'Провести встречу', status: 'new', version: 3, protocolId: '35' }),
  T({ id: '221', title: 'Организовать встречу', status: 'active', version: 5, due: '2026-10-28', dueTime: '18:00' }),
  T({ id: '222', title: 'Отменённая', status: 'cancelled', version: 2 }),
] };
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
      if (b.action === 'pull') { await ok({ me: { id: '101', name: 'Валентин' }, crmUrl: 'https://crm.example.test', products: [{ id: 7, name: 'Ремонты', complete: true, tasks: crm.tasks }, { id: 8, name: 'Пусто', complete: true, tasks: [] }] }); return; }
      if (b.action === 'update') {
        const t = crm.tasks.find((x) => x.id === b.id);
        if (crm.conflictNext) { crm.conflictNext = false; t.version++; t.title = 'Изменено в CRM'; await ok({ conflict: true, task: t }, 409); return; }
        if (b.base.version !== t.version) { await ok({ conflict: true, task: t }, 409); return; }
        const f = b.fields;
        if (f.title !== undefined) t.title = f.title;
        if (f.description !== undefined) t.description = f.description;
        if (f.status !== undefined) t.status = f.status;
        if (f.due !== undefined) t.due = f.due;
        t.version++;
        await ok({ task: t });
        return;
      }
      if (b.action === 'operators') { await ok({ operators: [{ id: '102', name: 'Лена' }, { id: '103', name: 'Андрей' }] }); return; }
      if (b.action === 'create') { crm.created = b; await ok({ task: { id: '300', title: b.title }, duplicate: false }); return; }
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
  // Подключение: задачи «мои» приходят в проект «Этажи · Ремонты».
  await page.evaluate(() => document.getElementById('crmConnectButton').click());
  const P = 'Этажи · Ремонты';
  await until(() => page.evaluate((n) => !!data.find((p) => p.name === n), P));
  const tasks = await page.evaluate((n) => data.find((p) => p.name === n).tasks.map((t) => ({ id: t.id, title: t.title, status: t.status, end: t.end, crm: t.crm, source: t.source, owner: t.owner, archived: !!t.archived })), P);
  if (tasks.length !== 2) throw new Error('Cancelled task must not be imported: ' + tasks.length);
  const t220 = tasks.find((t) => t.crm.id === '220'), t221 = tasks.find((t) => t.crm.id === '221');
  if (t220.status !== 'Очередь' || t221.status !== 'В работе' || t221.end !== '28.10.2026' || t220.source !== 'crm' || t220.owner !== 'Валентин') throw new Error('Mapping wrong: ' + JSON.stringify(tasks));
  if (await page.evaluate(() => data.some((p) => p.name.includes('Пусто')))) throw new Error('Empty CRM project must not be created');
  if (await page.evaluate(() => !projectMeta.__crm__?.enabled)) throw new Error('Enabled flag must be stored');
  // Пометки на доске и в карточке.
  await page.evaluate((n) => { activeProject = n; switchView('tasks'); renderAll(); }, P);
  await page.locator('#board .crm-badge', { hasText: 'Этажи №220' }).waitFor();
  if (!(await page.locator('#crmBar').isVisible())) throw new Error('CRM bar must be visible in a CRM project');
  await page.evaluate((id) => openTask(id), t220.id);
  const info = await page.locator('#crmInfo').textContent();
  if (!info.includes('№220') || !info.includes('протокол №35') || !info.includes('Сергей Админ')) throw new Error('Drawer info: ' + info);
  await page.evaluate(() => closeDrawer());
  // Изменения уходят в CRM: статус и срок; у задачи с точным временем передаётся время.
  await page.evaluate(([a, b]) => { const p = data.find((x) => x.name === 'Этажи · Ремонты'); const x = p.tasks.find((t) => t.id === a), y = p.tasks.find((t) => t.id === b); x.status = 'В работе'; x.end = '05.11.2026'; y.end = '30.10.2026'; save(); }, [t220.id, t221.id]);
  await until(() => crm.calls.filter((c) => c.action === 'update').length >= 2, 10000);
  const u220 = crm.calls.find((c) => c.action === 'update' && c.id === '220'), u221 = crm.calls.find((c) => c.action === 'update' && c.id === '221');
  if (u220.fields.status !== 'active' || u220.fields.due !== '2026-11-05' || u220.base.version !== 3 || u220.productId !== 7) throw new Error('Update 220: ' + JSON.stringify(u220));
  if (u221.fields.due !== '2026-10-30' || u221.base.dueTime !== '18:00' || u221.fields.status) throw new Error('Update 221: ' + JSON.stringify(u221));
  await until(() => page.evaluate((id) => data.find((p) => p.name === 'Этажи · Ремонты').tasks.find((t) => t.id === id).crm.version === 4, t220.id));
  // Трёхстороннее слияние: в CRM поменяли название, у нас — описание; оба изменения сохраняются.
  const merged = await page.evaluate((id) => { const t = data.find((p) => p.name === 'Этажи · Ремонты').tasks.find((x) => x.id === id); t.description = 'Локальная заметка'; window.__crm.merge(t, { ...t.crm, id: '220', productId: 7, title: 'Новое из CRM', description: '', status: 'active', due: '2026-11-05', version: 9 }); return { title: t.title, description: t.description, diff: window.__crm.diff(t) }; }, t220.id);
  if (merged.title !== 'Новое из CRM' || merged.description !== 'Локальная заметка' || merged.diff?.description !== 'Локальная заметка' || merged.diff.title) throw new Error('Merge: ' + JSON.stringify(merged));
  await page.evaluate((id) => { const t = data.find((p) => p.name === 'Этажи · Ремонты').tasks.find((x) => x.id === id); t.description = ''; window.__crm.merge(t, { id: '220', productId: 7, title: crmTitle(), description: '', status: 'active', due: '2026-11-05', version: 4 }); function crmTitle() { return 'Провести встречу'; } }, t220.id);
  // Конфликт версии: CRM вернула 409 — подтягиваем свежую версию.
  crm.conflictNext = true;
  await page.evaluate((id) => { const t = data.find((p) => p.name === 'Этажи · Ремонты').tasks.find((x) => x.id === id); t.title = 'Локальное название'; save(); }, t221.id);
  await until(() => page.evaluate((id) => data.find((p) => p.name === 'Этажи · Ремонты').tasks.find((t) => t.id === id).title === 'Изменено в CRM', t221.id), 10000);
  // Снята с меня / в архиве CRM и отменённая — уходят в архив, не удаляются.
  crm.tasks = crm.tasks.filter((t) => t.id !== '220');
  crm.tasks.find((t) => t.id === '221').status = 'cancelled';
  crm.tasks.find((t) => t.id === '221').version++;
  await page.evaluate(() => window.__crm.sync(true));
  await until(() => page.evaluate(() => data.find((p) => p.name === 'Этажи · Ремонты').tasks.every((t) => t.archived && t.status === 'Готово')));
  if (await page.evaluate(() => data.find((p) => p.name === 'Этажи · Ремонты').tasks.length) !== 2) throw new Error('Tasks must not be deleted');
  // Поручение другому сотруднику.
  await page.evaluate((n) => { activeProject = n; switchView('tasks'); renderAll(); }, P);
  await page.locator('[data-crm-new]').click();
  const dlg = page.locator('.friendly-dialog');
  await dlg.waitFor();
  await dlg.locator('[name=f0]').fill('Сверить смету');
  await dlg.locator('[name=f1]').selectOption('102');
  await dlg.locator('[name=f2]').fill('10.11.2026');
  await dlg.locator('[name=f3]').fill('Материалы и работы');
  await dlg.locator('button[type=submit], .btn.primary').first().click();
  await until(() => !!crm.created);
  if (crm.created.title !== 'Сверить смету' || crm.created.assignedTo !== '102' || crm.created.due !== '2026-11-10' || !/^[A-Za-z0-9_-]{12,128}$/.test(crm.created.requestKey) || crm.created.productId !== 7) throw new Error('Create: ' + JSON.stringify(crm.created));
  // Отключение: синхронизация останавливается.
  await page.evaluate(() => document.getElementById('crmConnectButton').click());
  await page.locator('.friendly-dialog .btn.primary').click();
  const before = crm.calls.length;
  await page.evaluate(() => { const p = data.find((x) => x.name === 'Этажи · Ремонты'); p.tasks[0].title = 'После отключения'; save(); });
  await page.waitForTimeout(5000);
  if (crm.calls.length !== before) throw new Error('No CRM calls after turning off');
  if (pageErrors.length) throw new Error('Page errors: ' + pageErrors.join('; '));
  console.log('CRM sync OK');
} finally {
  await browser.close();
  server.close();
}
