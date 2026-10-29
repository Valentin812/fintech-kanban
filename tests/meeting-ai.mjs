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
    if (url.pathname === '/functions/v1/assistant') {
      const body = JSON.parse(request.postData() || '{}');
      globalThis.__asked = body;
      const text = body.messages[body.messages.length - 1].content;
      const id = (text.match(/встречу (m[0-9a-z]+)/) || [])[1];
      const reply = { reply: 'Разобрал встречу.', actions: [
        { type: 'set_meeting', id, fields: { summary: 'Решили запустить в декабре', projects: [globalThis.__proj] } },
        { type: 'meeting_tasks', meeting_id: id, tasks: [{ title: 'Подготовить договор', project: globalThis.__proj }, { title: 'Созвониться с банком', project: '' }] },
        { type: 'create_meeting', title: 'Follow-up', date: '2026-11-05', time: '11:00', prep: 'Свериться по срокам', projects: [globalThis.__proj] },
      ] };
      await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(reply) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  await page.goto(`http://127.0.0.1:${port}/`);
  await page.locator('#authEmail').fill('smoke@example.test');
  await page.locator('#authPassword').fill('mock-password');
  await page.locator('#authSubmit').click();
  await page.locator('.app').waitFor({ state: 'visible' });
  globalThis.__proj = await page.evaluate(() => data[0].name);
  await page.locator('#meetingsNav').click();
  await page.locator('[data-mt-new]').click();
  await page.locator('[data-mt-f="title"]').fill('Созвон с банком');
  await page.locator('[data-mt-f="summary"]').fill('Обсудили запуск');
  await page.locator('[data-mt-ai]').click();
  await page.locator('#aiPanel.show').waitFor();
  await page.locator('.ai-actions').waitFor();
  const asked = globalThis.__asked.messages.at(-1).content;
  if (!asked.includes('Созвон с банком') || !asked.includes('Обсудили запуск')) throw new Error('Meeting text must be sent to the assistant');
  const txt = await page.locator('.ai-actions').textContent();
  if (!txt.includes('Подготовить договор') || !txt.includes('Follow-up')) throw new Error('Actions should be described: ' + txt);
  if ((await page.locator('.ai-actions .ai-sub li').count()) < 2 || /;\s/.test(txt)) throw new Error('Meeting tasks must be separate lines, not one run-on line: ' + txt);
  if ((await page.evaluate(() => window.__meetings.list().length)) !== 1) throw new Error('Nothing changes before confirmation');
  await page.locator('[data-ai-apply]').click();
  const res = await page.evaluate(() => { const l = window.__meetings.list(); const m = l.find((x) => x.title === 'Созвон с банком'); return { n: l.length, summary: m.summary, tasks: m.tasks.map((t) => [t.title, t.project]), projects: m.projects, fu: l.find((x) => x.title === 'Follow-up') }; });
  if (res.n !== 2 || res.summary !== 'Решили запустить в декабре' || res.tasks.length !== 2 || res.projects.length !== 1) throw new Error('Applied wrong: ' + JSON.stringify(res));
  if (res.tasks[1][1] !== globalThis.__proj) throw new Error('A task without a project takes the first project of the meeting');
  if (!res.fu || res.fu.date !== '2026-11-05' || res.fu.status !== 'planned') throw new Error('Follow-up meeting expected');
  if (pageErrors.length) throw new Error('Page errors: ' + pageErrors.join('; '));
  console.log('Meeting AI OK');
} finally {
  await browser.close();
  server.close();
}
