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
    if (url.pathname === '/rest/v1/kanban_profiles' && request.method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
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
  await page.locator('#memberName').fill('Анна Смирнова');
  await page.locator('#memberEmail').fill('anna@example.test');
  await page.locator('#memberForm button[type="submit"]').click();
  await page.locator('[data-view="tasks"]').click();
  await page.locator('.task').first().click();
  const owner = page.locator('#dOwner');

  await owner.fill('Анна');
  await page.getByRole('button', { name: /Анна Смирнова/ }).waitFor();
  await page.getByRole('button', { name: /Анна Смирнова/ }).first().click();
  if (await owner.inputValue() !== 'Анна Смирнова') {
    throw new Error('Plain-text selection did not insert the participant name');
  }

  await owner.fill('Уже назначен, Анна');
  await page.getByRole('button', { name: /Анна Смирнова/ }).waitFor();
  await page.getByRole('button', { name: /Анна Смирнова/ }).first().click();
  if (await owner.inputValue() !== 'Уже назначен, Анна Смирнова') {
    throw new Error('Autocomplete did not preserve the previous assignee');
  }

  await owner.fill('@Анна');
  await page.getByRole('button', { name: /@Анна Смирнова/ }).waitFor();
  await page.getByRole('button', { name: /@Анна Смирнова/ }).first().click();
  if (await owner.inputValue() !== '@Анна Смирнова') {
    throw new Error('The existing @ selection behavior changed');
  }
  if (pageErrors.length) {
    throw new Error(`Browser page errors: ${pageErrors.join('; ')}`);
  }

  console.log('Owner autocomplete OK: plain search, multiple assignees, and @ selection');
} finally {
  await browser.close();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
