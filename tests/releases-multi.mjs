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
const REL = []; let relN = 0;
const grpFilter = (url) => { const t = url.searchParams.get('tags'); const m = t && /^cs\.\{(.+)\}$/.exec(t); return m ? m[1] : null; };
try {
  const context = await browser.newContext({ viewport: { width: 1300, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  await page.route('**/*', async (route) => {
    const request = route.request(); const url = new URL(request.url());
    if (url.origin === origin) return route.continue();
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.origin !== 'https://vdlfdnhfiiltdyrucdtn.supabase.co') return route.abort();
    if (url.pathname === '/auth/v1/user') return json(session.user);
    if (url.pathname === '/rest/v1/kanban_state' && request.method() === 'GET') return json([{ user_id: ME, state: remoteState }]);
    if (url.pathname === '/rest/v1/kanban_state') return route.fulfill({ status: 201, body: '' });
    if (url.pathname === '/rest/v1/project_releases') {
      const m = request.method();
      if (m === 'GET') {
        const pn = (url.searchParams.get('project_name') || '').replace(/^eq\./, '');
        return json(REL.filter((r) => !pn || r.project_name === pn));
      }
      if (m === 'POST') { const row = { id: 'rel-' + (++relN), owner_id: ME, created_at: new Date().toISOString(), file_path: null, file_name: null, file_type: null, file_size: null, shared_project_id: null, ...request.postDataJSON() }; REL.push(row); return json([row], 201); }
      const g = grpFilter(url); const id = (url.searchParams.get('id') || '').replace('eq.', '');
      const hit = REL.filter((r) => (g ? (r.tags || []).includes(g) : r.id === id));
      if (m === 'PATCH') { hit.forEach((r) => Object.assign(r, request.postDataJSON())); return json(hit); }
      if (m === 'DELETE') { hit.forEach((r) => REL.splice(REL.indexOf(r), 1)); return json(hit.map((r) => ({ id: r.id }))); }
    }
    if (url.pathname === '/functions/v1/admin-users') return json({ error: 'F' }, 403);
    if (url.pathname.startsWith('/rest/v1/')) return json([]);
    return json({}, 501);
  });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript((s) => localStorage.setItem('fintech-kanban-session', JSON.stringify(s)), session);
  await page.goto(`${origin}/`);
  await page.locator('.app').waitFor({ state: 'visible' });

  // The global «Релизы» section: no project header, pick several projects.
  await page.locator('#releasesNav').click();
  await page.locator('#releasesView').waitFor({ state: 'visible' });
  assert(await page.locator('#projectHeader').isHidden(), 'Global releases hide the project header');
  await page.locator('[data-rl-new]').click();
  await page.locator('#rlPaste').fill('Релиз 2.0\nНовая оплата и отчёты\n- Добавлена оплата\n- Исправлены отчёты');
  await page.locator('[data-rl-analyze]').click();
  await page.locator('[data-rl-proj="Альфа"]').check();
  await page.locator('[data-rl-proj="Гамма"]').check();
  await page.locator('[data-rl-save]').click();
  await page.locator('.rl-card').first().waitFor();
  assert(REL.length === 2 && REL.every((r) => (r.tags || []).some((t) => t.startsWith('grp:'))), 'One row per chosen project with a shared group: ' + JSON.stringify(REL.map((r) => [r.project_name, r.tags])));
  assert(new Set(REL.map((r) => r.project_name)).size === 2 && !REL.some((r) => r.project_name === 'Бета'), 'Only the chosen projects');
  assert(await page.locator('#releasesView .rl-card').count() === 1, 'The global list shows the release once');
  const chips = await page.locator('#releasesView .rl-proj').allTextContents();
  assert(chips.some((c) => c.includes('Альфа')) && chips.some((c) => c.includes('Гамма')), 'The global card lists both projects: ' + chips);
  assert(!(await page.locator('#releasesView .rl-tags').allTextContents()).join('').includes('grp:'), 'Service tags stay hidden');

  // Each project sees it in its own «Релизы» tab; Бета does not.
  for (const [name, expectCount, other] of [['Альфа', 1, 'Гамма'], ['Гамма', 1, 'Альфа'], ['Бета', 0, '']]) {
    await page.locator(`#projects .project[data-project="${name}"]`).click();
    await page.locator('.tab[data-view="releases"]').click();
    await page.waitForTimeout(150);
    assert(await page.locator('#projectHeader').isVisible(), 'The project header is back in a project');
    assert(await page.locator('#releasesView .rl-card').count() === expectCount, `${name}: releases visible = ${expectCount}`);
    if (other) assert((await page.locator('#releasesView .rl-proj').allTextContents()).join(' ').includes(other), `${name}: shows «also: ${other}»`);
  }

  // Edit applies to every project of the release; delete too.
  await page.locator('#projects .project[data-project="Альфа"]').click();
  await page.locator('.tab[data-view="releases"]').click();
  await page.locator('[data-rl-open]').first().click();
  await page.locator('[data-rl-edit]').first().click();
  await page.locator('#rlETitle').fill('Релиз 2.1');
  await page.locator('[data-rl-saveedit]').first().click();
  await page.waitForTimeout(200);
  assert(REL.every((r) => r.title === 'Релиз 2.1'), 'Edit reached every copy: ' + JSON.stringify(REL.map((r) => r.title)));
  assert(REL.every((r) => (r.tags || []).some((t) => t.startsWith('grp:'))), 'Service tags survive an edit');
  await page.locator('[data-rl-open]').first().click().catch(() => {});
  await page.locator('[data-rl-askdel]').first().click();
  await page.locator('[data-rl-delete]').first().click();
  await page.waitForTimeout(200);
  assert(REL.length === 0, 'Delete removed every copy');
  assert(!errors.length, 'Page errors: ' + errors.join('; '));
  console.log('Releases multi-project OK: global section, several projects, shown in each, edit/delete for all');
} finally {
  await browser.close();
  await new Promise((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
}
