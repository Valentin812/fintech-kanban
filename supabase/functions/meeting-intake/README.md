# meeting-intake

Приём готовых встреч из Meeting Hub (десктоп-программа) в таблицу `public.meetings`.

## Для вкладки «Встречи»
Читать напрямую из REST под RLS (видны только свои встречи):

`GET /rest/v1/meetings?select=id,title,held_at,duration_sec,meeting_app,description,summary,decisions,tasks,open_questions,transcript,project_name&order=held_at.desc.nullslast`

Поиск: `&search=wfts(russian).<запрос>`.

Поля JSON (как их присылает Meeting Hub):
- `summary` — массив строк (краткое резюме);
- `decisions` — `[{text, evidence}]`;
- `tasks` — `[{task, owner, deadline, evidence, confidence}]`;
- `open_questions` — `[{question, evidence}]`;
- `transcript` — текст расшифровки с метками времени и говорящих.

`external_id` — имя записи; повторная отправка обновляет встречу, а не дублирует её.

## Токены Meeting Hub
Таблица `meeting_tokens` (в браузер отдаются только `id, label, created_at, last_used_at`). Отозвать доступ:
`DELETE /rest/v1/meeting_tokens?id=eq.<id>`. Токен выдаёт функция (`action: issue_token`, нужен вход в Канбан),
в базе хранится только SHA-256.
