// node --experimental-strip-types tests/crm-logic.mjs
import assert from 'node:assert/strict';
const { normalizeComment, buildComment, normalizeTask, buildPatch, buildCreate, dateOnly, offsetOf, ymdInZone, hmInZone } = await import('../supabase/functions/crm-sync/logic.ts');

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
assert.deepEqual(buildPatch({ version: 3, dueTime: '18:00' }, { due: '' }).body, { version: 3, dueAt: null, repeat: 'none', dueDate: null });
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
console.log('CRM logic OK');
