import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Shared projects: create, list members, invite, remove, leave, delete.
//
// Actions (POST JSON body):
//   { action: "create", name, meta, tasks }          -> { project }
//   { action: "members", project_id }                 -> { members, me }
//   { action: "invite", project_id, email }           -> { member }     (owner)
//   { action: "remove_member", project_id, user_id }  -> { ok }         (owner)
//   { action: "leave", project_id }                   -> { ok }         (non-owner)
//   { action: "delete", project_id }                  -> { ok }         (owner)
//
// Reading and editing tasks / columns happens directly through the REST API
// under RLS; this function only covers what needs owner rules or user lookup.

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const MAX_TASKS = 3000;
const MAX_MEMBERS = 50;

const admin = createClient(supabaseUrl, serviceRoleKey);
const corsHeaders = {
  "Access-Control-Allow-Origin": "https://valentin812.github.io",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: corsHeaders });
const isUuid = (v: unknown) => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);

function isBanned(user: { banned_until?: string | null }) {
  return !!user.banned_until && new Date(user.banned_until).getTime() > Date.now();
}
function displayNameOf(user: { email?: string; user_metadata?: Record<string, unknown> }) {
  const metadata = user.user_metadata ?? {};
  return String(metadata.full_name ?? metadata.name ?? metadata.display_name ?? "").trim();
}
function clipName(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
}

