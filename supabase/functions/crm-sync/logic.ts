// Чистая логика синхронизации с CRM «Этажи» без Deno и сети.
// Ответы CRM считаются внешними данными: каждое поле приводится к типу и обрезается.

export const CRM_STATUSES = ["new", "active", "waiting", "done", "cancelled"] as const;
export const DEFAULT_TZ = "Asia/Yekaterinburg";
const str = (v: unknown, n: number) => String(v ?? "").slice(0, n);

export function validTz(tz: unknown): string {
  const s = String(tz ?? "");
  if (!s) return DEFAULT_TZ;
  try { new Intl.DateTimeFormat("en-CA", { timeZone: s }); return s; } catch { return DEFAULT_TZ; }
}

// Календарная дата момента в часовом поясе: YYYY-MM-DD.
export function ymdInZone(iso: unknown, tz: string): string {
  const d = new Date(String(iso ?? ""));
  if (isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
export function hmInZone(iso: unknown, tz: string): string {
  const d = new Date(String(iso ?? ""));
  if (isNaN(d.getTime())) return "";
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d);
  const h = p.find((x) => x.type === "hour")?.value ?? "00", m = p.find((x) => x.type === "minute")?.value ?? "00";
  return `${h}:${m}`;
}
// Смещение пояса на указанный день: "+05:00".
export function offsetOf(tz: string, ymd: string): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  const name = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "longOffset" }).formatToParts(d).find((x) => x.type === "timeZoneName")?.value ?? "GMT";
  const m = name.match(/GMT([+-]\d{2}):?(\d{2})?/);
  return m ? `${m[1]}:${m[2] ?? "00"}` : "+00:00";
}
// SQL DATE приходит как полночь по часовому поясу сервера CRM: сдвиг на 12 часов даёт верную дату при любом смещении до ±12 ч.
export function dateOnly(v: unknown): string {
  const s = String(v ?? "");
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (isNaN(d.getTime())) return "";
  return new Date(d.getTime() + 12 * 3600_000).toISOString().slice(0, 10);
}

export type CrmTask = {
  id: string; productId: number; title: string; description: string; status: string; priority: number;
  due: string; dueTime: string; dueTz: string; assignee: string; requester: string; protocolId: string;
  version: number; createdAt: string; updatedAt: string; archived: boolean; comments: number;
};

export function normalizeTask(t: any): CrmTask | null {
  if (!t || typeof t !== "object" || t.id === undefined || t.id === null) return null;
  const tz = validTz(t.due_timezone);
  const status = CRM_STATUSES.includes(t.status) ? String(t.status) : "new";
  return {
    id: str(t.id, 40),
    productId: Number(t.product_id) || 0,
    title: str(t.title, 200),
    description: str(t.description, 10000),
    status,
    priority: Math.min(5, Math.max(1, Number(t.priority) || 3)),
    due: t.due_at ? ymdInZone(t.due_at, tz) : dateOnly(t.due_date),
    dueTime: t.due_at ? hmInZone(t.due_at, tz) : "",
    dueTz: tz,
    assignee: str(t.assignee_name, 100),
    requester: str(t.requester_name || t.creator_name, 100),
    protocolId: t.protocol_id ? str(t.protocol_id, 40) : "",
    version: Number(t.version) || 0,
    createdAt: str(t.created_at, 40),
    updatedAt: str(t.updated_at, 40),
    archived: !!t.archived_at,
    comments: Number(t.comment_count) || 0,
  };
}

export type UpdateFields = { title?: string; description?: string; status?: string; due?: string };
export type Base = { version: number; dueTime?: string; dueTz?: string };

// Проверка запроса клиента на изменение и сборка тела PATCH для CRM.
export function buildPatch(base: Base, fields: UpdateFields): { body: Record<string, unknown> } | { error: string } {
  const version = Number(base?.version);
  if (!Number.isSafeInteger(version) || version < 1) return { error: "Нет версии задачи." };
  const body: Record<string, unknown> = { version };
  const f = fields && typeof fields === "object" ? fields : {};
  if (typeof f.title === "string") { const t = f.title.trim().slice(0, 200); if (!t) return { error: "Пустое название." }; body.title = t; }
  if (typeof f.description === "string") body.description = f.description.slice(0, 10000);
  if (typeof f.status === "string") { if (!CRM_STATUSES.includes(f.status as any)) return { error: "Неизвестный статус." }; body.status = f.status; }
  if (typeof f.due === "string") {
    const due = f.due.trim();
    const tz = validTz(base.dueTz);
    const time = /^\d{2}:\d{2}$/.test(String(base.dueTime ?? "")) ? String(base.dueTime) : "";
    if (!due) {
      if (time) { body.dueAt = null; body.repeat = "none"; }
      body.dueDate = null;
    } else {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(due) || isNaN(new Date(due + "T00:00:00Z").getTime())) return { error: "Неверная дата." };
      if (time) { body.dueAt = `${due}T${time}:00${offsetOf(tz, due)}`; body.dueTimezone = tz; }
      else body.dueDate = due;
    }
  }
  if (Object.keys(body).length < 2) return { error: "Нечего менять." };
  return { body };
}

export type CreateInput = { requestKey?: string; title?: string; description?: string; assignedTo?: string; due?: string };
export function buildCreate(input: CreateInput): { body: Record<string, unknown> } | { error: string } {
  const key = String(input?.requestKey ?? "");
  if (!/^[A-Za-z0-9_-]{12,128}$/.test(key)) return { error: "Нет ключа операции." };
  const title = String(input?.title ?? "").trim().slice(0, 200);
  if (!title) return { error: "Пустое название." };
  const body: Record<string, unknown> = { requestKey: key, title, status: "new", priority: 3 };
  const desc = String(input?.description ?? "").slice(0, 10000);
  if (desc.trim()) body.description = desc;
  const who = String(input?.assignedTo ?? "").trim();
  if (who) { if (!/^\d{1,20}$/.test(who)) return { error: "Неверный ответственный." }; body.assignedTo = who; }
  const due = String(input?.due ?? "").trim();
  if (due) { if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) return { error: "Неверная дата." }; body.dueDate = due; }
  return { body };
}

export type CrmComment = { id: string; body: string; createdAt: string; author: string; by: string };
export function normalizeComment(c: any): CrmComment | null {
  if (!c || typeof c !== "object" || c.id === undefined || c.id === null) return null;
  const body = str(c.body, 4000).trim();
  if (!body) return null;
  return { id: str(c.id, 40), body, createdAt: str(c.created_at, 40), author: str(c.author_name || c.creator_name || c.created_by_name, 100), by: str(c.created_by, 40) };
}

export function buildComment(input: { requestKey?: string; body?: string }): { body: Record<string, unknown> } | { error: string } {
  const key = String(input?.requestKey ?? "");
  if (!/^[A-Za-z0-9_-]{12,128}$/.test(key)) return { error: "Нет ключа операции." };
  const text = String(input?.body ?? "").trim().slice(0, 4000);
  if (!text) return { error: "Пустой комментарий." };
  return { body: { requestKey: key, body: text } };
}
