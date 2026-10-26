import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');


const REL = []; let relN = 0; const STORE = new Set();
const FIXTURES = process.env.RELEASE_FIXTURES || 'tests/fixtures';
async function relRoute(route) {
  const request = route.request();
  const url = new URL(request.url());
  const json = (status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) }).then(() => true);
  const objKey = () => decodeURIComponent(url.pathname.split('/project-releases/')[1]);
  if (url.pathname.startsWith('/storage/v1/object/sign/project-releases/')) return json(200, { signedURL: '/object/sign/project-releases/x?token=t' });
  if (url.pathname.startsWith('/storage/v1/object/project-releases/') && request.method() === 'POST') { STORE.add(objKey()); return json(200, { Key: 'ok' }); }
  if (url.pathname.startsWith('/storage/v1/object/project-releases/') && request.method() === 'DELETE') { STORE.delete(objKey()); return json(200, {}); }
  if (url.pathname === '/rest/v1/project_releases') {
    const m = request.method();
    if (m === 'GET') {
      const search = url.searchParams.get('search');
      let rows = REL.slice();
      if (search) { const q = search.replace(/^wfts\(russian\)\./, '').toLowerCase(); rows = rows.filter((r) => r.content.toLowerCase().includes(q)); }
      return json(200, rows.map(({ content, ...r }) => (url.searchParams.get('select') === 'id' ? { id: r.id } : r)));
    }
    if (m === 'POST') {
      const row = { id: 'rel-' + (++relN), owner_id: 'u1', created_at: new Date().toISOString(), file_path: null, file_name: null, file_type: null, file_size: null, ...request.postDataJSON() };
      REL.push(row); const { content, ...rest } = row; return json(201, [rest]);
    }
    const id = (url.searchParams.get('id') || '').replace('eq.', '');
    if (m === 'PATCH') { const row = REL.find((r) => r.id === id); Object.assign(row, request.postDataJSON()); const { content, ...rest } = row; return json(200, [rest]); }
    if (m === 'DELETE') { const i = REL.findIndex((r) => r.id === id); const gone = i >= 0 ? REL.splice(i, 1) : []; return json(200, gone.map((r) => ({ id: r.id }))); }
  }
  return false;
}

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
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.route('https://vdlfdnhfiiltdyrucdtn.supabase.co/**', async (route) => {
    if (await relRoute(route)) return;
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
      await route.fulfill({ status: 201, body: '' });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  await page.goto(`http://127.0.0.1:${port}/`);
  await page.locator('#authEmail').fill('smoke@example.test');
  await page.locator('#authPassword').fill('mock-password');
  await page.locator('#authSubmit').click();
  await page.locator('.app').waitFor({ state: 'visible' });

  await page.locator('#teamTopButton').click();
  await page.locator('#memberName').fill('Тест');
  await page.locator('#memberEmail').fill('t@example.test');
  await page.keyboard.press('Escape');
  await page.evaluate(() => switchView('releases'));
  await page.locator('#releasesView').waitFor({ state: 'visible' });
  await page.locator('#releasesView', { hasText: 'Релизов пока нет' }).waitFor({ timeout: 4000 }).catch(async () => { throw new Error('Empty state missing: ' + (await page.locator('#releasesView').textContent())); });

  // Upload a pptx -> card auto-filled.
  await page.locator('[data-rl-new]').click();
  await page.locator('#rlFile').setInputFiles(`${FIXTURES}/release.pptx`);
  await page.locator('[data-rl-analyze]').click();
  await page.locator('#rlNTitle').waitFor();
  const f = await page.evaluate(() => ({ t: rlNTitle.value, d: rlNDate.value, v: rlNVersion.value, s: rlNSummary.value, c: rlNChanges.value }));
  if (!f.t.includes('Релиз 2.4.1')) throw new Error('Title not extracted: ' + JSON.stringify(f));
  if (f.d !== '2026-10-15') throw new Error('Date not extracted: ' + f.d);
  if (f.v !== '2.4.1') throw new Error('Version not extracted: ' + f.v);
  if (!f.s.includes('СБП')) throw new Error('Summary missing: ' + f.s);
  if (!f.c.includes('Добавлена оплата через СБП') || !f.c.includes('Исправлены ошибки')) throw new Error('Changes missing (slide order?): ' + f.c);
  await page.locator('[data-rl-save]').click();
  await page.locator('.rl-card').first().waitFor();
  if (STORE.size !== 1 || ![...STORE][0].startsWith('00000000-0000-4000-8000-000000000001/')) throw new Error('File was not uploaded to the user folder: ' + [...STORE]);
  if (/[^\x00-\x7f]/.test([...STORE][0])) throw new Error('Storage key must be ASCII');

  // docx via pasted text too.
  await page.locator('[data-rl-new]').click();
  await page.locator('#rlFile').setInputFiles(`${FIXTURES}/notes.docx`);
  await page.locator('[data-rl-analyze]').click();
  await page.locator('#rlNTitle').waitFor();
  if (await page.locator('#rlNDate').inputValue() !== '2026-10-03') throw new Error('docx date wrong');
  await page.locator('#rlNTags').fill('телефония, апи');
  await page.locator('[data-rl-save]').click();
  await page.waitForFunction(() => document.querySelectorAll('.rl-card').length === 2);

  // Search: text, date, month name, server-side content match.
  const count = () => page.locator('.rl-card').count();
  await page.locator('#rlSearch').fill('октябрь 2026');
  if (await count() !== 2) throw new Error('Month search failed');
  await page.locator('#rlSearch').fill('15.10.2026');
  if (await count() !== 1) throw new Error('Exact date search failed');
  await page.locator('#rlSearch').fill('сентябрь');
  if (await count() !== 0) throw new Error('Wrong month should find nothing');
  await page.locator('#rlSearch').fill('телефонии');
  if (await count() !== 1) throw new Error('Text search failed');
  await page.locator('#rlSearch').fill('ускорили');
  await page.waitForFunction(() => document.querySelectorAll('.rl-card').length === 1, null, { timeout: 4000 });
  await page.locator('#rlSearch').fill('');
  // Open, edit, delete.
  await page.locator('[data-rl-open]').first().click();
  await page.locator('[data-rl-edit]').first().click();
  await page.locator('#rlETitle').fill('Автооплата СБП (правка)');
  await page.locator('[data-rl-saveedit]').click();
  await page.locator('.rl-card h4', { hasText: 'правка' }).waitFor();
  await page.locator('[data-rl-askdel]').first().click();
  await page.locator('[data-rl-delete]').first().click();
  await page.waitForFunction(() => document.querySelectorAll('.rl-card').length === 1);
  if (STORE.size !== 1) throw new Error('File was not removed from storage on delete');
  // XSS: titles are escaped.
  await page.locator('[data-rl-new]').click();
  await page.locator('#rlPaste').fill('<img src=x onerror=window.__xss=1>');
  await page.locator('[data-rl-analyze]').click();
  await page.locator('[data-rl-save]').click();
  await page.waitForFunction(() => document.querySelectorAll('.rl-card').length === 2);
  if (await page.evaluate(() => window.__xss)) throw new Error('XSS in release card');
  if (process.env.SHOT) { await page.setViewportSize({ width: 1100, height: 760 }); await page.screenshot({ path: process.env.SHOT }); }
  // Mobile: no horizontal overflow.
  await page.setViewportSize({ width: 390, height: 800 });
  const wide = await page.evaluate(() => document.getElementById('releasesView').scrollWidth > document.getElementById('releasesView').clientWidth + 1);
  if (wide) throw new Error('Releases view overflows on phone');
  if (pageErrors.length) throw new Error(`Browser page errors: ${pageErrors.join('; ')}`);
  console.log('Releases tab OK: pptx/docx parsing, auto card, upload, date + text search, edit, delete, escaping, mobile');
} finally {
  await browser.close();
  server.close();
}
