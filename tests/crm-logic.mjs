// node --experimental-strip-types tests/crm-logic.mjs
import assert from 'node:assert/strict';
const { normalizeComment, buildComment, normalizeTask, buildPatch, buildCreate, buildChecklist, dateOnly, offsetOf, ymdInZone, hmInZone } = await import('../supabase/functions/crm-sync/logic.ts');

// Даты: SQL DATE как полночь сервера в любом поясе, due_at в поясе задачи.
assert.equal(dateOnly('2026-11-10T00:00:00.000Z'), '2026-11-10');
assert.equal(dateOnly('2026-11-09T19:00:00.000Z'), '2026-11-10');
assert.equal(dateOnly('2026-11-10'), '2026-11-10');
assert.equal(dateOnly(null), '');
assert.equal(offsetOf('Asia/Yekaterinburg', '2026-11-10'), '+05:00');
assert.equal(ymdInZone('2026-11-10T20:00:00.000Z', 'Asia/Yekaterinburg'), '2026-11-11');
assert.equal(hmInZone('2026-11-10T13:00:00.000Z', 'Asia/Yekaterinburg'), '18:00');

const t = normalizeTask({ id: '501', product_id: 7, title: 'Смета', description: 'x', status: 'waiting', priority: 9, due_date: '2026-11-10T00:00:00.000Z', due_at: '2026-11-10T13:00:00.000Z', due_timezone: 'Asia/Yekaterinburg', assignee_name: 'Валентин', creator_name: 'Сергей', protocol_id: '35', version: 7, archived_at: null, comment_count: 2, password: 'leak' });
assert.deepEqual([t.id, t.productId, t.status, t.priority, t.due, t.dueTime, t.requester, t.protocolId, t.version, t.archived], ['501', 7, 'waiting', 5, '2026-11-10', '18:00', 'Сергей', '35', 7, false]);
assert.equal('password' in t, false, 'Unknown fields are dropped');
assert.equal(normalizeTask({ id: 1, status: 'weird', due_timezone: 'Nope/Zone' }).status, 'new');
assert.equal(normalizeTask({ id: 1, due_timezone: 'Nope/Zone' }).dueTz, 'Asia/Yekaterinburg');
assert.equal(normalizeTask(null), null);

// PATCH: версия обязательна, точное время сохраняется при смене даты.
assert.ok('error' in buildPatch({}, { status: 'done' }));
assert.ok('error' in buildPatch({ version: 3 }, {}));
assert.ok('error' in buildPatch({ version: 3 }, { status: 'closed' }));
assert.deepEqual(buildPatch({ version: 3 }, { status: 'done', title: ' Новое ' }).body, { version: 3, status: 'done', title: 'Новое' });
assert.deepEqual(buildPatch({ version: 3, dueTime: '18:00', dueTz: 'Asia/Yekaterinburg' }, { due: '2026-11-12' }).body, { version: 3, dueAt: '2026-11-12T18:00:00+05:00', dueTimezone: 'Asia/Yekaterinburg' });
assert.deepEqual(buildPatch({ version: 3 }, { due: '2026-11-12' }).body, { version: 3, dueDate: '2026-11-12' });
assert.deepEqual(buildPatch({ version: 3, dueTime: '18:00' }, { due: '' }).body, { version: 3, dueAt: null, repeat: 'none', dueDate: null, startDate: null });
assert.ok('error' in buildPatch({ version: 3 }, { due: '12.11.2026' }));

