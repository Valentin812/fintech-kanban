import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const html = await readFile('index.html');
const server = createServer((request, response) => {
  if (new URL(request.url, 'http://x').pathname !== '/') {
    response.writeHead(404).end('Not found');
    return;
  }
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(html);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const launchOptions = { headless: true };
if (process.env.CHROMIUM_EXECUTABLE) launchOptions.executablePath = process.env.CHROMIUM_EXECUTABLE;
const browser = await chromium.launch(launchOptions);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const ME = '00000000-0000-4000-8000-000000000001';
const COLLEAGUE = '00000000-0000-4000-8000-000000000002';
const session = { access_token: 'mock-access-token', refresh_token: 'r', user: { id: ME, email: 'owner@example.test', user_metadata: {} } };
const longComment = Array.from({ length: 12 }, (_, i) => `2${i % 9}.10.2026 10:0${i % 9} — Комментарий номер ${i + 1} ${'текст '.repeat(12)}`).join('\n\n');
const remoteState = {
  data: [{ name: 'Main', tasks: [
    { id: 1, title: 'С комментариями', status: 'Очередь', owner: 'Яковлев В.', end: '', comment: longComment },
  ] }],
  projectMeta: {},
  standaloneTasks: [
    { id: 50, title: 'Моя без проекта', status: 'Очередь', owner: 'Яковлев В.', end: '' },
    { id: 51, title: 'Чужая без проекта', status: 'Очередь', owner: 'Сухов Е.', end: '' },
  ],
  members: [{ name: 'Яковлев В.', email: 'owner@example.test', linked: true }],
};
const TINY = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
let avatars = [{ user_id: COLLEAGUE, image: TINY }];

try {
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
  const errors = [];
  const unexpected = [];
  const avatarWrites = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === origin) return route.continue();
    const ok = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.origin !== 'https://vdlfdnhfiiltdyrucdtn.supabase.co') {
      unexpected.push(url.href);
      return route.abort();
    }
    if (url.pathname === '/auth/v1/user') return ok(session.user);
    if (url.pathname === '/rest/v1/kanban_state' && request.method() === 'GET') return ok([{ user_id: ME, state: remoteState }]);
    if (url.pathname === '/rest/v1/kanban_state' && request.method() === 'POST') return route.fulfill({ status: 201, body: '' });
    if (url.pathname === '/rest/v1/kanban_profiles') {
      return ok([
        { user_id: ME, display_name: 'Яковлев В.', email: 'owner@example.test' },
        { user_id: COLLEAGUE, display_name: 'e.sukhov', email: 'e.sukhov@example.test' },
      ]);
    }
    if (url.pathname === '/rest/v1/kanban_avatars') {
      if (request.method() === 'GET') return ok(avatars);
      if (request.method() === 'POST') {
        const body = request.postDataJSON();
        avatarWrites.push({ method: 'POST', user_id: body.user_id, image: body.image });
        assert(request.headers().prefer?.includes('merge-duplicates'), 'Avatar upload must upsert');
        avatars = [...avatars.filter((a) => a.user_id !== body.user_id), { user_id: body.user_id, image: body.image }];
        return route.fulfill({ status: 201, body: '' });
      }
      if (request.method() === 'DELETE') {
        avatarWrites.push({ method: 'DELETE', filter: url.searchParams.get('user_id') });
        avatars = avatars.filter((a) => `eq.${a.user_id}` !== url.searchParams.get('user_id'));
        return route.fulfill({ status: 204, body: '' });
      }
    }
    if (url.pathname === '/functions/v1/admin-users') return ok({ error: 'Forbidden' }, 403);
    if (['/rest/v1/notifications', '/rest/v1/messenger_accounts', '/rest/v1/shared_projects', '/rest/v1/telegram_inbox'].includes(url.pathname)) return ok([]);
    unexpected.push(`${request.method()} ${url.pathname}`);
    return ok({ error: 'Unexpected mocked request' }, 501);
  });
  await page.addInitScript((saved) => localStorage.setItem('fintech-kanban-session', JSON.stringify(saved)), session);
  await page.goto(`${origin}/`);
  await page.locator('.app').waitFor({ state: 'visible' });
  await page.evaluate(() => { activeProject = 'Main'; switchView('tasks'); renderAll(); });

  // 1. Comment preview shows every comment, scrolls, and stays open while hovered.
  const peekButton = page.locator('article.task[data-id="1"] [data-comment-peek]');
  await peekButton.hover();
  const peek = page.locator('#commentPeek:not([hidden])');
  await peek.waitFor();
  assert(await page.locator('#commentPeek .comment-peek-item').count() === 12, 'All comments should be listed in the preview');
  const scroll = await page.locator('#commentPeek').evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight, top: el.scrollTop }));
  assert(scroll.sh > scroll.ch && scroll.top > 0, `Long preview should scroll and start at the newest comment: ${JSON.stringify(scroll)}`);
  const box = await page.locator('#commentPeek').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + 20, { steps: 8 });
  await page.waitForTimeout(500);
  assert(await page.locator('#commentPeek').isVisible(), 'Preview must stay open while the mouse is over it');
  await page.mouse.wheel(0, -200);
  await page.mouse.move(5, 890);
  await page.locator('#commentPeek').waitFor({ state: 'hidden' });

  // 2. «Задачи без проектов» lives in «Мои задачи» as a filter; old entry points redirect there.
  assert(await page.locator('#standaloneNav').isHidden(), 'The separate sidebar tab should be gone');
  await page.evaluate(() => switchView('inbox'));
  await page.waitForFunction(() => activeView === 'mytasks');
  assert(await page.locator('[data-my-filter="noproject"]').getAttribute('aria-pressed') === 'true', 'Redirect should open the «Без проекта» filter');
  const titles = await page.locator('#myTasksView .mytask-row .mytask-title').allTextContents();
  assert(titles.includes('Моя без проекта') && titles.includes('Чужая без проекта') && !titles.includes('С комментариями'),
    `«Без проекта» should show every task without a project: ${titles}`);
  await page.locator('#myTasksView .mytask-row', { hasText: 'Чужая без проекта' }).click();
  await page.waitForFunction(() => document.querySelector('#drawer').classList.contains('open'));
  assert(await page.locator('#standaloneToProject').isVisible() && await page.locator('#removeFromProject').isHidden(), 'Drawer should offer «В проект» for tasks without a project');
  await page.locator('#standaloneToProject').click();
  await page.waitForFunction(() => !document.querySelector('#drawer').classList.contains('open'));
  assert(await page.locator('text=Проект назначения').count() + await page.locator('.move-modal, .modal.show').count() > 0, 'Move-to-project dialog should open');
  await page.keyboard.press('Escape');
  await page.evaluate(() => document.querySelectorAll('.move-modal-backdrop, #moveTaskModal').forEach((m) => m.remove()));
  assert(await page.locator('#addInboxTask').isVisible(), 'My tasks should have a «Задача без проекта» button');

  // 3. Sidebar width can be dragged and is remembered; double click resets.
  const handle = page.locator('.side-resizer');
  const startWidth = (await page.locator('.sidebar').boundingBox()).width;
  const hb = await handle.boundingBox();
  await page.mouse.move(hb.x + 4, hb.y + 200);
  await page.mouse.down();
  await page.mouse.move(hb.x + 104, hb.y + 200, { steps: 6 });
  await page.mouse.up();
  const widened = (await page.locator('.sidebar').boundingBox()).width;
  assert(Math.abs(widened - (startWidth + 100)) <= 4, `Sidebar should widen by ~100px: ${startWidth} → ${widened}`);
  assert(Number(await page.evaluate(() => localStorage.getItem('fintech-kanban-sidebar-w'))) === Math.round(widened), 'Width should be remembered');
  await page.mouse.move(hb.x + 4, hb.y + 200);
  await page.mouse.down();
  await page.mouse.move(hb.x - 600, hb.y + 200, { steps: 4 });
  await page.mouse.up();
  assert((await page.locator('.sidebar').boundingBox()).width >= 180, 'Sidebar must not shrink below the minimum');
  await page.locator('.side-resizer').dblclick();
  assert(Math.abs((await page.locator('.sidebar').boundingBox()).width - startWidth) <= 1, 'Double click should restore the default width');

  // 4. «Что нового» in the account menu.
  await page.locator('#cloudButton').click();
  await page.locator('#changelogButton').waitFor({ state: 'visible' });
  assert(await page.locator('#changelogButton .changelog-new').count() === 1, 'Unseen updates should be marked');
  await page.locator('#changelogButton').click();
  await page.locator('#changelogModal.show').waitFor();
  assert(await page.locator('#changelogModal .changelog-entry').count() >= 5, 'Changelog should list the updates');
  await page.keyboard.press('Escape');
  assert(!(await page.locator('#changelogModal').evaluate((m) => m.classList.contains('show'))), 'Escape closes the changelog');

  // 5. Profile photos: colleagues' photos show up, mine can be uploaded and removed.
  await page.evaluate(() => switchView('people'));
  await page.waitForFunction(() => document.querySelectorAll('#peopleView .avatar img').length === 1);
  await page.locator('#cloudButton').click();
  await page.locator('#avatarUpload').waitFor({ state: 'visible' });
  const file = await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 400; c.height = 300;
    const x = c.getContext('2d'); x.fillStyle = '#c33'; x.fillRect(0, 0, 400, 300);
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  await page.locator('#avatarFile').setInputFiles({ name: 'me.png', mimeType: 'image/png', buffer: Buffer.from(file) });
  await page.waitForFunction(() => document.querySelector('#accountAvatar img'));
  const up = avatarWrites.find((w) => w.method === 'POST');
  assert(up && up.user_id === ME && /^data:image\/jpeg;base64,/.test(up.image) && up.image.length < 60000, 'Upload should send a small JPEG for my account');
  const size = await page.evaluate((src) => new Promise((r) => { const i = new Image(); i.onload = () => r([i.width, i.height]); i.src = src; }), up.image);
  assert(size[0] === 160 && size[1] === 160, `Photo should be cropped to a square: ${size}`);
  assert(await page.locator('#peopleView .avatar img').count() === 2, 'My photo should appear in the participants list');
  await page.locator('#avatarRemove').click();
  await page.waitForFunction(() => !document.querySelector('#accountAvatar img'));
  assert(avatarWrites.at(-1).method === 'DELETE' && avatarWrites.at(-1).filter === `eq.${ME}`, 'Removing deletes only my photo');

  assert(!unexpected.length, `Unexpected network requests: ${unexpected.join('; ')}`);
  assert(!errors.length, `Browser page errors: ${errors.join('; ')}`);
  console.log('UX pack OK: scrollable comment preview, «Без проекта» in My tasks, resizable sidebar, changelog, profile photos');
} finally {
  await browser.close();
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}
