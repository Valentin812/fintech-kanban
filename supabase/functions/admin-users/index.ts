import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Admin-only user management for FinTech Kanban.
//
// Actions (POST JSON body):
//   { action: "list" }                  -> { users: [...] }
//   { action: "ban",   user_id: "..." } -> { ok: true }
//   { action: "unban", user_id: "..." } -> { ok: true }
//   { action: "grant_admin",  user_id: "..." } -> { ok: true }  (owner only)
//   { action: "revoke_admin", user_id: "..." } -> { ok: true }  (owner only)
//
// Only accounts listed in public.kanban_admins may call it. Admins cannot be
// blocked through this function (including yourself). Only the owner can grant
// or revoke admin rights, and the owner can never be blocked or demoted, so the
// owner can never be locked out. Accounts are never deleted here.

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// "Forever" for practical purposes: about 100 years.
const BAN_DURATION = "876000h";

const admin = createClient(supabaseUrl, serviceRoleKey);
const corsHeaders = {
  "Access-Control-Allow-Origin": "https://valentin812.github.io",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: corsHeaders });

function isBanned(user: { banned_until?: string | null }) {
  return !!user.banned_until && new Date(user.banned_until).getTime() > Date.now();
}

function displayNameOf(user: { email?: string; user_metadata?: Record<string, unknown> }) {
  const metadata = user.user_metadata ?? {};
  return String(metadata.full_name ?? metadata.name ?? metadata.display_name ?? "").trim();
}

async function loadAdmins() {
  const { data, error } = await admin.from("kanban_admins").select("user_id,is_owner");
  if (error) throw new Error("admin lookup failed: " + error.message);
  const ids = new Set<string>();
  const owners = new Set<string>();
  for (const row of data ?? []) {
    ids.add(row.user_id as string);
    if (row.is_owner) owners.add(row.user_id as string);
  }
  return { ids, owners };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return json({ error: "Sign in required" }, 401);

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: userResult, error: userError } = await userClient.auth.getUser();
  const caller = userResult?.user;
  if (userError || !caller) return json({ error: "Invalid session" }, 401);
  if (isBanned(caller)) return json({ error: "Forbidden" }, 403);

  let admins: Set<string>;
  let owners: Set<string>;
  try {
    ({ ids: admins, owners } = await loadAdmins());
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    return json({ error: "Could not check permissions" }, 500);
  }
  if (!admins.has(caller.id)) return json({ error: "Forbidden" }, 403);
  const callerIsOwner = owners.has(caller.id);

  let payload: any;
  try { payload = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  const action = String(payload?.action ?? "");

  if (action === "list") {
    const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (error) {
      console.error("listUsers failed:", error.message);
      return json({ error: "Could not load users" }, 500);
    }
    const { data: telegram } = await admin
      .from("messenger_accounts")
      .select("user_id")
      .eq("provider", "telegram");
    const linked = new Set((telegram ?? []).map((row) => row.user_id as string));
    const users = data.users
      .map((u) => ({
        id: u.id,
        email: u.email ?? "",
        name: displayNameOf(u),
        created_at: u.created_at,
        last_sign_in_at: u.last_sign_in_at ?? null,
        email_confirmed: !!u.email_confirmed_at,
        banned: isBanned(u),
        is_admin: admins.has(u.id),
        is_owner: owners.has(u.id),
        is_self: u.id === caller.id,
        telegram: linked.has(u.id),
      }))
      .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    return json({ users, me: { id: caller.id, is_owner: callerIsOwner } });
  }

  if (action === "ban" || action === "unban") {
    const targetId = String(payload?.user_id ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(targetId)) return json({ error: "Invalid user_id" }, 400);
    if (action === "ban" && (targetId === caller.id || admins.has(targetId))) {
      return json({ error: "Administrators cannot be blocked" }, 400);
    }
    const { error } = await admin.auth.admin.updateUserById(targetId, {
      ban_duration: action === "ban" ? BAN_DURATION : "none",
    });
    if (error) {
      console.error(`${action} failed:`, error.message);
      return json({ error: "Could not update user" }, 500);
    }
    console.log(`admin ${caller.id} ${action} ${targetId}`);
    return json({ ok: true });
  }

  if (action === "grant_admin" || action === "revoke_admin") {
    if (!callerIsOwner) return json({ error: "Only the owner can manage administrators" }, 403);
    const targetId = String(payload?.user_id ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(targetId)) return json({ error: "Invalid user_id" }, 400);
    if (targetId === caller.id || owners.has(targetId)) {
      return json({ error: "The owner's rights cannot be changed" }, 400);
    }
    const { data: target, error: targetError } = await admin.auth.admin.getUserById(targetId);
    if (targetError || !target?.user) return json({ error: "User not found" }, 404);

    if (action === "grant_admin") {
      if (isBanned(target.user)) return json({ error: "Unblock the user before granting admin rights" }, 400);
      const { error } = await admin
        .from("kanban_admins")
        .upsert({ user_id: targetId, is_owner: false, granted_by: caller.id }, { onConflict: "user_id", ignoreDuplicates: true });
      if (error) {
        console.error("grant_admin failed:", error.message);
        return json({ error: "Could not grant admin rights" }, 500);
      }
    } else {
      const { error } = await admin
        .from("kanban_admins")
        .delete()
        .eq("user_id", targetId)
        .eq("is_owner", false);
      if (error) {
        console.error("revoke_admin failed:", error.message);
        return json({ error: "Could not revoke admin rights" }, 500);
      }
    }
    console.log(`owner ${caller.id} ${action} ${targetId}`);
    return json({ ok: true });
  }

  return json({ error: "Unknown action" }, 400);
});
