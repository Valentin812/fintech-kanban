
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
        "затем отправь его сюда."
    );
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
