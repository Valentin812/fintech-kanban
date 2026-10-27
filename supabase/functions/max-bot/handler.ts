// Логика бота MAX без привязки к Deno/Supabase: всё внешнее приходит через Deps,
// поэтому её можно проверить обычным тестом (tests/max-bot.mjs).
import { parseNoteCommand, parseTaskText } from "./parse.ts";

export type Button = { type: "callback"; text: string; payload: string };
export type Store = {
  findAccount(maxUserId: string): Promise<{ user_id: string } | null>;
  isBanned(userId: string): Promise<boolean>;
  countRecent(userId: string, sinceIso: string): Promise<number>;
  insertInbox(row: Record<string, unknown>): Promise<string | null>;
  projectNames(userId: string): Promise<string[]>;
  consumeLinkCode(code: string): Promise<{ user_id: string } | null>;
  accountOfUser(userId: string): Promise<{ provider_user_id: string } | null>;
  upsertAccount(row: { user_id: string; provider_user_id: string; username: string | null }): Promise<boolean>;
  getInbox(id: string): Promise<{ id: string; user_id: string; title: string; status: string; consumed_at: string | null; choices: string[] | null } | null>;
  markReady(id: string, projectName: string): Promise<boolean>;
};
export type Deps = {
  store: Store;
  send(userId: string, text: string, buttons?: Button[][]): Promise<void>;
  answer(callbackId: string, notification: string): Promise<void>;
  clearButtons(callbackId: string, text: string): Promise<void>;
  now?: () => number;
};

const LINK_CODE = /^[0-9a-f]{24}$/i;
const TASKS_PER_HOUR = 60;
const MAX_PROJECT_BUTTONS = 8;

export const HELP_TEXT =
  "Как создать задачу:\n" +
  "• Просто отправь текст. Название — короткая суть, подробности уйдут в описание.\n" +
  "• Срок: «до 25.10», «сегодня», «завтра» или «послезавтра».\n" +
  "• Проект: добавь #название, например #Автооплата.\n" +
  "• Быстрая заметка (дело на пару часов): /заметка текст или «заметка: текст».\n" +
  "Если проект не указан, Джарвис спросит, куда положить задачу.\n" +
  "Фото и голосовые в MAX пока не поддерживаю — пиши текстом.\n\n" +
  "Пример:\nПодготовить отчёт по тарифам до 30.10 #Автооплата";
const NOT_LINKED = "Сначала подключи аккаунт: в Kanban открой меню аккаунта → «Подключить MAX» и отправь сюда код.";

function normName(v: string) {
  return String(v ?? "").toLocaleLowerCase("ru").replace(/ё/g, "е").replace(/[^\p{L}\p{N}]+/gu, "");
}
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

export function parseChoicePayload(data: unknown): { inboxId: string; choice: number | "mine" } | null {
  const m = String(data ?? "").match(/^p:([0-9a-f-]{36}):(\d{1,2}|m)$/i);
  if (!m) return null;
  return { inboxId: m[1], choice: m[2] === "m" ? "mine" : Number(m[2]) };
}

async function authorize(d: Deps, maxUserId: string): Promise<string | null> {
  const account = await d.store.findAccount(maxUserId);
  if (!account) { await d.send(maxUserId, NOT_LINKED); return null; }
  if (await d.store.isBanned(account.user_id)) { await d.send(maxUserId, "Аккаунт Kanban заблокирован администратором."); return null; }
  const since = new Date((d.now?.() ?? Date.now()) - 60 * 60 * 1000).toISOString();
  if ((await d.store.countRecent(account.user_id, since)) >= TASKS_PER_HOUR) {
    await d.send(maxUserId, "Слишком много задач за час. Попробуй чуть позже.");
    return null;
  }
  return account.user_id;
}

const clip = (v: string) => (v.length > 300 ? v.slice(0, 299) + "…" : v);

