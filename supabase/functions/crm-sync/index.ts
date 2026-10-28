// Синхронизация задач с CRM «Этажи» через её API (код CRM не меняется).
// Вход в CRM — логин и пароль владельца из секретов функции; токен CRM не покидает сервер.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildCreate, buildPatch, normalizeTask } from "./logic.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const crmBase = (Deno.env.get("CRM_BASE_URL") ?? "https://samsonovtsi-chat-713b.twc1.net").replace(/\/+$/, "");
const crmLogin = Deno.env.get("CRM_LOGIN") ?? "";
const crmPassword = Deno.env.get("CRM_PASSWORD") ?? "";
const allowedEmail = (Deno.env.get("CRM_ALLOWED_EMAIL") ?? "").trim().toLowerCase();
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

class CrmError extends Error { constructor(public status: number, message: string, public body: any = null) { super(message); } }

let crmToken: { value: string; expires: number } | null = null;
async function login(): Promise<string> {
  const r = await fetch(`${crmBase}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ login: crmLogin, password: crmPassword }),
    signal: AbortSignal.timeout(15000),
  });
  const b = await r.json().catch(() => null);
  if (!r.ok || !b?.token) { console.error("CRM login failed:", r.status); throw new CrmError(502, r.status === 429 ? "CRM временно ограничила вход, попробуйте позже." : "Не удалось войти в CRM. Проверьте логин и пароль в секретах."); }
  crmToken = { value: String(b.token), expires: Date.now() + Math.max(60, Number(b.expiresIn) || 28800) * 1000 };
  return crmToken.value;
}
async function crm(path: string, init: { method?: string; product?: number; body?: unknown } = {}, retry = true): Promise<any> {
  const token = crmToken && crmToken.expires - 5 * 60_000 > Date.now() ? crmToken.value : await login();
  const headers: Record<string, string> = { Authorization: `Bearer ${token}`, Accept: "application/json" };
  if (init.product) headers["X-Product-Id"] = String(init.product);
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  const r = await fetch(`${crmBase}${path}`, { method: init.method ?? "GET", headers, body: init.body === undefined ? undefined : JSON.stringify(init.body), signal: AbortSignal.timeout(20000) });
  if (r.status === 401 && retry) { crmToken = null; return crm(path, init, false); }
  const b = await r.json().catch(() => null);
  if (!r.ok) throw new CrmError(r.status, String(b?.error ?? `CRM: HTTP ${r.status}`).slice(0, 300), b);
  return b;
}

// Задачи, где владелец — основной или дополнительный ответственный; страницы по 50 через курсор before.
async function myTasks(product: number) {
  const seen = new Map<string, unknown>();
  let before = "", complete = false;
  for (let page = 0; page < 40; page++) {
    const q = `/api/tasks?scope=search&status=all&archived=false&assignee=mine${before ? `&before=${encodeURIComponent(before)}` : ""}`;
    const b = await crm(q, { product });
    const items = Array.isArray(b?.items) ? b.items : [];
    for (const it of items) { const t = normalizeTask(it); if (t) seen.set(t.id, t); }
    if (items.length < 50) { complete = true; break; }
    before = String(items[items.length - 1]?.id ?? "");
    if (!before) break;
  }
  return { tasks: [...seen.values()], complete };
}

const hits = new Map<string, number[]>();
function allowed(id: string) {
  const now = Date.now();
  const l = (hits.get(id) ?? []).filter((t) => now - t < 3600_000);
  if (l.length >= 240) { hits.set(id, l); return false; }
  l.push(now); hits.set(id, l); return true;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors() });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: auth } = token ? await db.auth.getUser(token) : { data: { user: null } };
  const user = auth?.user;
  if (!user) return json({ error: "Нужен вход в аккаунт." }, 401);
  if (!crmLogin || !crmPassword || !allowedEmail) return json({ error: "Интеграция с CRM не настроена.", disabled: true }, 503);
  // Интеграция личная: работает только для владельца учётки CRM.
  if (String(user.email ?? "").toLowerCase() !== allowedEmail) return json({ error: "Интеграция с CRM недоступна.", disabled: true }, 403);
  if (!allowed(user.id)) return json({ error: "Слишком много запросов к CRM." }, 429);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Некорректный запрос." }, 400); }
  const product = Number(body?.productId) || 0;
  try {
    if (body?.action === "pull") {
      const me = await crm("/api/me");
      const productsRaw = await crm("/api/products");
      const products = (Array.isArray(productsRaw) ? productsRaw : []).map((p: any) => ({ id: Number(p?.id) || 0, name: String(p?.name ?? "").slice(0, 80) })).filter((p) => p.id).slice(0, 20);
      const out = [];
      for (const p of products) {
        try { out.push({ ...p, ...(await myTasks(p.id)) }); }
        catch (e) { console.error("CRM pull failed for product", p.id, (e as Error).message); out.push({ ...p, tasks: [], complete: false }); }
      }
      return json({ me: { id: String(me?.id ?? ""), name: String(me?.name ?? "").slice(0, 100) }, crmUrl: crmBase, products: out });
    }
    if (body?.action === "update") {
      const id = String(body?.id ?? "");
      if (!/^\d{1,20}$/.test(id) || !product) return json({ error: "Нет задачи." }, 400);
      const built = buildPatch(body?.base, body?.fields);
      if ("error" in built) return json({ error: built.error }, 400);
      try {
        const t = await crm(`/api/tasks/${id}`, { method: "PATCH", product, body: built.body });
        return json({ task: normalizeTask(t) });
      } catch (e) {
        if (e instanceof CrmError && e.status === 409) {
          const fresh = await myTasks(product).catch(() => null);
          return json({ conflict: true, task: fresh?.tasks.find((t: any) => t.id === id) ?? null }, 409);
        }
        throw e;
      }
    }
    if (body?.action === "create") {
      if (!product) return json({ error: "Нет проекта." }, 400);
      const built = buildCreate(body);
      if ("error" in built) return json({ error: built.error }, 400);
      const r = await crm("/api/tasks", { method: "POST", product, body: built.body });
      return json({ task: normalizeTask(r?.task), duplicate: !!r?.duplicate });
    }
    if (body?.action === "operators") {
      if (!product) return json({ error: "Нет проекта." }, 400);
      const list = await crm("/api/operators", { product });
      return json({ operators: (Array.isArray(list) ? list : []).filter((o: any) => o?.active).map((o: any) => ({ id: String(o.id), name: String(o.name ?? "").slice(0, 100) })).slice(0, 500) });
    }
    return json({ error: "Неизвестное действие." }, 400);
  } catch (e) {
    const status = e instanceof CrmError ? (e.status >= 500 || e.status === 401 ? 502 : e.status) : 502;
    console.error("CRM error:", e instanceof CrmError ? e.status : "", String((e as Error)?.message ?? e).slice(0, 200));
    return json({ error: e instanceof CrmError ? e.message : "CRM недоступна." }, status);
  }
});
