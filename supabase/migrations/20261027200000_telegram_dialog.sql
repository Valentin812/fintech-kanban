-- Состояние диалога с ботом Джарвис: короткая история сообщений на пользователя.
-- Нужна, чтобы бот мог задавать уточняющие вопросы и помнить контекст между сообщениями.
create table if not exists public.telegram_dialog (
  user_id uuid primary key references auth.users (id) on delete cascade,
  history jsonb not null default '[]'::jsonb,   -- последние сообщения [{role, content}], не более ~12
  updated_at timestamptz not null default now()
);

-- RLS включён и политик нет: читает и пишет только Edge Function с service role.
-- Пользователи через клиентский ключ к таблице доступа не получают.
alter table public.telegram_dialog enable row level security;
revoke all on public.telegram_dialog from anon, authenticated;
