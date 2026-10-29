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
  await page.locator('#meetingsNav').click();
  const view = page.locator('#meetingsView');
  await view.waitFor({ state: 'visible' });
  if (!(await view.locator('.mt-empty').count())) throw new Error('Empty state expected');
  // New meeting, link to a project, write preparation and summary.
  await view.locator('[data-mt-new]').click();
  await view.locator('[data-mt-f="title"]').fill('Планёрка по автооплате');
  const projectName = await page.evaluate(() => data[0].name);
  await view.locator('select[data-mt-padd]').selectOption(projectName);
  await view.locator(`[data-mt-premove="${projectName}"]`).waitFor();
  await view.locator('[data-mt-f="prep"]').fill('Обсудить сроки\nПодготовить цифры');
  await view.locator('[data-mt-f="summary"]').fill('Договорились о запуске в декабре');
  await view.locator('[data-mt-f="status"]').selectOption('done');
  // The meeting keeps what was typed after a re-render.
  const kept = await page.evaluate(() => { const m = window.__meetings.list()[0]; return [m.title, m.prep, m.summary, m.status, m.projects.length]; });
  if (kept[0] !== 'Планёрка по автооплате' || !kept[1].includes('\n') || kept[3] !== 'done' || kept[4] !== 1) throw new Error('Meeting fields not saved: ' + JSON.stringify(kept));
  // A task can be added by hand and goes to the linked project.
  await view.locator('#mtNewTask').fill('Отправить презентацию');
  await view.locator('#mtNewTask').press('Enter');
  await view.locator('.mt-tasks li', { hasText: 'Отправить презентацию' }).locator('[data-mt-tadd]').click();
  const added = await page.evaluate((name) => data.find((p) => p.name === name).tasks.some((t) => t.title === 'Отправить презентацию' && t.source === 'meeting'), projectName);
  if (!added) throw new Error('Task should land in the linked project');
  if (!(await view.locator('.mt-added').count())) throw new Error('Added mark expected');
  // Import files: summary, transcript, task list.
  await view.locator('#mtFiles').setInputFiles([
    { name: 'итоги-встречи.md', mimeType: 'text/markdown', buffer: Buffer.from('# Созвон с банком\nОбсудили тарифы.') },
    { name: 'расшифровка.txt', mimeType: 'text/plain', buffer: Buffer.from('Иван: привет\nПётр: здравствуйте') },
    { name: 'задачи.txt', mimeType: 'text/plain', buffer: Buffer.from('- [ ] Позвонить в банк\n2. Сравнить тарифы\nпросто строка\n* Отправить договор') },
  ]);
  await view.locator('.mt-card.open .mt-tasks li').nth(2).waitFor();
  const imp = await page.evaluate(() => { const m = window.__meetings.list()[0]; return [m.title, m.summary, m.transcript.includes('Пётр'), m.tasks.map((t) => t.title)]; });
  if (imp[0] !== 'Созвон с банком' || !imp[1].includes('тарифы') || !imp[2] || imp[3].join('|') !== 'Позвонить в банк|Сравнить тарифы|Отправить договор') throw new Error('Import parsed wrong: ' + JSON.stringify(imp));
  // JSON import (generic format).
  await view.locator('#mtFiles').setInputFiles({ name: 'meeting.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ title: 'JSON встреча', date: '2026-10-20', summary: 'Итог', tasks: [{ title: 'Задача А' }, 'Задача Б'] })) });
  await view.locator('.mt-card.open .mt-tasks li').nth(1).waitFor();
  // Distribute all to a project at once.
  for (const sel of await view.locator('.mt-card.open .mt-tasks select').all()) await sel.selectOption(projectName);
  await view.locator('[data-mt-tall]').click();
  const n = await page.evaluate((name) => data.find((p) => p.name === name).tasks.filter((t) => t.source === 'meeting').length, projectName);
  if (n < 3) throw new Error('All tasks should be added: ' + n);
  // Kept in the cloud state.
  await page.evaluate(() => cloudWriteNow());
  await page.waitForTimeout(300);
  const st = globalThis.__lastState;
  const meta = (Array.isArray(st) ? st[0] : st)?.state?.projectMeta;
  if (!meta || !(meta.__meetings__?.list || []).some((m) => m.title === 'Планёрка по автооплате')) throw new Error('Meetings must be saved in the cloud state');
  // Project side: the meeting is visible in the project card and opens the meeting.
  await page.evaluate((name) => { activeProject = name; switchView('tasks'); }, projectName);
  await page.locator('#keyNotes').waitFor({ state: 'visible' });
  await page.locator('#keyNotes .kn-head').click();
  await page.locator('#keyNotes [data-kn-meeting]').first().waitFor();
  await page.locator('#keyNotes [data-kn-meeting]').first().click();
  await view.waitFor({ state: 'visible' });
  // Search and filter.
  await view.locator('#mtSearch').fill('несуществующее');
  await view.locator('.mt-empty').waitFor();
  await view.locator('#mtSearch').fill('');
  await view.locator('#mtFilter').selectOption('plan');
  // Delete with undo.
  await view.locator('#mtFilter').selectOption('all');
  await view.locator('.mt-card').first().locator('.mt-head').click();
  await view.locator('[data-mt-del]').click();
  await page.locator('#undoToast button').click();
  await page.setViewportSize({ width: 390, height: 800 });
  await page.evaluate(() => switchView('meetings'));
  const fits = await page.evaluate(() => document.getElementById('meetingsView').scrollWidth <= document.getElementById('meetingsView').clientWidth + 1);
  if (!fits) throw new Error('Meetings view overflows on a phone');
  if (pageErrors.length) throw new Error('Page errors: ' + pageErrors.join('; '));
  console.log('Meetings OK');
} finally {
  await browser.close();
  server.close();
}
