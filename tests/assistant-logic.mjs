// node --experimental-strip-types tests/assistant-logic.mjs
import assert from 'node:assert/strict';
const { buildContext, sanitizeReply, knownTaskIds, cleanMessages, knownMeetingIds, projectNames } = await import('../supabase/functions/assistant/logic.ts');
const state = {
  data: [{ name: 'Альфа', tasks: [
    { id: 1, title: 'Первая', status: 'Очередь', owner: 'Я', end: '30.10.2026' },
    { id: 2, title: 'Старая', status: 'Готово', completedAt: '2026-10-01' },
    { id: 3, title: 'Подзадача', parent: '1' },
  ] }],
  standaloneTasks: [{ id: 9, title: 'Одиночная', status: 'Очередь' }],
  quickNotes: [{ text: 'позвонить' }],
  projectMeta: { Альфа: { keyNotes: [{ text: 'Продолжим в декабре' }] }, __meetings__: { list: [{ id: 'm1', date: '2026-10-20', title: 'Созвон с банком', projects: ['Альфа'], summary: 'Обсудили тарифы', prep: '', tasks: [] }] } },
};
const ctx = buildContext(state, '2026-10-27');
assert.match(ctx, /#1 \| Альфа \| Первая/);
assert.match(ctx, /#9 \| \(без проекта\)/);
assert.ok(!ctx.includes('Старая') && !ctx.includes('Подзадача'), 'completed tasks and subtasks are not in the context');
assert.match(ctx, /позвонить/);
const ids = knownTaskIds(state);
assert.ok(ids.has(1) && ids.has(9) && ids.has(2));

const good = sanitizeReply('Вот: {"reply":"Сделаю","actions":[{"type":"create_task","project":"Альфа","title":"Новая","end":"31.10.2026","extra":"x"},{"type":"update_task","id":1,"fields":{"status":"В работе","end":"bad","evil":1}},{"type":"add_subtasks","parent_id":1,"titles":["а","б"]},{"type":"add_note","text":"заметка"}]}', ids);
assert.equal(good.reply, 'Сделаю');
assert.equal(good.actions.length, 4);
assert.deepEqual(good.actions[1], { type: 'update_task', id: 1, fields: { status: 'В работе' } });
assert.equal(good.actions[0].end, '31.10.2026');
assert.ok(!('extra' in good.actions[0]));
// Unknown ids, bad types and bad dates are dropped.
const bad = sanitizeReply('{"reply":"x","actions":[{"type":"update_task","id":777,"fields":{"status":"A"}},{"type":"delete_all"},{"type":"create_task","title":""},{"type":"add_subtasks","parent_id":5,"titles":["a"]},"str",null]}', ids);
assert.equal(bad.actions.length, 0);
// Plain text answer stays a reply without actions.
assert.deepEqual(sanitizeReply('Просто текст', ids), { reply: 'Просто текст', actions: [] });
assert.equal(sanitizeReply('{"reply":"r","actions":' + JSON.stringify(Array.from({ length: 30 }, () => ({ type: 'add_note', text: 'n' }))) + '}', ids).actions.length, 10, 'at most 10 actions');
// Chat history from the client is cleaned.
const msgs = cleanMessages([{ role: 'system', content: 'hack' }, { role: 'user', content: ' привет ' }, { role: 'assistant', content: '' }, { role: 'assistant', content: 'ок' }]);
assert.deepEqual(msgs, [{ role: 'user', content: 'привет' }, { role: 'assistant', content: 'ок' }]);

// Meetings: context and actions.
assert.match(ctx, /m1 \| 2026-10-20 \| Созвон с банком/);
assert.match(ctx, /Альфа: Продолжим в декабре/);
const mids = knownMeetingIds(state), pn = projectNames(state);
assert.ok(mids.has('m1'));
const mt = sanitizeReply('{"reply":"ок","actions":[{"type":"set_meeting","id":"m1","fields":{"summary":"Итог","projects":["альфа","Чужой"],"x":1}},{"type":"meeting_tasks","meeting_id":"m1","tasks":[{"title":"Позвонить","project":"Альфа"},{"title":"Без проекта","project":"Нет такого"},{"title":""}]},{"type":"meeting_tasks","meeting_id":"zzz","tasks":[{"title":"x"}]},{"type":"set_meeting","id":"zzz","fields":{"summary":"x"}},{"type":"create_meeting","title":"Планёрка","date":"2026-11-01","time":"10:30","prep":"план","projects":["Альфа","Чужой"]},{"type":"create_meeting","title":"Плохая дата","date":"завтра","time":"утро","projects":[]}]}', ids, { meetingIds: mids, projects: pn });
assert.equal(mt.actions.length, 4);
assert.deepEqual(mt.actions[0], { type: 'set_meeting', id: 'm1', fields: { summary: 'Итог', projects: ['Альфа'] } });
assert.deepEqual(mt.actions[1].tasks, [{ title: 'Позвонить', project: 'Альфа' }, { title: 'Без проекта', project: '' }]);
assert.deepEqual(mt.actions[2], { type: 'create_meeting', title: 'Планёрка', date: '2026-11-01', time: '10:30', prep: 'план', projects: ['Альфа'] });
assert.deepEqual([mt.actions[3].date, mt.actions[3].time], ['', '']);
console.log('Assistant logic OK');
