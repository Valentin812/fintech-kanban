
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const webhookSecret = Deno.env.get("TELEGRAM_WEBHOOK_SECRET")!;

const db = createClient(supabaseUrl, serviceRoleKey);

const telegramApi = (method: string) =>
  `https://api.telegram.org/bot${botToken}/${method}`;

async function sendMessage(chatId: number, text: string) {
  const response = await fetch(telegramApi("sendMessage"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
    }),
  });

  if (!response.ok) {
    console.error("Telegram sendMessage failed:", response.status);
  }
}

const LINK_CODE = /^[0-9a-f]{24}$/i;
const TASKS_PER_HOUR = 60;
const HELP_TEXT =
  "Как создать задачу:\n" +
  "• Просто отправь текст — первая строка станет названием, остальное — описанием.\n" +
  "• Срок: «до 25.10», «до 25.10.2026», «сегодня», «завтра» или «послезавтра».\n" +
  "• Проект: добавь #название, например #Автооплата.\n" +
  "Без проекта задача попадёт в «Мои задачи», ответственный — ты.\n\n" +
  "Пример:\nПодготовить отчёт по тарифам до 30.10 #Автооплата\nСравнить Альфу и Тбанк";

type ParsedTask = { title: string; description: string; due: string; projectHint: string };

export function parseTaskText(raw: string): ParsedTask {
  let text = String(raw ?? "").replace(/\r\n?/g, "\n").trim();
  let projectHint = "";
  const tag = text.match(/(^|\s)#([\p{L}\p{N}_-]+)/u);
  if (tag) {
    projectHint = tag[2];
    text = (text.slice(0, tag.index) + tag[1] + text.slice((tag.index ?? 0) + tag[0].length)).trim();
  }
  let due = "";
  const dueRe = /(^|\s)(?:до|срок:?)\s+(\d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?|сегодня|завтра|послезавтра)(?=$|[\s,.;!?])/iu;
  const wordRe = /(^|\s)(сегодня|завтра|послезавтра)(?=$|[\s,.;!?])/iu;
  const m = text.match(dueRe) ?? text.match(wordRe);
  if (m) {
    due = m[2].toLocaleLowerCase("ru");
    text = (text.slice(0, m.index) + m[1] + text.slice((m.index ?? 0) + m[0].length)).trim();
  }
  const lines = text.split("\n").map((l) => l.trim());
  const firstIndex = lines.findIndex(Boolean);
  let title = (firstIndex >= 0 ? lines[firstIndex] : "").replace(/\s+/g, " ").replace(/[\s,;:—-]+$/u, "").trim();
  const description = (firstIndex >= 0 ? lines.slice(firstIndex + 1) : []).join("\n").trim().slice(0, 4000);
  if (!title) title = "Задача из Telegram";
  if (title.length > 200) title = title.slice(0, 199) + "…";
  return { title, description, due, projectHint };
}

function normName(v: string) {
  return String(v ?? "").toLocaleLowerCase("ru").replace(/ё/g, "е").replace(/[^\p{L}\p{N}]+/gu, "");
}

// Same rule as in the app: exact match, otherwise a unique prefix, otherwise
// a unique "contains" match.
export function matchProject(hint: string, names: string[]): { name?: string; ambiguous?: string[] } {
  const h = normName(hint);
  if (!h) return {};
  const unique = [...new Set(names)];
  const exact = unique.filter((n) => normName(n) === h);
  if (exact.length === 1) return { name: exact[0] };
  for (const test of [(n: string) => normName(n).startsWith(h), (n: string) => normName(n).includes(h)]) {
    const found = unique.filter(test);
    if (found.length === 1) return { name: found[0] };
    if (found.length > 1) return { ambiguous: found.slice(0, 5) };
  }
  return {};
}

async function projectNamesFor(userId: string): Promise<string[]> {
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
}

async function handleTaskMessage(chatId: number, providerUserId: string, text: string) {
  if (/^\/help(?:@\w+)?$/i.test(text)) {
    await sendMessage(chatId, HELP_TEXT);
    return;
  }
  const { data: account } = await db
    .from("messenger_accounts")
    .select("user_id")
    .eq("provider", "telegram")
    .eq("provider_user_id", providerUserId)
    .maybeSingle();
  if (!account) {
    await sendMessage(chatId, "Сначала подключи аккаунт: в Kanban открой меню аккаунта → «Подключить Telegram» и отправь сюда код.");
    return;
  }
  if (text.startsWith("/")) {
    await sendMessage(chatId, "Не знаю такой команды.\n\n" + HELP_TEXT);
    return;
  }

  const { data: authUser } = await db.auth.admin.getUserById(account.user_id);
  const bannedUntil = authUser?.user?.banned_until;
  if (bannedUntil && new Date(bannedUntil).getTime() > Date.now()) {
    await sendMessage(chatId, "Аккаунт Kanban заблокирован администратором.");
    return;
  }

  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count } = await db
    .from("telegram_inbox")
    .select("id", { count: "exact", head: true })
    .eq("user_id", account.user_id)
    .gte("created_at", hourAgo);
  if ((count ?? 0) >= TASKS_PER_HOUR) {
    await sendMessage(chatId, "Слишком много задач за час. Попробуй чуть позже.");
    return;
  }

  const task = parseTaskText(text);
  let where = "«Мои задачи»";
  let note = "";
  if (task.projectHint) {
    const match = matchProject(task.projectHint, await projectNamesFor(account.user_id));
    if (match.name) where = `проект «${match.name}»`;
    else if (match.ambiguous) note = `\n⚠️ #${task.projectHint} подходит к нескольким проектам (${match.ambiguous.join(", ")}) — задача попадёт в «Мои задачи». Уточни название.`;
    else note = `\n⚠️ Проект #${task.projectHint} не найден — задача попадёт в «Мои задачи».`;
  }

  const { error } = await db.from("telegram_inbox").insert({
    user_id: account.user_id,
    title: task.title,
    description: task.description,
    due: task.due,
    project_hint: task.projectHint,
  });
  if (error) {
    console.error("Inbox insert failed:", error.message);
    await sendMessage(chatId, "Не удалось создать задачу. Попробуй ещё раз позже.");
    return;
  }

  await sendMessage(
    chatId,
    `✅ Задача: ${task.title}\nКуда: ${where}` +
      (task.due ? `\nСрок: ${task.due}` : "") +
      (task.description ? "\nОписание добавлено" : "") +
      note +
      "\n\nПоявится в Kanban, как только приложение будет открыто."
  );
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  // Отдельный защищённый режим настройки webhook.
  if (req.headers.get("x-setup-secret") === webhookSecret) {
    const response = await fetch(telegramApi("setWebhook"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: `${supabaseUrl}/functions/v1/telegram-bot`,
        secret_token: webhookSecret,
        allowed_updates: ["message"],
      }),
    });

    const result = await response.json();
    return Response.json(result, { status: response.ok ? 200 : 502 });
  }

  // Проверяем, что запрос пришёл через настроенный webhook Telegram.
  if (
    req.headers.get("x-telegram-bot-api-secret-token") !== webhookSecret
  ) {
    return new Response("Unauthorized", { status: 401 });
  }

  let update: any;
  try {
    update = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const message = update?.message;
  const chatId = message?.chat?.id;
  const telegramUser = message?.from;
  const text = String(message?.text ?? "").trim();

  if (!chatId || !telegramUser || !text) {
    return new Response("OK");
  }

  const startMatch = text.match(/^\/start(?:@\w+)?(?:\s+(.+))?$/);
  const code = startMatch?.[1]?.trim() ?? text;

  if (startMatch && !startMatch[1]) {
    await sendMessage(
      chatId,
      "Привет! Это бот FinTech Kanban.\n\n" +
        "Чтобы подключить аккаунт, создай код привязки в своём профиле Kanban, " +
        "затем отправь его сюда.\n\n" +
        "После подключения просто пиши мне текст — я превращу его в задачу. Подробнее: /help"
    );
    return new Response("OK");
  }

  // Anything that is not a link code is a new task from a linked user.
  const isLinkCode = !!startMatch || LINK_CODE.test(text);
  if (!isLinkCode) {
    await handleTaskMessage(chatId, String(telegramUser.id), text);
    return new Response("OK");
  }

  // Код должен существовать, быть неиспользованным и не просроченным.
  // Помечаем код использованным одним атомарным запросом: если два сообщения
  // с одним кодом придут одновременно, сработает только одно из них.
  const { data: link, error: linkError } = await db
    .from("telegram_link_codes")
    .update({ used_at: new Date().toISOString() })
    .eq("code", code)
    .is("used_at", null)
    .gt("expires_at", new Date().toISOString())
    .select("code,user_id")
    .maybeSingle();

  if (linkError || !link) {
    await sendMessage(
      chatId,
      "Код недействителен или истёк. Создай новый код в Kanban."
    );
    return new Response("OK");
  }

  const providerUserId = String(telegramUser.id);

  // Не позволяем привязать Telegram, уже связанный с другим аккаунтом.
  const { data: existingTelegram } = await db
    .from("messenger_accounts")
    .select("user_id")
    .eq("provider", "telegram")
    .eq("provider_user_id", providerUserId)
    .maybeSingle();

  if (existingTelegram && existingTelegram.user_id !== link.user_id) {
    await sendMessage(
      chatId,
      "Этот Telegram уже связан с другим аккаунтом Kanban."
    );
    return new Response("OK");
  }

  const { data: existingUserLink } = await db
    .from("messenger_accounts")
    .select("provider_user_id")
    .eq("provider", "telegram")
    .eq("user_id", link.user_id)
    .maybeSingle();

  if (
    existingUserLink &&
    existingUserLink.provider_user_id !== providerUserId
  ) {
    await sendMessage(
      chatId,
      "К аккаунту Kanban уже привязан другой Telegram. " +
        "Сначала отключи его в настройках."
    );
    return new Response("OK");
  }

  const { error: insertError } = await db
    .from("messenger_accounts")
    .upsert(
      {
        user_id: link.user_id,
        provider: "telegram",
        provider_user_id: providerUserId,
        username: telegramUser.username ?? null,
        linked_at: new Date().toISOString(),
      },
      { onConflict: "user_id,provider" }
    );

  if (insertError) {
    console.error("Link account failed:", insertError.message);
    await sendMessage(chatId, "Не удалось подключить аккаунт. Попробуй позже.");
    return new Response("OK");
  }

  await sendMessage(
    chatId,
    "Готово! Telegram подключён к твоему аккаунту FinTech Kanban."
  );

  return new Response("OK");
});
