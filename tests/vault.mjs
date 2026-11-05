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
    if (url.pathname === '/rest/v1/vault' && request.method() === 'GET') return ok(globalThis.__vault ? [{ payload: globalThis.__vault }] : []);
    if (url.pathname === '/rest/v1/vault') { globalThis.__vault = JSON.parse(request.postData()).payload; return route.fulfill({ status: 201, body: '' }); }
    if (url.pathname === '/functions/v1/admin-users') return ok({ error: 'F' }, 403);
    if (url.pathname.startsWith('/rest/v1/')) return ok([]);
    return ok({}, 501);
  });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript((s) => localStorage.setItem('fintech-kanban-session', JSON.stringify(s)), session);
  await page.goto(`${origin}/`);
  await page.locator('.app').waitFor({ state: 'visible' });
  const openVault = async () => { await page.evaluate(() => document.getElementById('vaultButton').click()); };
  // Создание сейфа.
  await openVault();
  await page.locator('#vaultPass').waitFor({ state: 'visible' });
  await page.fill('#vaultPass', 'short'); await page.fill('#vaultPass2', 'short'); await page.click('#vaultOpen');
  await page.waitForFunction((t) => document.getElementById('vaultErr').textContent.includes(t), '8', { timeout: 8000 }).catch(() => { throw new Error('Short master password rejected'); });
  await page.fill('#vaultPass', 'test-master-123'); await page.fill('#vaultPass2', 'other-master-123'); await page.click('#vaultOpen');
  await page.waitForFunction((t) => document.getElementById('vaultErr').textContent.includes(t), 'не совпад', { timeout: 8000 }).catch(() => { throw new Error('Mismatch rejected'); });
  await page.fill('#vaultPass2', 'test-master-123'); await page.click('#vaultOpen');
  await page.locator('#vaultText').waitFor({ state: 'visible' });
  await page.fill('#vaultText', 'банк: логин demo / пароль SECRET-42');
  await page.click('#vaultSave');
  await page.waitForFunction(() => document.getElementById('vaultState').textContent === 'Сохранено');
  assert(globalThis.__vault && !globalThis.__vault.includes('SECRET') && !globalThis.__vault.includes('банк'), 'Stored payload is encrypted');
  assert(!JSON.stringify(lastState || {}).includes('SECRET'), 'Secret is not in kanban state');
  // Блокировка очищает текст.
  await page.click('#vaultLockBtn');
  assert((await page.locator('#vaultText').inputValue()) === '', 'Text cleared on lock');
  // Неверный и верный пароль.
  await openVault();
  await page.locator('#vaultPass').waitFor({ state: 'visible' });
  await page.fill('#vaultPass', 'wrong-master-1'); await page.click('#vaultOpen');
  await page.waitForFunction((t) => document.getElementById('vaultErr').textContent.includes(t), 'Неверный', { timeout: 8000 }).catch(() => { throw new Error('Wrong password rejected: '); });
  assert(await page.locator('#vaultBody').isHidden(), 'Body stays hidden');
  await page.fill('#vaultPass', 'test-master-123'); await page.click('#vaultOpen');
  await page.locator('#vaultText').waitFor({ state: 'visible' });
  assert((await page.locator('#vaultText').inputValue()).includes('SECRET-42'), 'Text restored');
  // Смена мастер-пароля.
  await page.click('#vaultChange');
  await page.fill('#vaultPass', 'new-master-456'); await page.fill('#vaultPass2', 'new-master-456'); await page.click('#vaultOpen');
  await page.waitForFunction(() => document.getElementById('vaultState').textContent.includes('изменён'));
  await page.click('#vaultLockBtn');
  await openVault();
  await page.locator('#vaultPass').waitFor({ state: 'visible' });
  await page.fill('#vaultPass', 'test-master-123'); await page.click('#vaultOpen');
  await page.waitForFunction((t) => document.getElementById('vaultErr').textContent.includes(t), 'Неверный', { timeout: 8000 }).catch(() => { throw new Error('Old password no longer works'); });
  await page.fill('#vaultPass', 'new-master-456'); await page.click('#vaultOpen');
  await page.locator('#vaultText').waitFor({ state: 'visible' });
  assert((await page.locator('#vaultText').inputValue()).includes('SECRET-42'), 'Text readable with the new password');
  assert(!errors.length, 'Page errors: ' + errors.join('; '));
  console.log('Vault OK: create, encrypted storage, lock, wrong/right password, change password');
} finally {
  await browser.close();
  await new Promise((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
}
