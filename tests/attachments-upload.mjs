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
function assert(c, m) { if (!c) throw new Error(m); }
const ME = '00000000-0000-4000-8000-000000000001';
const session = { access_token: 'm', refresh_token: 'r', user: { id: ME, email: 'o@example.test', user_metadata: {} } };
const proj = (name) => ({ name, tasks: [{ id: name.length * 100 + 1, title: 'T ' + name, status: 'Очередь', owner: '', end: '', description: '', comment: '' }] });
const remoteState = { data: [proj('Альфа'), proj('Бета'), proj('Гамма')], projectMeta: {}, standaloneTasks: [], members: [] };
let lastState = null;
const uploads = [];
try {
  const context = await browser.newContext({ viewport: { width: 1300, height: 800 } });
  const page = await context.newPage();
  const errors = [];
  await page.route('**/*', async (route) => {
    const request = route.request(); const url = new URL(request.url());
    if (url.origin === origin) return route.continue();
    const ok = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.origin !== 'https://vdlfdnhfiiltdyrucdtn.supabase.co') return route.abort();
    if (url.pathname === '/auth/v1/user') return ok(session.user);
    if (url.pathname === '/rest/v1/kanban_state' && request.method() === 'GET') return ok([{ user_id: ME, state: (Array.isArray(lastState) ? lastState[0] : lastState)?.state ?? remoteState }]);
    if (url.pathname === '/rest/v1/kanban_state') { try { lastState = JSON.parse(request.postData()); } catch (e) {} return route.fulfill({ status: 201, body: '' }); }
    if (url.pathname.startsWith('/storage/v1/object/task-files/') && request.method() === 'POST') { uploads.push({ path: decodeURIComponent(url.pathname.replace('/storage/v1/object/task-files/', '')), type: request.headers()['content-type'], size: request.postDataBuffer()?.length || 0 }); return ok({ Key: 'x' }); }
    if (url.pathname.startsWith('/storage/v1/object/sign/task-files/')) return ok({ signedURL: '/object/sign/task-files/x?token=t' });
    if (url.pathname.startsWith('/storage/v1/object/sign/')) return ok({ signedURL: '/object/sign/task-files/x?token=t' });
    if (url.pathname === '/functions/v1/admin-users') return ok({ error: 'F' }, 403);
    if (url.pathname.startsWith('/rest/v1/')) return ok([]);
    return ok({}, 501);
  });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript((s) => localStorage.setItem('fintech-kanban-session', JSON.stringify(s)), session);
  await page.goto(`${origin}/`);
  await page.locator('.app').waitFor({ state: 'visible' });
  await page.evaluate(() => { activeProject = 'Альфа'; renderAll(); switchView('tasks'); });
  await page.locator('article.task').first().locator('.tasktitle').click();
  await page.waitForFunction(() => document.querySelector('#drawer').classList.contains('open'));
  assert(await page.locator('#dAttachments [data-att-add]').isVisible(), 'The add-file control is visible even without attachments');
  // Выбор файла кнопкой: PDF с русским именем.
  await page.locator('#dAttachments [data-att-input]').setInputFiles({ name: 'Договор №5.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 test') });
  await page.locator('#dAttachments .attach-file').waitFor();
  assert(uploads.length === 1 && uploads[0].path.startsWith(ME + '/') && /\.pdf$/.test(uploads[0].path) && /^[\x20-\x7e]+$/.test(uploads[0].path) && uploads[0].type === 'application/pdf', 'PDF uploaded to the user folder with a safe key: ' + JSON.stringify(uploads));
  const att = await page.evaluate(() => currentDrawerTask().attachments);
  assert(att.length === 1 && att[0].name === 'Договор №5.pdf' && att[0].kind === 'file' && att[0].size > 0, 'Attachment stored on the task: ' + JSON.stringify(att));
  assert((await page.locator('#dAttachments .attach-file').textContent()).includes('Договор №5.pdf'), 'File row shows the original name');
  // Перетаскивание файла на карточку.
  await page.evaluate(() => { const dt = new DataTransfer(); dt.items.add(new File(['x'.repeat(10)], 'photo.png', { type: 'image/png' })); const d = document.querySelector('#drawer .field') || document.querySelector('#drawer'); d.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true })); d.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); });
  await page.waitForFunction(() => currentDrawerTask().attachments.length === 2);
  assert((await page.evaluate(() => currentDrawerTask().attachments[1].kind)) === 'image', 'Dropped image is stored as an image');
  // Неподдерживаемый тип и большой файл не загружаются.
  const before = uploads.length;
  await page.locator('#dAttachments [data-att-input]').setInputFiles({ name: 'run.exe', mimeType: 'application/x-msdownload', buffer: Buffer.from('MZ') });
  await page.waitForTimeout(300);
  assert(uploads.length === before && (await page.evaluate(() => currentDrawerTask().attachments.length)) === 2, 'Unsupported types are rejected');
  // Убрать из задачи, сохранить в облаке.
  await page.locator('#dAttachments [data-att-remove="0"]').click();
  assert((await page.evaluate(() => currentDrawerTask().attachments.length)) === 1, 'Attachment removed from the task');
  await page.evaluate(() => cloudWriteNow());
  await page.waitForTimeout(300);
  const st = Array.isArray(lastState) ? lastState[0] : lastState;
  assert(JSON.stringify(st?.state?.data?.[0]?.tasks?.[0]?.attachments || []).includes('photo.png'), 'Attachments are saved with the state');
  assert(!errors.length, 'Page errors: ' + errors.join('; '));
  console.log('Attachments OK: button, drop, safe key, types, remove, saved');
} finally {
  await browser.close();
  await new Promise((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
}
