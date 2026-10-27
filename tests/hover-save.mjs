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

  await page.evaluate(() => switchView('tasks'));
  const add = () => page.locator('.column[data-status="Очередь"] [data-add]').first().click();

  // New task dialog: Esc cancels, outside click with a title creates, outside click when empty just closes.
  await add();
  await page.locator('#newTitle').fill('Отменённая задача');
  await page.keyboard.press('Escape');
  if (await page.locator('#modal').evaluate((m) => m.classList.contains('show'))) throw new Error('Esc should close the new task dialog');
  if (await page.locator('.task', { hasText: 'Отменённая задача' }).count()) throw new Error('Esc must not create the task');
  await add();
  await page.locator('#newTitle').fill('Задача по клику мимо');
  await page.locator('#newEnd').fill('31.12.2026');
  await page.mouse.click(5, 5);
  await page.locator('.task', { hasText: 'Задача по клику мимо' }).waitFor({ timeout: 6000 });
  await add();
  await page.mouse.click(5, 5);
  if (await page.locator('#modal').evaluate((m) => m.classList.contains('show'))) throw new Error('Outside click on an empty dialog should close it');
  // Selecting text from inside to outside must not create anything.
  await add();
  await page.locator('#newTitle').fill('Не создавать');
  const box = await page.locator('#newTitle').boundingBox();
  await page.mouse.move(box.x + 5, box.y + 5); await page.mouse.down(); await page.mouse.move(3, 3); await page.mouse.up();
  if (await page.locator('.task', { hasText: 'Не создавать' }).count()) throw new Error('Drag from inside the dialog must not create');
  await page.keyboard.press('Escape');

  // Hover card shows description, due date and owner.
  await page.evaluate(() => { const t = active().tasks.find((x) => x.title === 'Задача по клику мимо'); t.description = 'Подробное описание задачи'; t.owner = 'Яковлев В.'; save(); renderBoard(); });
  await page.mouse.move(600, 700);
  await page.locator('.task', { hasText: 'Задача по клику мимо' }).hover({ position: { x: 20, y: 12 } });
  await page.locator('#taskPeek:not([hidden])').waitFor({ timeout: 6000 });
  const peek = await page.locator('#taskPeek').textContent();
  for (const part of ['Подробное описание задачи', 'Яковлев В.', '31.12.2026']) if (!peek.includes(part)) throw new Error(`Hover card misses ${part}: ${peek}`);
  await page.mouse.move(2, 400);
  await page.locator('#taskPeek').waitFor({ state: 'hidden', timeout: 5000 });
  // My tasks rows have the card too.
  await page.evaluate(() => switchView('mytasks'));
  const row = page.locator('#myTasksView .mytask-row', { hasText: 'Задача по клику мимо' });
  if (await row.count()) {
    await row.locator('.mytask-title').hover();
    await page.locator('#taskPeek:not([hidden])').waitFor({ timeout: 6000 });
    await page.mouse.move(2, 400);
  }
  await page.evaluate(() => switchView('tasks'));

  // Column rename: Esc cancels, outside click saves.
  const renameBtn = () => page.locator('[data-rename-status="Очередь"]').first();
  const before = (await renameBtn().textContent()).trim();
  await renameBtn().click();
  await page.waitForFunction(() => ['TEXTAREA', 'INPUT'].includes(document.activeElement?.tagName));
  await page.keyboard.press('Control+A'); await page.keyboard.type('Бэклог');
  await page.keyboard.press('Escape');
  if ((await renameBtn().textContent()).trim() !== before) throw new Error('Esc should cancel the column rename');
  await renameBtn().click();
  await page.waitForFunction(() => ['TEXTAREA', 'INPUT'].includes(document.activeElement?.tagName));
  await page.keyboard.press('Control+A'); await page.keyboard.type('Бэклог');
  await page.waitForTimeout(150);
  await page.mouse.click(600, 700);
  await page.waitForFunction(() => document.querySelector('[data-rename-status="Очередь"]')?.textContent.includes('Бэклог'), null, { timeout: 3000 });

  // Project dialog: outside click with a name creates the project.
  await page.evaluate(() => createProject());
  await page.locator('#projectNameInput').fill('Проект по клику мимо');
  await page.mouse.click(5, 5);
  await page.waitForFunction(() => data.some((p) => p.name === 'Проект по клику мимо'), null, { timeout: 3000 });

  if (pageErrors.length) throw new Error(`Browser page errors: ${pageErrors.join('; ')}`);
  console.log('Hover + save outside OK: new task Esc/outside/drag, hover card, column rename, project dialog');
} finally {
  await browser.close();
  server.close();
}