async function membership(projectId: string, userId: string) {
  const { data, error } = await admin
    .from("shared_project_members")
    .select("role")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error("membership lookup failed: " + error.message);
  return data?.role as "owner" | "editor" | undefined;
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

  let payload: any;
  try { payload = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  const action = String(payload?.action ?? "");

  try {
    if (action === "create") {
      const name = clipName(payload?.name);
      if (!name) return json({ error: "Project name is required" }, 400);
      const meta = payload?.meta && typeof payload.meta === "object" && !Array.isArray(payload.meta) ? payload.meta : {};
      const tasks = Array.isArray(payload?.tasks) ? payload.tasks : [];
      if (tasks.length > MAX_TASKS) return json({ error: "Too many tasks" }, 400);
      if (tasks.some((t: any) => !t || typeof t !== "object" || !Number.isSafeInteger(Number(t.id)))) {
        return json({ error: "Every task needs a numeric id" }, 400);
      }
      if (new Set(tasks.map((t: any) => Number(t.id))).size !== tasks.length) return json({ error: "Duplicate task ids" }, 400);

      const { data: project, error: projectError } = await admin
        .from("shared_projects")
        .insert({ name, owner_id: caller.id, meta })
        .select("id,name,meta,owner_id,updated_at")
        .single();
      if (projectError || !project) throw new Error("create project failed: " + projectError?.message);

      const { error: memberError } = await admin
        .from("shared_project_members")
        .insert({ project_id: project.id, user_id: caller.id, role: "owner", added_by: caller.id });
      if (memberError) {
        await admin.from("shared_projects").delete().eq("id", project.id);
        throw new Error("owner membership failed: " + memberError.message);
      }

      if (tasks.length) {
        const rows = tasks.map((t: any) => ({ project_id: project.id, task_id: Number(t.id), data: t, updated_by: caller.id }));
        for (let i = 0; i < rows.length; i += 500) {
          const { error: tasksError } = await admin.from("shared_tasks").insert(rows.slice(i, i + 500));
          if (tasksError) {
            await admin.from("shared_projects").delete().eq("id", project.id);
            throw new Error("copy tasks failed: " + tasksError.message);
          }
        }
      }
      console.log(`user ${caller.id} created shared project ${project.id} with ${tasks.length} tasks`);
      return json({ project: { ...project, role: "owner" } });
    }

    const projectId = payload?.project_id;
    if (!isUuid(projectId)) return json({ error: "Invalid project_id" }, 400);
    const myRole = await membership(projectId, caller.id);
    if (!myRole) return json({ error: "Not a member of this project" }, 403);

    if (action === "members") {
      const { data: rows, error } = await admin
        .from("shared_project_members")
        .select("user_id,role,created_at")
        .eq("project_id", projectId)
        .order("created_at");
      if (error) throw new Error("members failed: " + error.message);
      const { data: users, error: usersError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      if (usersError) throw new Error("listUsers failed: " + usersError.message);
      const byId = new Map(users.users.map((u) => [u.id, u]));
      const members = (rows ?? []).map((m) => {
        const u = byId.get(m.user_id);
        return { user_id: m.user_id, role: m.role, email: u?.email ?? "", name: u ? displayNameOf(u) : "", is_self: m.user_id === caller.id };
      });
      return json({ members, me: { role: myRole } });
    }

    if (action === "leave") {
      if (myRole === "owner") return json({ error: "The owner cannot leave; delete the project instead" }, 400);
      const { error } = await admin.from("shared_project_members").delete().eq("project_id", projectId).eq("user_id", caller.id);
      if (error) throw new Error("leave failed: " + error.message);
      return json({ ok: true });
    }

    if (myRole !== "owner") return json({ error: "Only the project owner can do this" }, 403);

    if (action === "invite") {
      const email = String(payload?.email ?? "").trim().toLocaleLowerCase();
      if (!email.includes("@")) return json({ error: "Invalid email" }, 400);
      const { count } = await admin
        .from("shared_project_members")
        .select("user_id", { count: "exact", head: true })
        .eq("project_id", projectId);
      if ((count ?? 0) >= MAX_MEMBERS) return json({ error: "Too many members" }, 400);
      const { data: users, error: usersError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      if (usersError) throw new Error("listUsers failed: " + usersError.message);
      const target = users.users.find((u) => (u.email ?? "").toLocaleLowerCase() === email);
      if (!target) return json({ error: "user_not_found" }, 404);
      if (isBanned(target)) return json({ error: "user_blocked" }, 400);
      const existing = await membership(projectId, target.id);
      if (!existing) {
        const { error } = await admin
          .from("shared_project_members")
          .insert({ project_id: projectId, user_id: target.id, role: "editor", added_by: caller.id });
        if (error) throw new Error("invite failed: " + error.message);
        const { data: project } = await admin.from("shared_projects").select("name").eq("id", projectId).maybeSingle();
        const callerName = displayNameOf(caller);
        const senderLabel = callerName && caller.email ? `${callerName} (${caller.email})` : callerName || caller.email || "участник Kanban";
        const { error: notifyError } = await admin.from("notifications").insert({
          recipient_id: target.id,
          sender_id: caller.id,
          sender_name: senderLabel,
          kind: "invite",
          title: project?.name ?? "Общий проект",
          project: project?.name ?? "",
          project_id: projectId,
        });
        if (notifyError) console.error("invite notification failed:", notifyError.message);
      }
      return json({ member: { user_id: target.id, role: existing ?? "editor", email: target.email ?? "", name: displayNameOf(target) } });
    }

    if (action === "remove_member") {
      const userId = payload?.user_id;
      if (!isUuid(userId)) return json({ error: "Invalid user_id" }, 400);
      if (userId === caller.id) return json({ error: "The owner cannot remove themselves" }, 400);
      const { error } = await admin
        .from("shared_project_members")
        .delete()
        .eq("project_id", projectId)
        .eq("user_id", userId)
        .neq("role", "owner");
      if (error) throw new Error("remove failed: " + error.message);
      return json({ ok: true });
    }

    if (action === "delete") {
      const { error } = await admin.from("shared_projects").delete().eq("id", projectId).eq("owner_id", caller.id);
      if (error) throw new Error("delete failed: " + error.message);
      console.log(`owner ${caller.id} deleted shared project ${projectId}`);
      return json({ ok: true });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    return json({ error: "Server error" }, 500);
  }
});
