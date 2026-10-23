import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const admin = createClient(supabaseUrl, serviceRoleKey);

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://valentin812.github.io",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405, headers: corsHeaders });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return Response.json({ error: "Sign in required" }, { status: 401, headers: corsHeaders });
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });

  const { data: userResult, error: userError } = await userClient.auth.getUser();
  const user = userResult?.user;
  if (userError || !user) {
    return Response.json({ error: "Invalid session" }, { status: 401, headers: corsHeaders });
  }
  // A blocked account keeps a valid access token for up to an hour; stop it here.
  if (user.banned_until && new Date(user.banned_until).getTime() > Date.now()) {
    return Response.json({ error: "Forbidden" }, { status: 403, headers: corsHeaders });
  }

  const code = crypto.randomUUID().replaceAll("-", "").slice(0, 24);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  const { error } = await admin.from("telegram_link_codes").insert({
    code,
    user_id: user.id,
    expires_at: expiresAt,
  });

  if (error) {
    console.error("Could not create Telegram link code:", error.message);
    return Response.json({ error: "Could not create link code" }, { status: 500, headers: corsHeaders });
  }

  return Response.json({
    code,
    expires_at: expiresAt,
    start_url: `https://t.me/FinTechKanbanTasksBot?start=${code}`,
  }, { headers: corsHeaders });
});