// Создание: ключ операции, ответственный — числовой ID CRM.
assert.ok('error' in buildCreate({ title: 'a' }));
assert.ok('error' in buildCreate({ requestKey: 'kanban-0000000001', title: ' ' }));
assert.ok('error' in buildCreate({ requestKey: 'kanban-0000000001', title: 'a', assignedTo: '1; drop' }));
assert.deepEqual(buildCreate({ requestKey: 'kanban-0000000001', title: 'Проверить', assignedTo: '102', due: '2026-11-10', description: 'd' }).body, { requestKey: 'kanban-0000000001', title: 'Проверить', status: 'new', priority: 3, description: 'd', assignedTo: '102', dueDate: '2026-11-10' });
assert.deepEqual(normalizeComment({ id: 700, body: ' Привет ', created_at: '2026-10-28T11:00:00Z', created_by: 101, author_name: 'Иван', secret: 'x' }), { id: '700', body: 'Привет', createdAt: '2026-10-28T11:00:00Z', author: 'Иван', by: '101' });
assert.equal(normalizeComment({ id: 1, body: '  ' }), null);
assert.ok('error' in buildComment({ body: 'x' }));
assert.ok('error' in buildComment({ requestKey: 'kanban-0000000001', body: ' ' }));
assert.deepEqual(buildComment({ requestKey: 'kanban-0000000001', body: ' Ок ' }).body, { requestKey: 'kanban-0000000001', body: 'Ок' });

// Дата начала: в PATCH и при создании (только вместе со сроком и не позже него).
assert.deepEqual(buildPatch({ version: 3 }, { start: '2026-11-01' }).body, { version: 3, startDate: '2026-11-01' });
assert.deepEqual(buildPatch({ version: 3 }, { start: '' }).body, { version: 3, startDate: null });
assert.ok('error' in buildPatch({ version: 3 }, { start: '01.11.2026' }));
assert.equal(normalizeTask({ id: 1, start_date: '2026-11-01T00:00:00.000Z' }).start, '2026-11-01');
assert.equal(normalizeTask({ id: 1 }).start, '');
const cr = buildCreate({ requestKey: 'kanban-0000000001', title: 'A', due: '2026-11-10', start: '2026-11-01', status: 'active', checklist: [' один ', '', 'два'] });
assert.deepEqual([cr.body.startDate, cr.body.status, cr.items], ['2026-11-01', 'active', ['один', 'два']]);
assert.equal('startDate' in buildCreate({ requestKey: 'kanban-0000000001', title: 'A', start: '2026-11-01' }).body, false);
assert.equal('startDate' in buildCreate({ requestKey: 'kanban-0000000001', title: 'A', due: '2026-10-01', start: '2026-11-01' }).body, false);
assert.equal(buildCreate({ requestKey: 'kanban-0000000001', title: 'A', status: 'cancelled' }).body.status, 'new');

// Чек-лист: список в карточке и в списке (счётчики), операции над пунктами.
const withList = normalizeTask({ id: 1, checklist: [{ id: 5, title: ' Пункт ', completed: true }, { id: 6, text: 'Второй' }, { id: 7, title: 'Удалён', deleted_at: '2026-10-28' }, { title: 'без id' }] });
assert.deepEqual(withList.checklist, [{ id: '5', title: 'Пункт', completed: true }, { id: '6', title: 'Второй', completed: false }]);
assert.deepEqual([withList.clTotal, withList.clDone], [2, 1]);
const preview = normalizeTask({ id: 1, checklist_total: 3, checklist_done: 1, checklist_preview: [] });
assert.deepEqual([preview.checklist, preview.clTotal, preview.clDone], [null, 3, 1]);
assert.deepEqual(buildChecklist({ op: 'add', version: 4, requestKey: 'kanban-0000000001-c0', title: ' Новый ' }), { method: 'POST', suffix: '', body: { version: 4, requestKey: 'kanban-0000000001-c0', title: 'Новый' } });
assert.deepEqual(buildChecklist({ op: 'set', version: 4, itemId: '602', completed: true }), { method: 'PATCH', suffix: '/602', body: { version: 4, completed: true } });
assert.deepEqual(buildChecklist({ op: 'delete', version: 4, itemId: '602' }), { method: 'PATCH', suffix: '/602', body: { version: 4, deleted: true } });
assert.ok('error' in buildChecklist({ op: 'set', version: 0, itemId: '602' }));
assert.ok('error' in buildChecklist({ op: 'set', version: 4, itemId: '6/../' }));
assert.ok('error' in buildChecklist({ op: 'add', version: 4, requestKey: 'short', title: 'x' }));
assert.ok('error' in buildChecklist({ op: 'nope', version: 4 }));
console.log('CRM logic OK');
