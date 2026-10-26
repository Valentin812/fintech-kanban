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
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  await page.goto(`http://127.0.0.1:${port}/`);
  await page.locator('#authEmail').fill('smoke@example.test');
  await page.locator('#authPassword').fill('mock-password');
  await page.locator('#authSubmit').click();
  await page.locator('.app').waitFor({ state: 'visible' });

  await page.evaluate(() => switchView('mytasks'));
  const panel = page.locator('#myTasksView .qn-panel');
  await panel.waitFor();
  const input = panel.locator('.qn-input');
  await input.fill('Перезвонить Азату');
  await input.press('Enter');
  await input.fill('Отправить счёт');
  await input.press('Enter');
  if (await panel.locator('.qn-item').count() !== 2) throw new Error('Two notes expected');
  if (!(await page.evaluate(() => document.activeElement?.classList.contains('qn-input')))) throw new Error('Focus should stay in the input for the next note');
  // Edit: Esc cancels, Enter saves, outside click saves.
  await panel.locator('.qn-text', { hasText: 'Отправить счёт' }).click();
  await page.locator('.qn-edit').fill('Отправить счёт (отменить)');
  await page.keyboard.press('Escape');
  if (!(await panel.locator('.qn-text', { hasText: /^Отправить счёт$/ }).count())) throw new Error('Esc should cancel the edit');
  await panel.locator('.qn-text', { hasText: 'Отправить счёт' }).click();
  await page.locator('.qn-edit').fill('Отправить счёт в банк');
  await page.mouse.click(5, 700);
  await panel.locator('.qn-text', { hasText: 'Отправить счёт в банк' }).waitFor();
  // Done: struck through and listed last; clearing works with undo.
  await panel.locator('.qn-item', { hasText: 'Перезвонить' }).locator('input[type=checkbox]').check();
  await panel.locator('.qn-item.qn-done', { hasText: 'Перезвонить' }).waitFor();
  if (!(await panel.locator('.qn-item').last().textContent()).includes('Перезвонить')) throw new Error('Done notes go to the end');
  // Old done notes disappear after a day.
  await page.evaluate(() => { quickNotes.find((n) => n.done).doneAt = Date.now() - 25 * 3600 * 1000; renderQuickNotes(); });
  if (await panel.locator('.qn-item').count() !== 1) throw new Error('Done notes older than a day should be pruned');
  // Note -> standalone task.
  await panel.locator('[data-qn-task]').first().click();
  if (!(await page.evaluate(() => standaloneTasks.some((t) => t.title === 'Отправить счёт в банк')))) throw new Error('Note should become a task');
  if (await page.locator('#myTasksView .qn-item').count() !== 0) throw new Error('Converted note should leave the list');
  // Delete with undo.
  await page.locator('#myTasksView .qn-input').fill('Удалю');
  await page.locator('#myTasksView .qn-input').press('Enter');
  await page.locator('#myTasksView [data-qn-del]').click();
  await page.locator('#undoToast button').click();
  await page.locator('#myTasksView .qn-text', { hasText: 'Удалю' }).waitFor();
  // Saved to the cloud state and shown on the home page too.
  await page.evaluate(() => cloudWriteNow());
  await page.waitForTimeout(300);
  const st = globalThis.__lastState;
  const saved = (Array.isArray(st) ? st[0] : st)?.state?.quickNotes;
  if (!saved || !saved.some((n) => n.text === 'Удалю')) throw new Error('Notes must be saved in the cloud state: ' + JSON.stringify(saved));
  await page.evaluate(() => switchView('home'));
  await page.locator('#homeView .qn-panel .qn-text', { hasText: 'Удалю' }).waitFor();
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });
  await page.setViewportSize({ width: 390, height: 800 });
  const wide = await page.evaluate(() => document.querySelector('#homeView .qn-panel').scrollWidth > document.querySelector('#homeView .qn-panel').clientWidth + 1);
  if (wide) throw new Error('Notes panel overflows on phone');
  if (pageErrors.length) throw new Error(`Browser page errors: ${pageErrors.join('; ')}`);
  console.log('Quick notes OK: add, edit (Esc/Enter/outside), done + prune, to task, delete + undo, saved, home + phone');
} finally {
  await browser.close();
  server.close();
}