async function saveTask(d: Deps, maxUserId: string, userId: string, task: ReturnType<typeof parseTaskText>) {
  let where = "«Мои задачи»";
  let note = "";
  if (!task.projectHint) {
    const choices = [...new Set(await d.store.projectNames(userId))].slice(0, MAX_PROJECT_BUTTONS);
    if (choices.length) {
      const id = await d.store.insertInbox({
        user_id: userId, title: task.title, description: task.description, due: task.due,
        project_hint: "", attachment: null, status: "pending", choices,
      });
      if (!id) { await d.send(maxUserId, "Не удалось создать задачу. Попробуй ещё раз позже."); return; }
      const buttons: Button[] = choices.map((name, i) => ({ type: "callback", text: name.length > 40 ? name.slice(0, 39) + "…" : name, payload: `p:${id}:${i}` }));
      const rows: Button[][] = [];
      for (let i = 0; i < buttons.length; i += 2) rows.push(buttons.slice(i, i + 2));
      rows.push([{ type: "callback", text: "📥 Оставить в «Мои задачи»", payload: `p:${id}:m` }]);
      await d.send(
        maxUserId,
        `✅ Задача: ${task.title}` + (task.due ? `\nСрок: ${task.due}` : "") + (task.description ? `\nОписание: ${clip(task.description)}` : "") +
          "\n\nВ какой проект добавить? Если не выбрать за 10 минут, задача попадёт в «Мои задачи».",
        rows,
      );
      return;
    }
  } else {
    const match = matchProject(task.projectHint, await d.store.projectNames(userId));
    if (match.name) where = `проект «${match.name}»`;
    else if (match.ambiguous) note = `\n⚠️ #${task.projectHint} подходит к нескольким проектам (${match.ambiguous.join(", ")}) — задача попадёт в «Мои задачи». Уточни название.`;
    else note = `\n⚠️ Проект #${task.projectHint} не найден — задача попадёт в «Мои задачи».`;
  }
  const id = await d.store.insertInbox({
    user_id: userId, title: task.title, description: task.description, due: task.due, project_hint: task.projectHint, attachment: null,
  });
  if (!id) { await d.send(maxUserId, "Не удалось создать задачу. Попробуй ещё раз позже."); return; }
  await d.send(
    maxUserId,
    `✅ Задача: ${task.title}\nКуда: ${where}` + (task.due ? `\nСрок: ${task.due}` : "") + (task.description ? `\nОписание: ${clip(task.description)}` : "") + note +
      "\n\nПоявится в Kanban, как только приложение будет открыто.",
  );
}

async function linkAccount(d: Deps, maxUserId: string, username: string | null, code: string) {
  const link = await d.store.consumeLinkCode(code);
  if (!link) { await d.send(maxUserId, "Код недействителен или истёк. Создай новый код в Kanban."); return; }
  const existing = await d.store.findAccount(maxUserId);
  if (existing && existing.user_id !== link.user_id) { await d.send(maxUserId, "Этот MAX уже связан с другим аккаунтом Kanban."); return; }
  const mine = await d.store.accountOfUser(link.user_id);
  if (mine && mine.provider_user_id !== maxUserId) {
    await d.send(maxUserId, "К аккаунту Kanban уже привязан другой MAX. Сначала отключи его в настройках.");
    return;
  }
  if (!(await d.store.upsertAccount({ user_id: link.user_id, provider_user_id: maxUserId, username }))) {
    await d.send(maxUserId, "Не удалось подключить аккаунт. Попробуй позже.");
    return;
  }
  await d.send(maxUserId, "Готово! Я Джарвис, и теперь я на связи с твоим аккаунтом FinTech Kanban. Пиши мне задачи текстом.");
}

