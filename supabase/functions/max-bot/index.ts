import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleUpdate, type Button, type Deps } from "./handler.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const botToken = Deno.env.get("MAX_BOT_TOKEN")!;
const webhookSecret = Deno.env.get("MAX_WEBHOOK_SECRET")!;
const maxApi = (Deno.env.get("MAX_API_URL") ?? "https://platform-api2.max.ru").replace(/\/+$/, "");
const db = createClient(supabaseUrl, serviceRoleKey);

async function maxFetch(path: string, body: unknown) {
  const response = await fetch(maxApi + path, {
    method: "POST",
    headers: { Authorization: botToken, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) console.error("MAX API failed:", path.split("?")[0], response.status);
  return response;
}

const deps: Deps = {
  store: {
    async findAccount(id) {
      const { data } = await db.from("messenger_accounts").select("user_id").eq("provider", "max").eq("provider_user_id", id).maybeSingle();
      return data ?? null;
    },
    async isBanned(userId) {
      const { data } = await db.auth.admin.getUserById(userId);
      const until = data?.user?.banned_until;
      return !!until && new Date(until).getTime() > Date.now();
    },
    async countRecent(userId, sinceIso) {
      const { count } = await db.from("telegram_inbox").select("id", { count: "exact", head: true }).eq("user_id", userId).gte("created_at", sinceIso);
      return count ?? 0;
    },
    async insertInbox(row) {
      const { data, error } = await db.from("telegram_inbox").insert(row).select("id").single();
      if (error || !data) { console.error("Inbox insert failed:", error?.message); return null; }
      return String(data.id);
    },
    async projectNames(userId) {
      const names: string[] = [];
      const { data: state } = await db.from("kanban_state").select("state").eq("user_id", userId).maybeSingle();
      for (const p of (state?.state?.data ?? []) as any[]) if (p?.name) names.push(String(p.name));
      const { data: memberships } = await db.from("shared_project_members").select("project_id").eq("user_id", userId);
      const ids = (memberships ?? []).map((m: any) => m.project_id);
      if (ids.length) {
        const { data: shared } = await db.from("shared_projects").select("name").in("id", ids);
        for (const p of shared ?? []) if (p?.name) names.push(String(p.name));
      }
      return names;
    },
    async consumeLinkCode(code) {
      // Атомарно: код можно использовать один раз и только пока он не просрочен.
      const { data } = await db.from("telegram_link_codes").update({ used_at: new Date().toISOString() })
        .eq("code", code).is("used_at", null).gt("expires_at", new Date().toISOString()).select("code,user_id").maybeSingle();
      return data ? { user_id: data.user_id } : null;
    },
    async accountOfUser(userId) {
      const { data } = await db.from("messenger_accounts").select("provider_user_id").eq("provider", "max").eq("user_id", userId).maybeSingle();
      return data ?? null;
    },
    async upsertAccount(row) {
      const { error } = await db.from("messenger_accounts").upsert(
        { user_id: row.user_id, provider: "max", provider_user_id: row.provider_user_id, username: row.username, linked_at: new Date().toISOString() },
        { onConflict: "user_id,provider" },
      );
      if (error) console.error("Link account failed:", error.message);
      return !error;
    },
    async getInbox(id) {
      const { data } = await db.from("telegram_inbox").select("id,user_id,title,status,consumed_at,choices").eq("id", id).maybeSingle();
      return data ?? null;
    },
    async markReady(id, projectName) {
      const { data } = await db.from("telegram_inbox").update({ project_hint: projectName, status: "ready" })
        .eq("id", id).eq("status", "pending").is("consumed_at", null).select("id");
      return !!data?.length;
    },
  },
  async send(userId: string, text: string, buttons?: Button[][]) {
    const body: Record<string, unknown> = { text: text.slice(0, 3900) };
    if (buttons?.length) body.attachments = [{ type: "inline_keyboard", payload: { buttons } }];
    await maxFetch(`/messages?user_id=${encodeURIComponent(userId)}&disable_link_preview=true`, body);
  },
  async answer(callbackId: string, notification: string) {
    await maxFetch(`/answers?callback_id=${encodeURIComponent(callbackId)}`, { notification });
  },
  async clearButtons(callbackId: string, text: string) {
    // Заменяем сообщение с кнопками на итог и убираем кнопки.
    await maxFetch(`/answers?callback_id=${encodeURIComponent(callbackId)}`, { message: { text: text.slice(0, 3900), attachments: [] } });
  },
};

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  // Защищённый режим настройки: подписывает бота на события MAX.
  if (webhookSecret && req.headers.get("x-setup-secret") === webhookSecret) {
    const response = await maxFetch("/subscriptions", {
      url: `${supabaseUrl}/functions/v1/max-bot`,
      update_types: ["message_created", "message_callback", "bot_started"],
      secret: webhookSecret,
    });
    const result = await response.json().catch(() => ({}));
    return Response.json(result, { status: response.ok ? 200 : 502 });
  }

  if (!webhookSecret || req.headers.get("x-max-bot-api-secret") !== webhookSecret) {
    return new Response("Unauthorized", { status: 401 });
  }

  let update: any;
  try { update = await req.json(); } catch { return new Response("Invalid JSON", { status: 400 }); }

  try { await handleUpdate(deps, update); } catch (err) { console.error("MAX update failed:", String((err as Error)?.message ?? err)); }
  // MAX ждёт 200 в течение 30 секунд, иначе повторяет доставку.
  return new Response("OK");
});
