import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN")!;

// Anti-abuse limits. Any registered user can call this function, so a single
// account must not be able to flood other people's Telegram.
const SENDER_LIMIT_PER_HOUR = 30;
const PAIR_LIMIT_PER_HOUR = 10;
const MAX_TITLE = 200;
const MAX_PROJECT = 100;
const MAX_DUE = 40;
const MAX_SENDER = 80;

const admin = createClient(supabaseUrl, serviceRoleKey);
const corsHeaders = {
  "Access-Control-Allow-Origin": "https://valentin812.github.io",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function clip(value: unknown, max: number) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}

function displayNameOf(user: { email?: string; user_metadata?: Record<string, unknown> }) {
  const metadata = user.user_metadata ?? {};
  return String(metadata.full_name ?? metadata.name ?? metadata.display_name ?? "").trim();
}

async function telegramSend(chatId: string, text: string) {
  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
  });
  const result = await response.json();
  if (!response.ok || !result?.ok) throw new Error("Telegram sendMessage failed");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405, headers: corsHeaders });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return Response.json({ error: "Sign in required" }, { status: 401, headers: corsHeaders });

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: userResult, error: userError } = await userClient.auth.getUser();
  const sender = userResult?.user;
  if (userError || !sender) return Response.json({ error: "Invalid session" }, { status: 401, headers: corsHeaders });

  let payload: any;
  try { payload = await req.json(); } catch { return Response.json({ error: "Invalid JSON" }, { status: 400, headers: corsHeaders }); }
  const owner = String(payload?.owner ?? "").trim();
  const taskTitle = clip(payload?.title, MAX_TITLE);
  const project = clip(payload?.project, MAX_PROJECT);
  const due = clip(payload?.due, MAX_DUE);
  if (!owner || !taskTitle) return Response.json({ sent: false, reason: "missing_owner_or_title" }, { headers: corsHeaders });

  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count: senderCount, error: senderCountError } = await admin
    .from("telegram_notification_log")
    .select("id", { count: "exact", head: true })
    .eq("sender_id", sender.id)
    .gte("created_at", hourAgo);
  if (senderCountError) {
    console.error("Notification log lookup failed:", senderCountError.message);
    return Response.json({ error: "Could not check notification limit" }, { status: 500, headers: corsHeaders });
  }
  if ((senderCount ?? 0) >= SENDER_LIMIT_PER_HOUR) {
    return Response.json({ sent: false, reason: "rate_limited" }, { status: 429, headers: corsHeaders });
  }

  const normalizedOwner = owner.replace(/^@/, "").toLocaleLowerCase();
  const { data: accounts, error: accountError } = await admin
    .from("messenger_accounts")
    .select("provider_user_id,user_id,username")
    .eq("provider", "telegram");
  if (accountError) {
    console.error("Telegram account lookup failed:", accountError.message);
    return Response.json({ error: "Could not look up Telegram account" }, { status: 500, headers: corsHeaders });
  }

  const { data: authUsers, error: usersError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (usersError) {
    console.error("Auth user lookup failed:", usersError.message);
    return Response.json({ error: "Could not look up Kanban users" }, { status: 500, headers: corsHeaders });
  }

  // Email is unique and cannot be faked, so it always wins. A profile name is
  // chosen by the user themselves, so it is only trusted when exactly one
  // account carries it — otherwise anyone could register a duplicate name and
  // intercept or redirect notifications.
  const users = authUsers.users;
  let matchingUser = users.find((u) => (u.email ?? "").toLocaleLowerCase() === normalizedOwner);
  if (!matchingUser) {
    const byName = users.filter((u) => displayNameOf(u).toLocaleLowerCase() === normalizedOwner);
    if (byName.length > 1) {
      return Response.json({ sent: false, reason: "assignee_ambiguous", hint: "Several accounts share this name. Use the assignee's email." }, { headers: corsHeaders });
    }
    matchingUser = byName[0];
  }
  if (!matchingUser) return Response.json({ sent: false, reason: "assignee_not_found", hint: "Use the assignee's Kanban account email or profile name in the Responsible field." }, { headers: corsHeaders });
  const account = (accounts ?? []).find((a) => a.user_id === matchingUser.id);
  if (!account) return Response.json({ sent: false, reason: "telegram_not_linked" }, { headers: corsHeaders });

  const { count: pairCount, error: pairCountError } = await admin
    .from("telegram_notification_log")
    .select("id", { count: "exact", head: true })
    .eq("sender_id", sender.id)
    .eq("recipient_id", matchingUser.id)
    .gte("created_at", hourAgo);
  if (pairCountError) {
    console.error("Notification log lookup failed:", pairCountError.message);
    return Response.json({ error: "Could not check notification limit" }, { status: 500, headers: corsHeaders });
  }
  if ((pairCount ?? 0) >= PAIR_LIMIT_PER_HOUR) {
    return Response.json({ sent: false, reason: "rate_limited" }, { status: 429, headers: corsHeaders });
  }

  // Always show who sent the notification, so the recipient can tell a real
  // assignment from an impersonation attempt.
  const senderName = clip(displayNameOf(sender), MAX_SENDER);
  const senderEmail = String(sender.email ?? "").trim();
  const senderLabel = senderName && senderEmail ? `${senderName} (${senderEmail})` : senderName || senderEmail || "участник Kanban";

  const lines = [
    "📌 Тебе назначена задача в FinTech Kanban",
    `От: ${senderLabel}`,
    `Задача: ${taskTitle}`,
    project ? `Проект: ${project}` : "",
    due ? `Срок: ${due}` : "",
    "Открой Kanban, чтобы посмотреть подробности.",
    "https://valentin812.github.io/fintech-kanban/",
  ].filter(Boolean);
  try {
    await telegramSend(account.provider_user_id, lines.join("\n"));
  } catch (error) {
    console.error("Telegram notification failed:", error instanceof Error ? error.message : error);
    return Response.json({ sent: false, reason: "telegram_delivery_failed" }, { status: 502, headers: corsHeaders });
  }

  const { error: logError } = await admin
    .from("telegram_notification_log")
    .insert({ sender_id: sender.id, recipient_id: matchingUser.id });
  if (logError) console.error("Notification log insert failed:", logError.message);

  return Response.json({ sent: true }, { headers: corsHeaders });
});
