// Проверка бота MAX без сети: логика берётся из handler.ts, всё внешнее подменено.
import { readFile } from 'node:fs/promises';
const { handleUpdate, matchProject, parseChoicePayload } = await import('../supabase/functions/max-bot/handler.ts');
function assert(c, m) { if (!c) throw new Error(m); }

// 1. parse.ts не должен разойтись с разбором в telegram-bot.
const tg = await readFile('supabase/functions/telegram-bot/index.ts', 'utf8');
const px = await readFile('supabase/functions/max-bot/parse.ts', 'utf8');
const section = tg.slice(tg.indexOf('type ParsedTask'), tg.indexOf('function toBase64'));
const norm = (s) => s.replace(/\s+/g, ' ').replace(/\bexport (function|const|type)/g, '$1').trim();
assert(norm(px).includes(norm(section)), 'max-bot/parse.ts разошёлся с разбором в telegram-bot');

// 2. Фейковое окружение.
function make({ accounts = {}, projects = [], banned = false, recent = 0 } = {}) {
  const s = { inbox: [], sent: [], answers: [], cleared: [], accounts: { ...accounts }, codes: {}, ready: [] };
  const d = {
    store: {
      async findAccount(id) { return s.accounts[id] ? { user_id: s.accounts[id] } : null; },
      async isBanned() { return banned; },
      async countRecent() { return recent; },
      async insertInbox(row) { const id = '11111111-1111-4111-8111-' + String(s.inbox.length + 1).padStart(12, '0'); s.inbox.push({ id, status: 'ready', consumed_at: null, ...row }); return id; },
      async projectNames() { return projects; },
      async consumeLinkCode(c) { const u = s.codes[c]; delete s.codes[c]; return u ? { user_id: u } : null; },
      async accountOfUser(u) { const e = Object.entries(s.accounts).find(([, v]) => v === u); return e ? { provider_user_id: e[0] } : null; },
      async upsertAccount(r) { s.accounts[r.provider_user_id] = r.user_id; return true; },
      async getInbox(id) { return s.inbox.find((r) => r.id === id) ?? null; },
      async markReady(id, name) { const r = s.inbox.find((x) => x.id === id); if (!r || r.status !== 'pending') return false; r.status = 'ready'; r.project_hint = name; s.ready.push(id); return true; },
    },
    async send(u, text, buttons) { s.sent.push({ u, text, buttons }); },
    async answer(id, n) { s.answers.push({ id, n }); },
    async clearButtons(id, text) { s.cleared.push({ id, text }); },
  };
  return { s, d };
}
const msg = (uid, text) => ({ update_type: 'message_created', message: { sender: { user_id: uid, is_bot: false }, body: { text } } });
const UID = 'U1';
const CODE = 'a'.repeat(24);

// не привязан
{ const { s, d } = make(); await handleUpdate(d, msg(7, 'Сделать отчёт'));
  assert(s.inbox.length === 0 && /подключ/i.test(s.sent[0].text), 'без привязки задача не должна создаваться'); }

// привязка по коду и по bot_started
{ const { s, d } = make(); s.codes[CODE] = UID; await handleUpdate(d, msg(7, CODE));
  assert(s.accounts['7'] === UID && /Готово/.test(s.sent[0].text), 'привязка по коду'); 
  await handleUpdate(d, msg(7, CODE)); assert(/недействител/.test(s.sent[1].text), 'повторный код не работает'); }
{ const { s, d } = make(); s.codes[CODE] = UID; await handleUpdate(d, { update_type: 'bot_started', user: { user_id: 8 }, payload: CODE });
  assert(s.accounts['8'] === UID, 'привязка через bot_started payload'); }
{ const { s, d } = make({ accounts: { 9: 'other' } }); s.codes[CODE] = UID; await handleUpdate(d, msg(9, CODE));
  assert(/другим аккаунтом/.test(s.sent[0].text) && s.accounts['9'] === 'other', 'чужой MAX не перепривязывается'); }

// задача с проектом
{ const { s, d } = make({ accounts: { 7: UID }, projects: ['Автооплата', 'Релизы'] });
  await handleUpdate(d, msg(7, 'Подготовить отчёт до 30.10 #Автооплата'));
  assert(s.inbox.length === 1 && s.inbox[0].project_hint === 'Автооплата' && s.inbox[0].user_id === UID, 'задача с #проект');
  assert(/проект «Автооплата»/.test(s.sent[0].text), 'ответ называет проект'); }

// задача без проекта → кнопки → выбор
{ const { s, d } = make({ accounts: { 7: UID }, projects: ['Автооплата', 'Релизы'] });
  await handleUpdate(d, msg(7, 'Позвонить в банк'));
  assert(s.inbox[0].status === 'pending' && s.sent[0].buttons.flat().length === 3, 'кнопки: 2 проекта + «Мои задачи»');
  const payload = s.sent[0].buttons[0][1].payload;
  assert(parseChoicePayload(payload)?.choice === 1, 'payload разбирается');
  await handleUpdate(d, { update_type: 'message_callback', callback: { callback_id: 'c1', user: { user_id: 7 }, payload } });
  assert(s.inbox[0].status === 'ready' && s.inbox[0].project_hint === 'Релизы', 'выбор проекта сохраняется');
  await handleUpdate(d, { update_type: 'message_callback', callback: { callback_id: 'c2', user: { user_id: 7 }, payload } });
  assert(/уже в Kanban/.test(s.cleared[1].text), 'повторное нажатие безопасно');
  // чужой пользователь
  await handleUpdate(d, { update_type: 'message_callback', callback: { callback_id: 'c3', user: { user_id: 99 }, payload } });
  assert(s.answers.at(-1).n === 'Эта задача не найдена.', 'чужая кнопка отклоняется'); }

// заметка, помощь, бан, лимит, команды, вложения, боты
{ const { s, d } = make({ accounts: { 7: UID } });
  await handleUpdate(d, msg(7, '/заметка перезвонить Азату'));
  assert(s.inbox[0].project_hint === '__note__' && s.inbox[0].title === 'перезвонить Азату', 'заметка'); }
{ const { s, d } = make({ accounts: { 7: UID } }); await handleUpdate(d, msg(7, '/help')); assert(/Как создать задачу/.test(s.sent[0].text), '/help'); }
{ const { s, d } = make({ accounts: { 7: UID }, banned: true }); await handleUpdate(d, msg(7, 'Задача')); assert(s.inbox.length === 0, 'бан'); }
{ const { s, d } = make({ accounts: { 7: UID }, recent: 60 }); await handleUpdate(d, msg(7, 'Задача')); assert(s.inbox.length === 0 && /Слишком много/.test(s.sent[0].text), 'лимит'); }
{ const { s, d } = make({ accounts: { 7: UID } }); await handleUpdate(d, msg(7, '/что-то')); assert(s.inbox.length === 0 && /Не знаю/.test(s.sent[0].text), 'неизвестная команда'); }
{ const { s, d } = make({ accounts: { 7: UID } });
  await handleUpdate(d, { update_type: 'message_created', message: { sender: { user_id: 7 }, body: { text: null, attachments: [{ type: 'image' }] } } });
  assert(/пока не поддерживаю/.test(s.sent[0].text) && !s.inbox.length, 'вложения');
  await handleUpdate(d, { update_type: 'message_created', message: { sender: { user_id: 5, is_bot: true }, body: { text: 'x' } } });
  assert(s.sent.length === 1, 'сообщения ботов игнорируются'); }

assert(matchProject('авто', ['Автооплата', 'Релизы']).name === 'Автооплата', 'matchProject по префиксу');
console.log('max-bot: OK');
