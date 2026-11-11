// Run with: node --experimental-strip-types tests/crm-credentials.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { cleanCreds, decryptSecret, encryptSecret } from '../supabase/functions/crm-sync/creds.ts';

const KEY = 'test-key-not-a-real-secret-0123456789';
const blob = await encryptSecret('p@ss w0rd: «пароль»', KEY);
assert.ok(blob.startsWith('v1.') && !blob.includes('p@ss') && !blob.includes('пароль'), 'Ciphertext does not contain the password');
assert.equal(await decryptSecret(blob, KEY), 'p@ss w0rd: «пароль»', 'Round trip');
assert.notEqual(await encryptSecret('same', KEY), await encryptSecret('same', KEY), 'Random IV: same text encrypts differently');
await assert.rejects(() => decryptSecret(blob, 'another-key-not-a-real-secret-99999'), 'Wrong key fails');
await assert.rejects(() => decryptSecret(blob.slice(0, -4) + 'AAAA', KEY), 'Tampered data fails');
await assert.rejects(() => decryptSecret('garbage', KEY), 'Bad format fails');
await assert.rejects(() => encryptSecret('x', 'short'), 'Short key rejected');

assert.deepEqual(cleanCreds('  user  ', 'pw'), { login: 'user', password: 'pw' });
assert.ok('error' in cleanCreds('', 'pw') && 'error' in cleanCreds('u', '') && 'error' in cleanCreds(1, 2));
assert.ok('error' in cleanCreds('u'.repeat(201), 'pw') && 'error' in cleanCreds('u', 'p'.repeat(201)));

// В исходниках нет вывода пароля в логи, а таблица закрыта от клиентов.
const src = await readFile('supabase/functions/crm-sync/index.ts', 'utf8');
assert.ok(!/console\.(log|error|warn)\([^)]*(password|c\.password|crmPassword)/i.test(src), 'Password is never logged');
const mig = await readFile('supabase/migrations/20261111120000_crm_credentials.sql', 'utf8');
assert.ok(/enable row level security/.test(mig) && /revoke all on public\.crm_credentials from anon, authenticated/.test(mig) && !/create policy/i.test(mig), 'Table is closed to clients');
console.log('CRM credentials OK: encryption, validation, no logging, closed table');
