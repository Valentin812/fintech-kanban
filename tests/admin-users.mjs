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
const origin = `http://127.0.0.1:${port}`;
const launchOptions = { headless: true };
if (process.env.CHROMIUM_EXECUTABLE) launchOptions.executablePath = process.env.CHROMIUM_EXECUTABLE;
const browser = await chromium.launch(launchOptions);

const ADMIN_ID = '00000000-0000-4000-8000-0000000000a1';
const USER_ID = '00000000-0000-4000-8000-0000000000b2';
const BANNED_ID = '00000000-0000-4000-8000-0000000000c3';
const HELPER_ID = '00000000-0000-4000-8000-0000000000d4';

function sessionFor(id, email) {
  return {
    access_token: `token-${id}`,
    refresh_token: 'mock-refresh-token',
    token_type: 'bearer',
    expires_in: 3600,
    user: { id, aud: 'authenticated', role: 'authenticated', email, app_metadata: {}, user_metadata: {} },
  };
}

const users = (selfId = ADMIN_ID) => [
  { id: ADMIN_ID, email: 'owner@example.test', name: 'Владелец', created_at: '2026-10-19T09:48:03Z', last_sign_in_at: '2026-10-22T10:50:47Z', email_confirmed: true, banned: false, is_admin: true, is_owner: true, is_self: selfId === ADMIN_ID, telegram: true },
  { id: HELPER_ID, email: 'helper@example.test', name: 'Помощник', created_at: '2026-10-20T09:48:03Z', last_sign_in_at: null, email_confirmed: true, banned: false, is_admin: true, is_owner: false, is_self: selfId === HELPER_ID, telegram: false },
  { id: USER_ID, email: 'colleague@example.test', name: 'Коллега', created_at: '2026-10-21T06:07:12Z', last_sign_in_at: null, email_confirmed: true, banned: false, is_admin: false, is_self: false, telegram: false },
  { id: BANNED_ID, email: 'spammer@example.test', name: '', created_at: '2026-10-22T06:07:12Z', last_sign_in_at: null, email_confirmed: false, banned: true, is_admin: false, is_self: false, telegram: false },
];

