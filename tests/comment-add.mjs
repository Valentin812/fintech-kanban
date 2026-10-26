import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const html = await readFile('index.html');
const server = createServer((request, response) => {
  if (new URL(request.url, 'http://x').pathname !== '/') { response.writeHead(404).end('Not found'); return; }
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(html);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const launchOptions = { headless: true };
if (process.env.CHROMIUM_EXECUTABLE) launchOptions.executablePath = process.env.CHROMIUM_EXECUTABLE;
const browser = await chromium.launch(launchOptions);

function assert(condition, message) { if (!condition) throw new Error(message); }

const ME = '00000000-0000-4000-8000-000000000001';
const session = { access_token: 'mock-access-token', refresh_token: 'r', user: { id: ME, email: 'owner@example.test', user_metadata: {} } };
const task = (id, title, extra = {}) => ({ id, title, status: 'Очередь', owner: 'Яковлев В.', end: '', description: '', comment: '', ...extra });
const remoteState = {
  data: [{ name: 'Alpha', tasks: [
    task(1, 'Без комментариев'),
    // Written by the old build: entries glued with a literal backslash + n.
    task(2, 'Старые комментарии', { comment: 'https://example.test/task/1\\nвторая запись' }),
  ] }],
  projectMeta: {},
  standaloneTasks: [task(50, 'Быстрая без проекта')],
  members: [{ name: 'Яковлев В.', email: 'owner@example.test', linked: true }],
};
const saves = [];

try {
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
  const errors = [];
  const unexpected = [];
  page.on('pageerror', (error) => errors.push(error.stack || error.message));
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === origin) return route.continue();
    const ok = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.origin !== 'https://vdlfdnhfiiltdyrucdtn.supabase.co') { unexpected.push(url.href); return route.abort(); }
    if (url.pathname === '/auth/v1/user') return ok(session.user);
    if (url.pathname === '/rest/v1/kanban_state' && request.method() === 'GET') return ok([{ user_id: ME, state: remoteState }]);
    if (url.pathname === '/rest/v1/kanban_state') { saves.push(request.postDataJSON()); return route.fulfill({ status: 201, body: '' }); }
    if (url.pathname === '/functions/v1/admin-users') return ok({ error: 'Forbidden' }, 403);
    if (url.pathname.startsWith('/rest/v1/')) return ok([]);
    unexpected.push(`${request.method()} ${url.pathname}`);
    return ok({ error: 'Unexpected mocked request' }, 501);
  });
  await page.addInitScript((saved) => localStorage.setItem('fintech-kanban-session', JSON.stringify(saved)), session);
  await page.goto(`${origin}/`);
  await page.locator('.app').waitFor({ state: 'visible' });
  await page.evaluate(() => { activeProject = 'Alpha'; switchView('mytasks'); renderAll(); });

  // Old data is repaired: the glued text becomes two separate entries.
  const legacy = await page.evaluate(() => ({ raw: active().tasks.find((t) => t.id === 2).comment, entries: commentEntries(active().tasks.find((t) => t.id === 2).comment).length }));
  assert(!legacy.raw.includes('\\n') && legacy.entries === 2, `Legacy comments should be split into entries: ${JSON.stringify(legacy)}`);

  // Add comments to a project task from «Мои задачи»: each one is its own dated entry and the list updates after closing.
  await page.locator('#myTasksView .mytask-row', { hasText: 'Без комментариев' }).click();
  await page.waitForFunction(() => document.querySelector('#drawer').classList.contains('open'));
  await page.locator('#newComment').fill('Первый комментарий');
  await page.keyboard.press('Enter');
  await page.locator('#newComment').fill('Второй комментарий');
  await page.keyboard.press('Enter');
  const text = await page.locator('#dComment').textContent();
  assert(text.includes('Первый комментарий') && text.includes('Второй комментарий') && !text.includes('\\n'), `History shows both comments: ${text}`);
  const entries = await page.evaluate(() => commentEntries(active().tasks.find((t) => t.id === 1).comment));
  assert(entries.length === 2 && entries.every((e) => /^\d{2}\.\d{2}\.\d{4}.* — /.test(e)), `Two separate dated entries expected: ${JSON.stringify(entries)}`);
  // Edit keeps the date stamp; links are clickable; delete asks twice; empty edit is refused.
  await page.locator('#dComment [data-cm-edit]').first().click();
  await page.locator('#dComment .cm-edit').fill('Смотри https://example.com/doc, ок <b>x</b>');
  await page.locator('#dComment [data-cm-save]').click();
  const link = page.locator('#dComment a[href="https://example.com/doc"]');
  assert(await link.count() === 1 && await link.getAttribute('target') === '_blank' && (await link.getAttribute('rel')).includes('noopener'), 'URL in a comment becomes a safe link without the trailing comma');
  assert(await page.locator('#dComment b').count() === 0, 'HTML in comments is escaped');
  const edited = await page.evaluate(() => commentEntries(active().tasks.find((t) => t.id === 1).comment));
  assert(edited.length === 2 && /^\d{2}\.\d{2}\.\d{4}.* — Смотри https:\/\/example\.com\/doc/.test(edited[0]), `Edited entry keeps its date: ${JSON.stringify(edited)}`);
  await page.locator('#dComment [data-cm-edit]').first().click();
  await page.locator('#dComment .cm-edit').fill('   ');
  await page.locator('#dComment [data-cm-save]').click();
  assert(await page.locator('#dComment .cm-edit').count() === 1, 'Empty comment is not saved');
  await page.locator('#dComment [data-cm-cancel]').click();
  await page.locator('#dComment [data-cm-ask]').first().click();
  assert((await page.evaluate(() => commentEntries(active().tasks.find((t) => t.id === 1).comment))).length === 2, 'First click on delete only asks');
  await page.locator('#dComment [data-cm-delete]').click();
  const after = await page.evaluate(() => commentEntries(active().tasks.find((t) => t.id === 1).comment));
  assert(after.length === 1 && after[0].includes('Второй комментарий'), `Entry deleted: ${JSON.stringify(after)}`);
  await page.locator('#newComment').fill('Третий');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('#drawer').classList.contains('open'));
  const badge = page.locator('#myTasksView .mytask-row', { hasText: 'Без комментариев' }).locator('.mytask-comments');
  assert((await badge.textContent()).includes('2'), 'The «Мои задачи» list shows the comment count right after closing');

  // Same for a task without a project; typed text left in the field is saved when the drawer closes through «Готово».
  await page.locator('#myTasksView .mytask-row', { hasText: 'Быстрая без проекта' }).click();
  await page.waitForFunction(() => document.querySelector('#drawer').classList.contains('open'));
  await page.locator('#newComment').fill('Комментарий без проекта');
  await page.locator('#saveTask').click();
  await page.waitForFunction(() => !document.querySelector('#drawer').classList.contains('open'));
  assert((await page.locator('#myTasksView .mytask-row', { hasText: 'Быстрая без проекта' }).locator('.mytask-comments').textContent()).includes('1'), 'A no-project task shows its comment badge');

  await page.evaluate(() => cloudWriteNow());
  const last = saves.at(-1).state;
  assert(last.data[0].tasks.find((t) => t.id === 1).comment.includes('Второй комментарий'), 'Comments are saved to the cloud state');
  assert(!unexpected.length, `Unexpected requests: ${unexpected.join('; ')}`);
  assert(!errors.length, `Browser page errors: ${errors.join('; ')}`);
  console.log('Comments OK: separate dated entries, legacy repair, list badges update, saved');
} finally {
  await browser.close();
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}
