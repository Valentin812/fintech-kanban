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

  await page.locator('#teamTopButton').click();
  await page.locator('#memberName').fill('Яковлев Виктор');
  await page.locator('#memberEmail').fill('yakovlev@example.test');
  await page.locator('#memberForm button[type="submit"]').click();
  await page.evaluate(() => switchView('tasks'));

  // 1. Owner suggestions in the "new task" dialog.
  await page.locator('.column[data-status="Очередь"] [data-add]').first().click();
  await page.locator('#newTitle').fill('Настроить АПИ телефонии');
  await page.locator('#newOwner').fill('Яковл');
  await page.getByRole('button', { name: /Яковлев Виктор/ }).waitFor({ timeout: 3000 });
  await page.getByRole('button', { name: /Яковлев Виктор/ }).first().click();
  if (await page.locator('#newOwner').inputValue() !== 'Яковлев Виктор') throw new Error('New-task owner suggestion did not fill the field');
  await page.locator('#createTask').click();

  // 2. Title is editable in the drawer.
  await page.locator('.task').filter({ hasText: 'Настроить АПИ телефонии' }).click();
  await page.locator('#dTitle').click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('Передать данные по АПИ Данилу');
  await page.keyboard.press('Enter');
  await page.locator('.task').filter({ hasText: 'Передать данные по АПИ Данилу' }).first().waitFor({ timeout: 3000 });
  if (await page.locator('.task').filter({ hasText: 'Настроить АПИ телефонии' }).count()) throw new Error('Old title still on the board');
  // Emptying the title restores the old one.
  await page.locator('#dTitle').click();
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Delete');
  await page.locator('#dDescription').click();
  if ((await page.locator('#dTitle').textContent()).trim() !== 'Передать данные по АПИ Данилу') throw new Error('Empty title was not restored');

  // 3. Drawer never scrolls sideways.
  for (const vp of [{ width: 1280, height: 800 }, { width: 390, height: 800 }]) {
    await page.setViewportSize(vp);
    const over = await page.evaluate(() => { const d = document.getElementById('drawer'); const bad = [...d.querySelectorAll('.draweractions .btn')].filter((b) => { const r = b.getBoundingClientRect(); return r.right > d.getBoundingClientRect().right + 1 && getComputedStyle(b).display !== 'none'; }).length; return { sw: d.scrollWidth, cw: d.clientWidth, bad }; });
    if (over.sw > over.cw + 1 || over.bad) throw new Error(`Drawer overflows at ${vp.width}px: ${JSON.stringify(over)}`);
  }
  if (pageErrors.length) throw new Error(`Browser page errors: ${pageErrors.join('; ')}`);
  console.log('Drawer fixes passed');
} finally {
  await browser.close();
  server.close();
}
