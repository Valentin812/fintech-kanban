import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Meeting intake: receives finished meetings from Meeting Hub (desktop app) and stores them in public.meetings.
//
// POST JSON:
//   { action: "issue_token", label? }   Authorization: Bearer <user session JWT>  -> { token }  (shown once)
//   { action: "check" }                 header x-meeting-token                    -> { ok, email }
//   { action: "push", meeting: {...} }  header x-meeting-token                    -> { ok, id }
//
// The long-lived token is stored only as a SHA-256 hash; the owner can revoke it (delete the row).
// verify_jwt is off because Meeting Hub authenticates with its own token.

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(supabaseUrl, serviceRoleKey);

const MAX_BODY = 1_500_000;
const MAX_TOKENS = 20;
const MAX_LIST = 200;

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://valentin812.github.io",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-meeting-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: corsHeaders });

async function sha256(text: string) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function newToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return "mh_" + btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

const text = (v: unknown, max: number) => String(v ?? "").replace(/\u0000/g, "").trim().slice(0, max);
function list(v: unknown) {
  return Array.isArray(v) ? v.slice(0, MAX_LIST) : [];
}
function when(v: unknown) {
  const t = Date.parse(String(v ?? ""));
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const raw = await req.text();
  if (raw.length > MAX_BODY) return json({ error: "Request too large" }, 413);
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: "JSON expected" }, 400);
  }
  const action = String(body.action ?? "");

  if (action === "issue_token") {
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data, error } = await admin.auth.getUser(jwt);
    const user = data?.user;
    if (error || !user) return json({ error: "Sign in again" }, 401);
    if (user.banned_until && new Date(user.banned_until).getTime() > Date.now()) return json({ error: "Forbidden" }, 403);
    const { count } = await admin.from("meeting_tokens").select("id", { count: "exact", head: true }).eq("owner_id", user.id);
    if ((count ?? 0) >= MAX_TOKENS) return json({ error: "Too many tokens, revoke old ones" }, 409);
    const token = newToken();
    const { error: insertError } = await admin.from("meeting_tokens").insert({
      owner_id: user.id,
      token_hash: await sha256(token),
      label: text(body.label, 120),
    });
    if (insertError) {
      console.error("Could not store meeting token:", insertError.message);
      return json({ error: "Could not create token" }, 500);
    }
    return json({ token, email: user.email ?? "" });
  }

  const token = req.headers.get("x-meeting-token") ?? "";
  if (!/^mh_[A-Za-z0-9_-]{40,60}$/.test(token)) return json({ error: "Invalid token" }, 401);
  const { data: row } = await admin.from("meeting_tokens").select("id, owner_id").eq("token_hash", await sha256(token)).maybeSingle();
  if (!row) return json({ error: "Invalid token" }, 401);
  const { data: owner } = await admin.auth.admin.getUserById(row.owner_id);
  if (!owner?.user || (owner.user.banned_until && new Date(owner.user.banned_until).getTime() > Date.now())) {
    return json({ error: "Forbidden" }, 403);
  }
  await admin.from("meeting_tokens").update({ last_used_at: new Date().toISOString() }).eq("id", row.id);

  if (action === "check") return json({ ok: true, email: owner.user.email ?? "" });

  if (action === "push") {
    const m = (body.meeting ?? {}) as Record<string, unknown>;
    const externalId = text(m.external_id, 200);
    const title = text(m.title, 300);
    if (!externalId || !title) return json({ error: "external_id and title are required" }, 400);
    const duration = Number(m.duration_sec);
    const record = {
      owner_id: row.owner_id,
      external_id: externalId,
      title,
      held_at: when(m.held_at),
      duration_sec: Number.isFinite(duration) && duration >= 0 ? Math.round(duration) : null,
      meeting_app: text(m.meeting_app, 120),
      description: text(m.description, 2000),
      summary: list(m.summary),
      decisions: list(m.decisions),
      tasks: list(m.tasks),
      open_questions: list(m.open_questions),
      transcript: text(m.transcript, 400000),
      project_name: text(m.project_name, 200),
      source: "meeting-hub",
    };
    const { data, error } = await admin.from("meetings").upsert(record, { onConflict: "owner_id,external_id" }).select("id").single();
    if (error) {
      console.error("Could not store meeting:", error.message);
      return json({ error: "Could not store meeting" }, 500);
    }
    return json({ ok: true, id: data.id });
  }

  return json({ error: "Unknown action" }, 400);
});
