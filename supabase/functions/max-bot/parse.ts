// Разбор текста задачи: копия раздела из telegram-bot/index.ts (tests/max-bot.mjs следит, чтобы они не разошлись).
const MAX_TITLE_WORDS_CHARS = 80;
type ParsedTask = { title: string; description: string; due: string; projectHint: string };

// Spoken / dictated messages rarely have punctuation, e.g.
// "Надо позвонить в банк получается тема такая узнать про тарифы".
// Filler words mark where the topic ends; purpose words start the details.
const FILLERS = ["получается", "тема такая", "суть такая", "смысл такой", "в общем", "вообщем", "короче", "то есть", "т\\.е\\.", "значит", "а именно", "типа", "и вот", "ну и"];
const PURPOSE = ["чтобы", "и узнать", "и уточнить", "и спросить", "и обсудить", "и договориться", "и проверить", "узнать", "уточнить", "спросить", "обсудить", "договориться"];
const SEP = "(?<=^|[\\s,;:—–-])";
const END = "(?=$|[\\s,;:—–-])";
const FILLER_RE = new RegExp(`${SEP}(?:${FILLERS.join("|")})${END}`, "iu");
const PURPOSE_RE = new RegExp(`${SEP}(?:${PURPOSE.join("|")})${END}`, "iu");
const LEADING_FILLERS_RE = new RegExp(`^(?:[\\s,;:—–-]*(?:${FILLERS.join("|")}|что|это)${END})+[\\s,;:—–-]*`, "iu");
const TRAILING_FILLERS_RE = new RegExp(`(?:[\\s,;:—–-]+(?:${FILLERS.join("|")}|и|а|ну))+[\\s,;:—–-]*$`, "iu");
const LEAD_RE = /^(?:мне\s+)?(?:надо|нужно|необходимо|требуется|не\s+забыть|напомни(?:ть)?(?:\s+мне)?)(?:\s+бы)?\s+(?=\p{L})/iu;
const LABEL_RE = /^(?:тема|задача|заголовок|название)\s*[:—–-]\s*/iu;
const DETAILS_RE = /\s*[,.;]?\s*(?:описание|подробности|детали|суть)\s*[:—–-]\s*/iu;

const words = (v: string) => v.trim().split(/\s+/).filter(Boolean).length;
function capitalize(v: string) {
  const t = v.trim();
  return t ? t[0].toLocaleUpperCase("ru") + t.slice(1) : t;
}
function stripLeadingFillers(v: string) {
  return String(v ?? "").replace(LEADING_FILLERS_RE, "").trim();
}
function cleanTitle(v: string) {
  let t = String(v ?? "").replace(LABEL_RE, "").replace(TRAILING_FILLERS_RE, "").replace(/[\s,;:—–-]+$/u, "").trim();
  const withoutLead = t.replace(LEAD_RE, "");
  if (words(withoutLead) >= 1) t = withoutLead;
  return capitalize(t);
}

