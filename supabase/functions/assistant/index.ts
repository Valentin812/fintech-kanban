import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildContext, cleanMessages, knownTaskIds, sanitizeReply, SYSTEM_PROMPT } from "./logic.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const gigaKey = Deno.env.get("GIGACHAT_AUTH_KEY") ?? "";
const gigaModel = Deno.env.get("GIGACHAT_MODEL") ?? "GigaChat-2-Max";
const gigaScope = Deno.env.get("GIGACHAT_SCOPE") ?? "GIGACHAT_API_PERS";
const gigaApi = (Deno.env.get("GIGACHAT_API_URL") ?? "https://api.giga.chat/v1").replace(/\/+$/, "");
const gigaOauth = Deno.env.get("GIGACHAT_OAUTH_URL") ?? "https://ngw.devices.sberbank.ru:9443/api/v2/oauth";
const gigaCa = Deno.env.get("GIGACHAT_CA_PEM") ?? "";
const allowedOrigin = Deno.env.get("ASSISTANT_ALLOWED_ORIGIN") ?? "https://valentin812.github.io";
const db = createClient(supabaseUrl, serviceRoleKey);

const cors = (extra: Record<string, string> = {}) => ({
  "Access-Control-Allow-Origin": allowedOrigin,
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  Vary: "Origin",
  ...extra,
});
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors({ "Content-Type": "application/json" }) });

let gigaClient: unknown;
function gigaFetch(url: string, init: RequestInit & Record<string, unknown>) {
  const deno = Deno as unknown as { createHttpClient?: (o: { caCerts: string[] }) => unknown };
  if (gigaCa && typeof deno.createHttpClient === "function") {
    gigaClient ??= deno.createHttpClient({ caCerts: [gigaCa] });
    return fetch(url, { ...init, client: gigaClient } as RequestInit);
  }
  return fetch(url, init);
}
let gigaToken: { value: string; expires: number } | null = null;
async function gigaAccessToken(): Promise<string | null> {
  if (gigaToken && gigaToken.expires - 60_000 > Date.now()) return gigaToken.value;
  const response = await gigaFetch(gigaOauth, {
    method: "POST",
    headers: { Authorization: `Basic ${gigaKey}`, RqUID: crypto.randomUUID(), "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ scope: gigaScope }).toString(),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) { console.error("GigaChat auth HTTP error:", response.status); return null; }
  const body = await response.json().catch(() => null);
  if (!body?.access_token) return null;
  gigaToken = { value: String(body.access_token), expires: Number(body.expires_at) || Date.now() + 25 * 60_000 };
  return gigaToken.value;
}

// Лимит запросов на пользователя (в памяти экземпляра функции — защита от случайного шквала).
const hits = new Map<string, number[]>();
const PER_HOUR = 40;
function allowed(userId: string) {
  const now = Date.now();
  const list = (hits.get(userId) ?? []).filter((t) => now - t < 3600_000);
  if (list.length >= PER_HOUR) { hits.set(userId, list); return false; }
  list.push(now);
  hits.set(userId, list);
  return true;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors() });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: auth } = token ? await db.auth.getUser(token) : { data: { user: null } };
  const user = auth?.user;
  if (!user) return json({ error: "Нужен вход в аккаунт." }, 401);
  const bannedUntil = (user as any).banned_until;
  if (bannedUntil && new Date(bannedUntil).getTime() > Date.now()) return json({ error: "Аккаунт заблокирован." }, 403);
  if (!gigaKey) return json({ error: "Ассистент пока не настроен." }, 503);
  if (!allowed(user.id)) return json({ error: "Слишком много запросов. Попробуй через несколько минут." }, 429);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Некорректный запрос." }, 400); }
  const messages = cleanMessages(body?.messages);
  if (!messages.length || messages[messages.length - 1].role !== "user") return json({ error: "Пустой запрос." }, 400);

  // Данные читаем на сервере по личности пользователя, а не из тела запроса.
  const { data: row } = await db.from("kanban_state").select("state").eq("user_id", user.id).maybeSingle();
  const state = row?.state ?? {};
  const today = new Date().toISOString().slice(0, 10);

  const gt = await gigaAccessToken();
  if (!gt) return json({ error: "Ассистент временно недоступен." }, 502);
  const chat = await gigaFetch(`${gigaApi}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${gt}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      model: gigaModel,
      temperature: 0.2,
      max_tokens: 1200,
      messages: [{ role: "system", content: SYSTEM_PROMPT + "\n\n" + buildContext(state, today) }, ...messages],
    }),
    signal: AbortSignal.timeout(50000),
  }).catch((e) => { console.error("GigaChat chat error:", String((e as Error)?.message ?? e).slice(0, 200)); return null; });
  if (!chat || !chat.ok) { console.error("GigaChat chat HTTP error:", chat?.status); return json({ error: "Ассистент временно недоступен." }, 502); }
  const answer = String((await chat.json().catch(() => null))?.choices?.[0]?.message?.content ?? "");
  return json(sanitizeReply(answer, knownTaskIds(state)));
});
