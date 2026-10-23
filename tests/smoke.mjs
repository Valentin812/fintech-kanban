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

const userId = '00000000-0000-4000-8000-000000000001';
const session = {
  access_token: 'mock-access-token',
  refresh_token: 'mock-refresh-token',
  token_type: 'bearer',
  expires_in: 3600,
  user: {
    id: userId,
    aud: 'authenticated',
    role: 'authenticated',
    email: 'smoke@example.test',
    app_metadata: {},
    user_metadata: {},
  },
};

function installSupabaseMocks(page, remoteState = null) {
  const writes = [];
  const unexpectedRequests = [];

  page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === origin) {
      await route.continue();
      return;
    }
    if (url.origin !== 'https://vdlfdnhfiiltdyrucdtn.supabase.co') {
      unexpectedRequests.push(`${request.method()} ${url.origin}${url.pathname}`);
      await route.abort();
      return;
    }
    if (url.pathname === '/auth/v1/token' && request.method() === 'POST') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(session) });
      return;
    }
    if (url.pathname === '/auth/v1/user' && request.method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(session.user) });
      return;
    }
    if (url.pathname === '/rest/v1/kanban_state' && request.method() === 'GET') {
      const rows = remoteState ? [{ user_id: userId, state: remoteState }] : [];
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows) });
      return;
    }
    if (url.pathname === '/rest/v1/notifications' && request.method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      return;
    }
    if (url.pathname === '/rest/v1/kanban_profiles' && request.method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      return;
    }
    if (url.pathname === '/rest/v1/kanban_state' && request.method() === 'POST') {
      writes.push(request.postDataJSON());
      await route.fulfill({ status: 201, body: '' });
      return;
    }

    unexpectedRequests.push(`${request.method()} ${url.pathname}`);
    await route.fulfill({ status: 501, contentType: 'application/json', body: '{"error":"Unexpected mocked request"}' });
  });

  return { writes, unexpectedRequests };
}

try {
  const loginPage = await browser.newPage();
  const pageErrors = [];
  loginPage.on('pageerror', (error) => pageErrors.push(error.message));
  const emptyBoardMocks = installSupabaseMocks(loginPage);

  await loginPage.goto(`${origin}/`);
  if (!(await loginPage.locator('#authScreen').isVisible())) {
    throw new Error('The sign-in screen did not appear on startup');
  }
  if (await loginPage.locator('.app').isVisible()) {
    throw new Error('The Kanban app should remain hidden before sign-in');
  }

  const initialSave = loginPage.waitForResponse((response) =>
    response.url().includes('/rest/v1/kanban_state') && response.request().method() === 'POST');
  await loginPage.locator('#authEmail').fill(session.user.email);
  await loginPage.locator('#authPassword').fill('mock-password');
  await loginPage.locator('#authSubmit').click();
  await loginPage.locator('.app').waitFor({ state: 'visible' });
  await initialSave;
  if (await loginPage.locator('#authScreen').isVisible()) {
    throw new Error('The sign-in screen remained visible after mocked sign-in');
  }

  const remoteState = {
    data: [{
      name: 'Smoke project',
      tasks: [{
        id: 4242,
        title: 'Persisted smoke task',
        start: '',
        end: '',
        status: 'В работе',
        owner: '',
        description: 'Original description',
        comment: '',
        link: '',
        mt: '',
      }],
    }],
    projectMeta: {},
    standaloneTasks: [],
    members: [],
  };
  const restorePage = await browser.newPage();
  restorePage.on('pageerror', (error) => pageErrors.push(error.message));
  const restoreMocks = installSupabaseMocks(restorePage, remoteState);
  await restorePage.addInitScript((savedSession) => {
    localStorage.setItem('fintech-kanban-session', JSON.stringify(savedSession));
  }, session);
  await restorePage.goto(`${origin}/`);
  await restorePage.locator('.app').waitFor({ state: 'visible' });

  const taskCard = restorePage.locator('article.task[data-id="4242"]');
  if (!(await taskCard.getByText('Persisted smoke task', { exact: true }).isVisible())) {
    throw new Error('The task from mocked cloud state was not restored onto the board');
  }

  const overdueChecks = await restorePage.evaluate(() => ({
    shortYearPast: isPast('08.10.20'),
    longYearPast: isPast('08.10.2020'),
    shortYearFuture: isPast('08.10.99'),
    noDate: isPast(''),
    sortKey: dateKey('08.10.26'),
  }));
  if (!overdueChecks.shortYearPast || !overdueChecks.longYearPast || overdueChecks.shortYearFuture || overdueChecks.noDate
    || overdueChecks.sortKey !== '2026-10-08') {
    throw new Error(`Overdue date detection is wrong: ${JSON.stringify(overdueChecks)}`);
  }
  if (await restorePage.evaluate(() => [...document.querySelectorAll('[data-theme-option], #themeToggle option')].some((o) => o.value === 'dota'))) {
    throw new Error('The removed Dota theme is still offered');
  }

  await restorePage.evaluate(() => openTask(4242));
  await restorePage.locator('#dDescription').fill('Updated by smoke test');
  const savedResponse = restorePage.waitForResponse((response) =>
    response.url().includes('/rest/v1/kanban_state') && response.request().method() === 'POST', { timeout: 3000 })
    .catch(() => null);
  if (!(await restorePage.locator('#drawer').evaluate((drawer) => drawer.classList.contains('open')))) {
    throw new Error('The task drawer did not open after selecting the restored task');
  }
  await restorePage.locator('#saveTask').evaluate((button) => button.click());
  const response = await savedResponse;
  if (!response) {
    throw new Error('No mocked cloud save request was sent after editing the task');
  }
  const savedState = response.request().postDataJSON()?.state;
  const savedTask = savedState?.data?.find((project) => project.name === 'Smoke project')?.tasks
    ?.find((task) => task.id === 4242);
  if (savedTask?.description !== 'Updated by smoke test') {
    throw new Error('The updated task description was not included in the mocked cloud save');
  }

  if (emptyBoardMocks.unexpectedRequests.length || restoreMocks.unexpectedRequests.length) {
    throw new Error(`Unexpected network requests: ${[...emptyBoardMocks.unexpectedRequests, ...restoreMocks.unexpectedRequests].join('; ')}`);
  }
  if (emptyBoardMocks.writes.length !== 1 || restoreMocks.writes.length !== 1) {
    throw new Error('Expected exactly one initial empty-board write and one edited-board write');
  }
  if (pageErrors.length) {
    throw new Error(`Browser page errors: ${pageErrors.join('; ')}`);
  }

  console.log('Smoke OK: startup/login, existing cloud-state restore, edited-state save, strict network mocks, and no page errors');
} finally {
  await browser.close();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

