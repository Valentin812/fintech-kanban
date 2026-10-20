import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN")!;

const admin = createClient(supabaseUrl, serviceRoleKey);
const corsHeaders = {
  "Access-Control-Allow-Origin": "https://valentin812.github.io",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

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
  if (userError || !userResult.user) return Response.json({ error: "Invalid session" }, { status: 401, headers: corsHeaders });

  let payload: any;
  try { payload = await req.json(); } catch { return Response.json({ error: "Invalid JSON" }, { status: 400, headers: corsHeaders }); }
  const owner = String(payload?.owner ?? "").trim();
  const taskTitle = String(payload?.title ?? "").trim();
  const project = String(payload?.project ?? "").trim();
  const due = String(payload?.due ?? "").trim();
  if (!owner || !taskTitle) return Response.json({ sent: false, reason: "missing_owner_or_title" }, { headers: corsHeaders });

  // Resolve assignee by email or by their Telegram username if owner was entered as @username.
  const normalizedOwner = owner.replace(/^@/, "").toLocaleLowerCase();
  let accountQuery = admin.from("messenger_accounts").select("provider_user_id,user_id,username").eq("provider", "telegram");
  const { data: accounts, error: accountError } = await accountQuery;
  if (accountError) {
    console.error("Telegram account lookup failed:", accountError.message);
    return Response.json({ error: "Could not look up Telegram account" }, { status: 500, headers: corsHeaders });
  }

  const { data: authUsers, error: usersError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (usersError) {
    console.error("Auth user lookup failed:", usersError.message);
    return Response.json({ error: "Could not look up Kanban users" }, { status: 500, headers: corsHeaders });
  }

  const matchingUser = authUsers.users.find((u) => {
    const email = (u.email ?? "").toLocaleLowerCase();
    const metadata = u.user_metadata ?? {};
    const display = String(metadata.full_name ?? metadata.name ?? metadata.display_name ?? "").toLocaleLowerCase();
    return email === normalizedOwner || display === normalizedOwner;
  });
  if (!matchingUser) return Response.json({ sent: false, reason: "assignee_not_found", hint: "Use the assignee's Kanban account email or profile name in the Responsible field." }, { headers: corsHeaders });
  const account = (accounts ?? []).find((a) => a.user_id === matchingUser.id);
  if (!account) return Response.json({ sent: false, reason: "telegram_not_linked" }, { headers: corsHeaders });

  const lines = [
    "📌 Тебе назначена задача в FinTech Kanban",
    `Задача: ${taskTitle}`,
    project ? `Проект: ${project}` : "",
    due ? `Срок: ${due}` : "",
    "Открой Kanban, чтобы посмотреть подробности.",
    "https://valentin812.github.io/fintech-kanban/",
  ].filter(Boolean);
  try {
    await telegramSend(account.provider_user_id, lines.join("\n"));
    return Response.json({ sent: true }, { headers: corsHeaders });
  } catch (error) {
    console.error("Telegram notification failed:", error instanceof Error ? error.message : error);
    return Response.json({ sent: false, reason: "telegram_delivery_failed" }, { status: 502, headers: corsHeaders });
  }
});