export function splitOneLine(line: string): { title: string; description: string } {
  const text = String(line ?? "").replace(LABEL_RE, "").trim();
  const accept = (left: string, right: string) => {
    const l = left.replace(TRAILING_FILLERS_RE, "").replace(/[\s,;:—–-]+$/u, "").trim();
    const r = stripLeadingFillers(right);
    return words(l) >= 2 && words(r) >= 2 ? { title: l, description: r } : null;
  };
  // 1. Explicit "Описание: …".
  const details = text.match(DETAILS_RE);
  if (details && details.index) {
    const found = accept(text.slice(0, details.index), text.slice(details.index + details[0].length));
    if (found) return found;
  }
  // 2. First sentence ("Позвонить в банк. Уточнить тариф"). A new sentence must
  //    start with a capital letter or digit, so "т.е. договор" is not split.
  const sentence = text.match(/^(.{3,}?[.!?…])\s+([\p{Lu}\d«"(].*)$/u);
  if (sentence) return { title: sentence[1].replace(/[.…]+$/u, "").trim(), description: sentence[2].trim() };
  // 3. Dash or colon between two parts ("Позвонить в банк — узнать тарифы").
  const dash = text.match(/^(.+?)\s+[—–-]\s+(.+)$/u) ?? text.match(/^(.+?):\s+(.+)$/u);
  if (dash) {
    const found = accept(dash[1], dash[2]);
    if (found) return found;
  }
  // 4. Spoken fillers / purpose words, whichever comes first after the topic.
  const candidates: { at: number; cut: number }[] = [];
  for (const re of [FILLER_RE, PURPOSE_RE]) {
    const g = new RegExp(re.source, "giu");
    for (const m of text.matchAll(g)) {
      const at = m.index ?? 0;
      if (words(text.slice(0, at)) < 2) continue;
      // Purpose verbs stay in the description; fillers and "чтобы"/"и" are dropped.
      const keep = re === PURPOSE_RE ? m[0].replace(/^(?:чтобы|и)\s*/iu, "") : "";
      candidates.push({ at, cut: at + m[0].length - keep.length });
      break;
    }
  }
  candidates.sort((a, b) => a.at - b.at);
  for (const c of candidates) {
    const found = accept(text.slice(0, c.at), text.slice(c.cut));
    if (found) return found;
  }
  // 5. Long text without any structure: short title, full text in the description.
  if (text.length > MAX_TITLE_WORDS_CHARS) {
    const cut = text.slice(0, MAX_TITLE_WORDS_CHARS);
    const space = cut.lastIndexOf(" ");
    return { title: (space > 40 ? cut.slice(0, space) : cut).replace(/[\s,;:—-]+$/u, "") + "…", description: text };
  }
  return { title: text, description: "" };
}

// «/заметка текст», «/note текст» or «заметка: текст» is a quick note, not a task.
// Returns null for ordinary messages and "" when the text after the command is empty.
export function parseNoteCommand(raw: string): string | null {
  const text = String(raw ?? "").trim();
  const cmd = text.match(/^\/(?:заметка|заметки|note|n)(?:@\w+)?(?:\s+([\s\S]*))?$/i);
  if (cmd) return (cmd[1] ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
  const word = text.match(/^(?:быстрая\s+заметка|заметка|note)\s*[:：—-]\s*([\s\S]+)$/i);
  if (word) return word[1].replace(/\s+/g, " ").trim().slice(0, 300);
  return null;
}

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
  let description = (firstIndex >= 0 ? lines.slice(firstIndex + 1) : []).join("\n").trim();
  if (!description) {
    const split = splitOneLine(title);
    title = split.title;
    description = capitalize(split.description);
  }
  title = cleanTitle(title);
  description = description.slice(0, 4000);
  if (!title) title = "Задача из Telegram";
  if (title.length > 200) title = title.slice(0, 199) + "…";
  return { title, description, due, projectHint };
}


// ---- Screenshots / photos -------------------------------------------------

const DUE_WORDS = /^(сегодня|завтра|послезавтра)$/i;
const DUE_DATE = /^\d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?$/;

// Reads the model's JSON answer defensively: it is untrusted text, so every
// field is type-checked, trimmed and length-limited.
export function parseImageReply(raw: string): { title: string; description: string; due: string } {
  const text = String(raw ?? "");
  let obj: any = null;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      obj = JSON.parse(text.slice(start, end + 1));
    } catch { /* fall through */ }
  }
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\r\n?/g, "\n").trim().slice(0, max) : "");
  let title = str(obj?.title, 120).replace(/\s+/g, " ");
  const description = str(obj?.description, 1500);
  let due = str(obj?.due, 20).toLocaleLowerCase("ru");
  if (!DUE_WORDS.test(due) && !DUE_DATE.test(due)) due = "";
  if (!title) title = "Скриншот";
  if (title.length > 80) title = title.slice(0, 79).trimEnd() + "…";
  return { title, description, due };
}

// Text read by OCR (untrusted, noisy): keeps meaningful lines, the first
// sentence-like line becomes the title and the whole text goes to the description.
export function ocrTextToTask(raw: string): { title: string; description: string; due: string } | null {
  const lines = String(raw ?? "").replace(/\r\n?/g, "\n").split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => (l.match(/[\p{L}\p{N}]/gu) ?? []).length >= 3);
  if (!lines.length) return null;
  const pick = lines.find((l) => words(l) >= 3 && /\p{L}{3}/u.test(l)) ?? lines[0];
  let title = cleanTitle(pick.replace(/[\s,;:—–-]+$/u, ""));
  if (title.length > 80) title = title.slice(0, 79).trimEnd() + "…";
  if (!title) title = "Скриншот";
  return { title, description: ("Текст со скриншота:\n" + lines.join("\n")).slice(0, 1500), due: "" };
}