async function handleText(d: Deps, maxUserId: string, username: string | null, textRaw: string) {
  const text = textRaw.trim();
  if (!text) return;
  if (/^\/help$/i.test(text)) { await d.send(maxUserId, HELP_TEXT); return; }
  const start = text.match(/^\/start(?:\s+(.+))?$/i);
  if (start && !start[1]) {
    await d.send(maxUserId, "Привет! Я Джарвис, помощник FinTech Kanban.\n\nЧтобы подключить аккаунт, создай код привязки в меню аккаунта Kanban («Подключить MAX») и отправь его сюда.\n\nПосле подключения просто пиши мне текст — я превращу его в задачу. Подробнее: /help");
    return;
  }
  const code = start?.[1]?.trim() ?? text;
  if (start || LINK_CODE.test(text)) { await linkAccount(d, maxUserId, username, code); return; }

  const noteText = parseNoteCommand(text);
  if (noteText !== null) {
    const userId = await authorize(d, maxUserId);
    if (!userId) return;
    if (!noteText) { await d.send(maxUserId, "Напиши заметку после команды, например:\n/заметка перезвонить Азату после обеда"); return; }
    const id = await d.store.insertInbox({ user_id: userId, title: noteText, description: "", due: "", project_hint: "__note__", attachment: null, status: "ready" });
    await d.send(maxUserId, id ? `📝 Заметка: ${noteText}\n\nПоявится в «Быстрых заметках», как только приложение будет открыто.` : "Не удалось сохранить заметку. Попробуй ещё раз позже.");
    return;
  }
  if (text.startsWith("/")) {
    const account = await d.store.findAccount(maxUserId);
    await d.send(maxUserId, account ? "Не знаю такой команды.\n\n" + HELP_TEXT : NOT_LINKED);
    return;
  }
  const userId = await authorize(d, maxUserId);
  if (!userId) return;
  await saveTask(d, maxUserId, userId, parseTaskText(text));
}

async function handleCallback(d: Deps, cb: any) {
  const maxUserId = cb?.user?.user_id !== undefined ? String(cb.user.user_id) : "";
  const callbackId = String(cb?.callback_id ?? "");
  const parsed = parseChoicePayload(cb?.payload);
  if (!maxUserId || !callbackId || !parsed) { if (callbackId) await d.answer(callbackId, "Кнопка устарела."); return; }
  const account = await d.store.findAccount(maxUserId);
  const row = await d.store.getInbox(parsed.inboxId);
  if (!account || !row || row.user_id !== account.user_id) { await d.answer(callbackId, "Эта задача не найдена."); return; }
  const name = parsed.choice === "mine" ? "" : (row.choices ?? [])[parsed.choice] ?? null;
  if (name === null) { await d.answer(callbackId, "Проект не найден."); return; }
  const where = name ? `проект «${name}»` : "«Мои задачи»";
  let text: string;
  if (row.consumed_at || row.status !== "pending") {
    text = `Задача «${row.title}» уже в Kanban (в «Мои задачи»). Перенеси её в нужный проект в приложении.`;
  } else {
    text = (await d.store.markReady(row.id, name))
      ? `Готово: «${row.title}» → ${where}.\n\nПоявится в Kanban, как только приложение будет открыто.`
      : `Задача «${row.title}» уже в Kanban (в «Мои задачи»). Перенеси её в нужный проект в приложении.`;
  }
  await d.clearButtons(callbackId, text);
}

export async function handleUpdate(d: Deps, update: any): Promise<void> {
  const type = update?.update_type;
  if (type === "message_callback") { await handleCallback(d, update.callback ?? update); return; }
  if (type === "bot_started") {
    const uid = update?.user?.user_id;
    if (uid === undefined) return;
    const payload = String(update?.payload ?? "").trim();
    const username = update?.user?.username ?? update?.user?.name ?? null;
    if (payload && LINK_CODE.test(payload)) await linkAccount(d, String(uid), username, payload);
    else await handleText(d, String(uid), username, "/start");
    return;
  }
  if (type === "message_created") {
    const sender = update?.message?.sender;
    if (!sender || sender.is_bot || sender.user_id === undefined) return;
    const text = String(update?.message?.body?.text ?? "").trim();
    const uid = String(sender.user_id);
    if (!text) {
      const attached = Array.isArray(update?.message?.body?.attachments) && update.message.body.attachments.length;
      if (attached) await d.send(uid, "Фото, файлы и голосовые в MAX пока не поддерживаю — отправь текстом.");
      return;
    }
    await handleText(d, uid, sender.username ?? sender.name ?? null, text);
  }
}
