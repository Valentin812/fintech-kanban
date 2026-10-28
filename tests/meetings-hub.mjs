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
    if (url.pathname === '/rest/v1/meetings' && request.method() === 'GET') {
      globalThis.__meetReqs = (globalThis.__meetReqs || []).concat(url.search);
      if (url.searchParams.get('select') === 'transcript') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ transcript: '[00:00:03] Вы: Привет\n[00:00:11] Собеседники: Здравствуйте' }]) });
        return;
      }
      const all = [
        { id: '11111111-1111-4111-8111-111111111111', title: 'Созвон с банком', held_at: '2026-10-27T09:30:00Z', duration_sec: 2700, meeting_app: 'Zoom', description: 'Тарифы', summary: ['Обсудили тарифы', 'Договорились о запуске'], decisions: [{ text: 'Запуск в декабре', evidence: 'давайте в декабре' }], tasks: [{ task: 'Подготовить договор', owner: 'Иван', deadline: '2026-11-05', evidence: 'я подготовлю', confidence: 'high' }, { task: 'Уточнить лимиты', owner: '', deadline: '', evidence: '', confidence: 'low' }], open_questions: [{ question: 'Кто согласует?', evidence: '' }], project_name: '' },
        { id: '22222222-2222-4222-8222-222222222222', title: 'Планёрка', held_at: '2026-10-20T07:00:00Z', duration_sec: 600, meeting_app: 'Teams', description: '', summary: [], decisions: [], tasks: [], open_questions: [], project_name: 'Автооплата ГП' },
      ];
      const q = url.searchParams.get('search') || '';
      const rows = q.includes('банк') ? all.slice(0, 1) : all;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows) });
      return;
    }
    if (url.pathname === '/rest/v1/meetings' && request.method() === 'PATCH') {
      globalThis.__patch = { q: url.search, body: JSON.parse(request.postData() || '{}') };
      await route.fulfill({ status: 204, body: '' });
      return;
    }
    if (url.pathname === '/rest/v1/meetings' && request.method() === 'DELETE') {
      globalThis.__del = url.search;
      await route.fulfill({ status: 204, body: '' });
      return;
    }
    if (url.pathname === '/rest/v1/meeting_tokens' && request.method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: 'tok-1', label: 'Рабочий ноутбук', created_at: '2026-10-20T10:00:00Z', last_used_at: null }]) });
      return;
    }
    if (url.pathname === '/rest/v1/meeting_tokens' && request.method() === 'DELETE') {
      globalThis.__revoked = url.search;
      await route.fulfill({ status: 204, body: '' });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.route('https://vdlfdnhfiiltdyrucdtn.supabase.co/storage/v1/object/sign/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ signedURL: '/object/sign/x?token=t' }) });
  });

  await page.goto(`http://127.0.0.1:${port}/`);
  await page.locator('#authEmail').fill('smoke@example.test');
  await page.locator('#authPassword').fill('mock-password');
  await page.locator('#authSubmit').click();
  await page.locator('.app').waitFor({ state: 'visible' });
  const proj = await page.evaluate(() => data[0].name);
  await page.locator('#meetingsNav').click();
  const view = page.locator('#meetingsView');
  await view.locator('.mt-card.hub').first().waitFor();
  if (await view.locator('.mt-card.hub').count() !== 2) throw new Error('Two Meeting Hub meetings expected');
  const first = view.locator('.mt-card.hub', { hasText: 'Созвон с банком' });
  const headText = await first.locator('.mt-head').textContent();
  if (!headText.includes('45 мин') || !headText.includes('задач: 2') || !headText.includes('Meeting Hub')) throw new Error('List row: date, duration and task count expected: ' + headText);
  // Server-side full text search.
  await view.locator('#mtSearch').fill('банк');
  await page.waitForTimeout(700);
  if (!(globalThis.__meetReqs || []).some((u) => u.includes('search=wfts(russian).') )) throw new Error('Search must use wfts(russian): ' + JSON.stringify(globalThis.__meetReqs));
  if (await view.locator('.mt-card.hub').count() !== 1) throw new Error('Search should narrow the list');
  await view.locator('#mtSearch').fill('');
  await page.waitForTimeout(700);
  await view.locator('.mt-card.hub', { hasText: 'Планёрка' }).waitFor();
  // Open the card: sections, lazy transcript.
  await view.locator('.mt-card.hub', { hasText: 'Созвон с банком' }).locator('.mt-head').click();
  const card = view.locator('.mt-card.hub.open');
  for (const t of ['Обсудили тарифы', 'Запуск в декабре', 'Подготовить договор', 'Кто согласует?']) if (!(await card.textContent()).includes(t)) throw new Error('Card must show: ' + t);
  await card.locator('details summary').click();
  await card.locator('.mt-tr', { hasText: 'Здравствуйте' }).waitFor();
  // «Разобрать с ИИ»: the assistant gets the Hub meeting content (summary, decisions, tasks).
  await page.evaluate(() => { window.__ai = { ask: (txt) => { window.__askedText = txt; } }; });
  await card.locator('[data-mt-hai]').click();
  const asked = await page.evaluate(() => window.__askedText || '');
  if (!asked.includes('Подготовить договор') || !asked.includes('Запуск в декабре') || !asked.includes('Обсудили тарифы')) throw new Error('AI text must carry the Hub meeting: ' + asked.slice(0, 300));
  // «На доску»: project, owner, deadline, evidence and a link to the meeting.
  await card.locator('li', { hasText: 'Подготовить договор' }).locator('select').selectOption(proj);
  await card.locator('li', { hasText: 'Подготовить договор' }).locator('[data-mt-hadd]').click();
  const task = await page.evaluate((name) => data.find((p) => p.name === name).tasks.find((t) => t.title === 'Подготовить договор'), proj);
  if (!task || task.owner !== 'Иван' || task.end !== '05.11.2026' || !task.description.includes('я подготовлю') || !task.description.includes('Созвон с банком') || !task.link.includes('#meeting=11111111-1111-4111-8111-111111111111')) throw new Error('Task fields wrong: ' + JSON.stringify(task));
  if (!(await card.locator('.mt-added').count())) throw new Error('Added mark expected');
  // Not added twice.
  await card.locator('[data-mt-hall]').click();
  const cnt = await page.evaluate((name) => data.find((p) => p.name === name).tasks.filter((t) => t.title === 'Подготовить договор').length, proj);
  if (cnt !== 1) throw new Error('Task must not be duplicated: ' + cnt);
  // Link to a project: PATCH project_name; shown in the project card.
  await card.locator('[data-mt-hproj]').selectOption(proj);
  await page.waitForTimeout(300);
  if (!globalThis.__patch || globalThis.__patch.body.project_name !== proj || !globalThis.__patch.q.includes('id=eq.11111111')) throw new Error('PATCH expected: ' + JSON.stringify(globalThis.__patch));
  await page.evaluate((name) => { activeProject = name; switchView('tasks'); }, proj);
  await page.locator('#keyNotes .kn-head').click();
  await page.locator('#keyNotes [data-kn-meeting]', { hasText: 'Созвон с банком' }).waitFor();
  // Saved to the cloud state: which tasks were already put on the board.
  await page.evaluate(() => cloudWriteNow());
  await page.waitForTimeout(300);
  const st = globalThis.__lastState;
  const meta = (Array.isArray(st) ? st[0] : st)?.state?.projectMeta;
  if (!meta?.__meetings__?.hubAdded?.['11111111-1111-4111-8111-111111111111']?.includes('Подготовить договор')) throw new Error('hubAdded must be saved');
  // Tokens: list and revoke.
  await page.evaluate(() => switchView('meetings'));
  await view.locator('.mt-tokens', { hasText: 'Рабочий ноутбук' }).waitFor();
  await view.locator('[data-mt-revoke]').click();
  await page.waitForTimeout(300);
  if (!String(globalThis.__revoked || '').includes('id=eq.tok-1')) throw new Error('DELETE of the token expected: ' + globalThis.__revoked);
  if (await view.locator('[data-mt-revoke]').count()) throw new Error('Revoked token must disappear');
  // Delete a Hub meeting.
  await view.locator('.mt-card.hub', { hasText: 'Планёрка' }).locator('.mt-head').click();
  await view.locator('[data-mt-hdel]').click();
  await page.waitForTimeout(300);
  if (!String(globalThis.__del || '').includes('id=eq.22222222')) throw new Error('DELETE of the meeting expected');
  // Phone.
  await page.setViewportSize({ width: 390, height: 800 });
  const fits = await page.evaluate(() => document.getElementById('meetingsView').scrollWidth <= document.getElementById('meetingsView').clientWidth + 1);
  if (!fits) throw new Error('Meetings view overflows on a phone');
  if (pageErrors.length) throw new Error('Page errors: ' + pageErrors.join('; '));
  console.log('Meetings Hub OK');
} finally {
  await browser.close();
  server.close();
}
