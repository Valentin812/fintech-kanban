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
  await page.evaluate(() => { localStorage.removeItem('fintech-kanban-keynotes-open:' + activeProject); switchView('tasks'); });
  const card = page.locator('#keyNotes');
  await card.waitFor({ state: 'visible' });
  if (!(await card.locator('.kn-head').textContent()).includes('Важное по проекту')) throw new Error('Card title missing');
  // It sits above the columns, below the filters.
  const order = await page.evaluate(() => { const c = document.getElementById('keyNotes').getBoundingClientRect(), b = document.getElementById('board').getBoundingClientRect(), t = document.getElementById('taskToolbar').getBoundingClientRect(); return c.top >= t.bottom - 1 && c.bottom <= b.top + 1; });
  if (!order) throw new Error('Card must be between the toolbar and the board');
  if (await card.locator('.kn-body').isVisible()) throw new Error('Card is collapsed by default');
  await card.locator('.kn-head').click();
  await card.locator('#knText').waitFor({ state: 'visible' });
  await card.locator('#knText').fill('Работа продолжится в декабре');
  await card.locator('#knText').press('Shift+Enter');
  await card.locator('#knText').type('Согласовано в Telegram');
  if (await card.locator('.kn-item').count() !== 0) throw new Error('Shift+Enter must not add');
  await card.locator('#knFile').setInputFiles({ name: 'tg.png', mimeType: 'image/png', buffer: Buffer.from('89504e470d0a1a0a', 'hex') });
  await card.locator('#knPending span', { hasText: 'tg.png' }).waitFor();
  await card.locator('#knText').press('Enter');
  await card.locator('.kn-item').waitFor();
  const text = await card.locator('.kn-text').textContent();
  if (!text.includes('декабре') || !text.includes('\n')) throw new Error('Entry text with line break expected: ' + text);
  if (await card.locator('.kn-shot').count() !== 1) throw new Error('Screenshot thumbnail expected');
  if (!String(globalThis.__uploaded || '').includes('/tg.png')) throw new Error('File should be uploaded: ' + globalThis.__uploaded);
  // Kept in the cloud state and shown in the collapsed preview after a re-render.
  await page.evaluate(() => cloudWriteNow());
  await page.waitForTimeout(300);
  const st = globalThis.__lastState;
  const meta = (Array.isArray(st) ? st[0] : st)?.state?.projectMeta;
  const saved = meta && Object.values(meta).some((m) => (m.keyNotes || []).some((n) => n.text.includes('декабре') && n.attachments.length === 1));
  if (!saved) throw new Error('keyNotes must be saved in the cloud state: ' + JSON.stringify(meta).slice(0, 300));
  await card.locator('.kn-head').click();
  if (!(await card.locator('.kn-prev').textContent()).includes('декабре')) throw new Error('Collapsed card shows the latest entry');
  // Edit, delete with undo.
  await card.locator('.kn-head').click();
  await card.locator('[data-kn-edit]').click();
  await card.locator('.kn-edit-ta').fill('Продолжим в январе');
  await card.locator('[data-kn-save]').click();
  await card.locator('.kn-text', { hasText: 'январе' }).waitFor();
  await card.locator('[data-kn-del]').click();
  if (await card.locator('.kn-item').count() !== 0) throw new Error('Entry should be deleted');
  await page.locator('#undoToast button').click();
  await card.locator('.kn-item').waitFor();
  // Hidden outside the tasks tab, fits on a phone.
  await page.evaluate(() => switchView('roadmap'));
  if (await card.isVisible()) throw new Error('Card is only for the tasks tab');
  await page.evaluate(() => switchView('tasks'));
  await page.setViewportSize({ width: 390, height: 800 });
  const fits = await page.evaluate(() => { const r = document.getElementById('keyNotes').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth + 1; });
  if (!fits) throw new Error('Card must fit on a phone');
  // The open card must not be squeezed/clipped by the layout (hint and entries stay fully visible).
  await page.setViewportSize({ width: 1280, height: 620 });
  await page.evaluate(() => { activeProject = data[0].name; switchView('tasks'); });
  await card.waitFor({ state: 'visible' });
  if (!(await card.evaluate((el) => el.classList.contains('open')))) await card.locator('.kn-head').click();
  const clip = await page.evaluate(() => {
    const c = document.getElementById('keyNotes'), b = c.querySelector('.kn-body');
    const cr = c.getBoundingClientRect(), br = b.getBoundingClientRect();
    return { cardBottom: cr.bottom, bodyBottom: br.bottom, flex: getComputedStyle(c).flexShrink };
  });
  if (clip.bodyBottom > clip.cardBottom + 1 || clip.flex !== '0') throw new Error('Key notes card is clipped: ' + JSON.stringify(clip));
  if (pageErrors.length) throw new Error('Page errors: ' + pageErrors.join('; '));
  console.log('Key notes OK');
} finally {
  await browser.close();
  server.close();
}