async function openPage({ session, isAdmin, isOwner = false }) {
  const page = await browser.newPage();
  const errors = [];
  const adminCalls = [];
  const unexpected = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('dialog', (dialog) => dialog.accept());
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === origin) return route.continue();
    if (url.origin !== 'https://vdlfdnhfiiltdyrucdtn.supabase.co') {
      unexpected.push(`${request.method()} ${url.href}`);
      return route.abort();
    }
    const ok = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname === '/auth/v1/user') return ok(session?.user ?? {});
    if (url.pathname === '/rest/v1/kanban_state' && request.method() === 'GET') {
      return ok([{ user_id: session.user.id, state: { data: [{ name: 'Admin project', tasks: [] }], projectMeta: {}, standaloneTasks: [], members: [] } }]);
    }
    if (url.pathname === '/rest/v1/kanban_state' && request.method() === 'POST') return route.fulfill({ status: 201, body: '' });
    if (url.pathname === '/rest/v1/kanban_profiles' || url.pathname === '/rest/v1/messenger_accounts') return ok([]);
    if (url.pathname === '/functions/v1/admin-users' && request.method() === 'POST') {
      const body = request.postDataJSON();
      adminCalls.push(body);
      if (request.headers().authorization !== `Bearer ${session.access_token}`) return ok({ error: 'Sign in required' }, 401);
      if (!isAdmin) return ok({ error: 'Forbidden' }, 403);
      if (body.action === 'list') return ok({ users: users(session.user.id), me: { id: session.user.id, is_owner: isOwner } });
      return ok({ ok: true });
    }
    unexpected.push(`${request.method()} ${url.pathname}`);
    return ok({ error: 'Unexpected mocked request' }, 501);
  });
  if (session) {
    await page.addInitScript((saved) => localStorage.setItem('fintech-kanban-session', JSON.stringify(saved)), session);
  }
  await page.goto(`${origin}/`);
  return { page, errors, adminCalls, unexpected };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  // 1. Administrator sees the panel and can block / unblock users.
  const adminSession = sessionFor(ADMIN_ID, 'owner@example.test');
  const a = await openPage({ session: adminSession, isAdmin: true, isOwner: true });
  await a.page.locator('.app').waitFor({ state: 'visible' });
  await a.page.locator('#cloudButton').click();
  await a.page.locator('#cloudAdminGroup').waitFor({ state: 'visible' });
  await a.page.locator('#adminUsersButton').click();
  await a.page.locator('#adminModal.show').waitFor();
  await a.page.locator(`[data-user-row="${BANNED_ID}"]`).waitFor();
  assert(await a.page.locator('[data-user-row]').count() === 4, 'Admin panel should list all users');
  assert(await a.page.locator(`[data-user-row="${ADMIN_ID}"] [data-admin-action]`).count() === 0, 'Administrators must not have a block button');
  assert((await a.page.locator('#adminStatus').textContent()).includes('4'), 'Status should show the number of accounts');
  assert(await a.page.locator(`[data-user-row="${BANNED_ID}"] [data-admin-action="grant_admin"]`).count() === 0, 'Blocked users cannot be promoted');
  assert(await a.page.locator(`[data-user-row="${HELPER_ID}"] [data-admin-action="ban"]`).count() === 0, 'Admins cannot be blocked');

  await a.page.locator(`[data-user-row="${USER_ID}"] [data-admin-action="ban"]`).click();
  await a.page.locator(`[data-user-row="${USER_ID}"] .admin-badge.banned`).waitFor();
  await a.page.locator(`[data-user-row="${USER_ID}"] [data-admin-action="unban"]`).waitFor();

  await a.page.locator(`[data-user-row="${BANNED_ID}"] [data-admin-action="unban"]`).click();
  await a.page.locator(`[data-user-row="${BANNED_ID}"] [data-admin-action="ban"]`).waitFor();

  // Owner promotes the colleague, who then has no block button, and demotes the helper.
  await a.page.locator(`[data-user-row="${USER_ID}"] [data-admin-action="unban"]`).click();
  await a.page.locator(`[data-user-row="${USER_ID}"] [data-admin-action="grant_admin"]`).click();
  await a.page.locator(`[data-user-row="${USER_ID}"] [data-admin-action="revoke_admin"]`).waitFor();
  assert(await a.page.locator(`[data-user-row="${USER_ID}"] [data-admin-action="ban"]`).count() === 0, 'New admin should not be blockable');
  await a.page.locator(`[data-user-row="${HELPER_ID}"] [data-admin-action="revoke_admin"]`).click();
  await a.page.locator(`[data-user-row="${HELPER_ID}"] [data-admin-action="grant_admin"]`).waitFor();
  assert(await a.page.locator(`[data-user-row="${ADMIN_ID}"] [data-admin-action]`).count() === 0, 'Owner row must have no actions');

  const mutations = a.adminCalls.filter((call) => call.action !== 'list');
  assert(JSON.stringify(mutations) === JSON.stringify([
    { action: 'ban', user_id: USER_ID },
    { action: 'unban', user_id: BANNED_ID },
    { action: 'unban', user_id: USER_ID },
    { action: 'grant_admin', user_id: USER_ID },
    { action: 'revoke_admin', user_id: HELPER_ID },
  ]), `Unexpected admin requests: ${JSON.stringify(mutations)}`);

  await a.page.locator('#adminClose').click();
  assert(!(await a.page.locator('#adminModal').evaluate((el) => el.classList.contains('show'))), 'Admin panel should close');

  // 2. A non-owner admin can block users but cannot manage admin rights.
  const helperSession = sessionFor(HELPER_ID, 'helper@example.test');
  const h = await openPage({ session: helperSession, isAdmin: true, isOwner: false });
  await h.page.locator('.app').waitFor({ state: 'visible' });
  await h.page.locator('#cloudButton').click();
  await h.page.locator('#cloudAdminGroup').waitFor({ state: 'visible' });
  await h.page.locator('#adminUsersButton').click();
  await h.page.locator(`[data-user-row="${USER_ID}"] [data-admin-action="ban"]`).waitFor();
  assert(await h.page.locator('[data-admin-action="grant_admin"], [data-admin-action="revoke_admin"]').count() === 0, 'Only the owner may see admin-rights buttons');

  // 3. Regular user never sees the admin section.
  const userSession = sessionFor(USER_ID, 'colleague@example.test');
  const u = await openPage({ session: userSession, isAdmin: false });
  await u.page.locator('.app').waitFor({ state: 'visible' });
  await u.page.locator('#cloudButton').click();
  await u.page.waitForResponse((r) => r.url().includes('/functions/v1/admin-users'));
  await u.page.waitForTimeout(200);
  assert(await u.page.locator('#cloudAdminGroup').isHidden(), 'Admin section must stay hidden for regular users');

  // 4. Sign-up enforces the password policy before any network request;
  //    sign-in still accepts existing shorter passwords.
  const s = await openPage({ session: null, isAdmin: false });
  await s.page.locator('#authScreen').waitFor({ state: 'visible' });
  await s.page.locator('#authSignupTab').click();
  await s.page.locator('#authEmail').fill('new@example.test');
  for (const weak of ['short1', 'onlyletters', '12345678']) {
    await s.page.locator('#authPassword').fill(weak);
    await s.page.locator('#authSubmit').click();
    const message = await s.page.locator('#authStatus').textContent();
    assert(message.includes('8 символов'), `Weak password "${weak}" should be rejected, got: ${message}`);
  }
  assert(s.unexpected.length === 0, `Weak passwords must not reach the server: ${s.unexpected.join('; ')}`);

  const errors = [...a.errors, ...h.errors, ...u.errors, ...s.errors];
  const unexpected = [...a.unexpected, ...h.unexpected, ...u.unexpected, ...s.unexpected];
  assert(!unexpected.length, `Unexpected network requests: ${unexpected.join('; ')}`);
  assert(!errors.length, `Browser page errors: ${errors.join('; ')}`);

  console.log('Admin users OK: list/block/unblock, owner grants and revokes admins, non-owner admins cannot, hidden for regular users, sign-up password policy');
} finally {
  await browser.close();
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}
