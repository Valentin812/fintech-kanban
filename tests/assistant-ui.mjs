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
      const last = body.messages[body.messages.length - 1].content;
      const reply = last.includes('ошибка')
        ? null
        : { reply: 'Предлагаю создать задачу и заметку.', actions: [{ type: 'create_task', project: '', title: 'Позвонить Азату', description: '', owner: '', end: '30.10.2026' }, { type: 'add_note', text: 'Купить воды' }] };
      if (!reply) { await route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: 'Ассистент временно недоступен.' }) }); return; }
      await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(reply) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  await page.goto(`http://127.0.0.1:${port}/`);
  if (await page.locator('#aiTopButton').isVisible()) throw new Error('Assistant button must be hidden before login');
  await page.locator('#authEmail').fill('smoke@example.test');
  await page.locator('#authPassword').fill('mock-password');
  await page.locator('#authSubmit').click();
  await page.locator('.app').waitFor({ state: 'visible' });
  await page.locator('#aiTopButton').waitFor({ state: 'visible', timeout: 5000 });
  await page.locator('#aiTopButton').click();
  await page.locator('#aiPanel.show').waitFor();
  await page.locator('#aiInput').fill('Создай задачу позвонить Азату');
  await page.locator('#aiInput').press('Enter');
  await page.locator('.ai-actions').waitFor();
  if (!(await page.locator('.ai-actions').textContent()).includes('Позвонить Азату')) throw new Error('Action list should describe the task');
  const sent = globalThis.__asked;
  if (!sent || !Array.isArray(sent.messages)) throw new Error('Request body missing');
  if (JSON.stringify(sent).includes('mock-access-token')) throw new Error('Token must not be in the body');
  // Nothing changes until «Применить».
  if (await page.evaluate(() => standaloneTasks.some((t) => t.title === 'Позвонить Азату'))) throw new Error('Task must not exist before confirmation');
  await page.locator('[data-ai-apply]').click();
  const done = await page.evaluate(() => ({ task: standaloneTasks.find((t) => t.title === 'Позвонить Азату'), note: quickNotes.some((n) => n.text === 'Купить воды') }));
  if (!done.task || done.task.end !== '30.10.2026' || !done.note) throw new Error('Applied actions missing: ' + JSON.stringify(done));
  if (await page.locator('.ai-actions').count()) throw new Error('Action box should close after applying');
  // «Не нужно» changes nothing.
  await page.locator('#aiInput').fill('ещё');
  await page.locator('#aiInput').press('Enter');
  await page.locator('[data-ai-skip]').waitFor();
  await page.locator('[data-ai-skip]').click();
  if ((await page.evaluate(() => standaloneTasks.filter((t) => t.title === 'Позвонить Азату').length)) !== 1) throw new Error('Skip must not create anything');
  // Server error is shown politely.
  await page.locator('#aiInput').fill('вызови ошибка');
  await page.locator('#aiInput').press('Enter');
  await page.locator('.ai-msg', { hasText: 'временно недоступен' }).waitFor();
  // Phone: panel fits the screen.
  await page.setViewportSize({ width: 390, height: 800 });
  const fits = await page.evaluate(() => { const r = document.getElementById('aiPanel').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight; });
  if (!fits) throw new Error('Assistant panel must fit on a phone');
  if (pageErrors.length) throw new Error('Page errors: ' + pageErrors.join('; '));
  console.log('Assistant UI OK');
} finally {
  await browser.close();
  server.close();
}
