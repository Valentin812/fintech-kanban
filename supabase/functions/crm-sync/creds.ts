// Логин и пароль CRM, которые владелец вводит в приложении.
// Пароль хранится только зашифрованным (AES-GCM) ключом из секрета функции CRM_CRED_KEY;
// назад в браузер он не отдаётся и в логи не пишется.

const enc = new TextEncoder();
const dec = new TextDecoder();

export const MIN_KEY_LENGTH = 24;

function b64(u: Uint8Array): string {
  let s = "";
  for (let i = 0; i < u.length; i += 8192) s += String.fromCharCode(...u.subarray(i, i + 8192));
  return btoa(s);
}
function unb64(t: string): Uint8Array {
  return Uint8Array.from(atob(t), (c) => c.charCodeAt(0));
}

async function aesKey(secret: string): Promise<CryptoKey> {
  if (String(secret ?? "").length < MIN_KEY_LENGTH) throw new Error("CRM_CRED_KEY слишком короткий");
  const raw = await crypto.subtle.digest("SHA-256", enc.encode(secret));
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function encryptSecret(plain: string, secret: string): Promise<string> {
  const key = await aesKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(plain)));
  return `v1.${b64(iv)}.${b64(ct)}`;
}

export async function decryptSecret(blob: string, secret: string): Promise<string> {
  const [v, iv, ct] = String(blob ?? "").split(".");
  if (v !== "v1" || !iv || !ct) throw new Error("Неверный формат");
  const key = await aesKey(secret);
  return dec.decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, key, unb64(ct)));
}

export function cleanCreds(login: unknown, password: unknown): { login: string; password: string } | { error: string } {
  const l = typeof login === "string" ? login.trim() : "";
  const p = typeof password === "string" ? password : "";
  if (!l || l.length > 200) return { error: "Укажите логин (до 200 символов)." };
  if (!p || p.length > 200) return { error: "Укажите пароль (до 200 символов)." };
  return { login: l, password: p };
}
