-- Tasks sent to the Telegram bot.
--
-- The bot (service_role) stores each message here; the user's app picks the
-- rows up, turns them into tasks on the user's board and marks them consumed.
-- A separate table is needed because the personal board is saved as one JSON
-- document — writing into it from the bot could be overwritten by an open app.

create table if not exists public.telegram_inbox (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  description text not null default '',
  due text not null default '',
  project_hint text not null default '',
  created_at timestamptz not null default now(),
  consumed_at timestamptz
);

create index if not exists telegram_inbox_user_idx
  on public.telegram_inbox (user_id, created_at);

alter table public.telegram_inbox enable row level security;

revoke all on table public.telegram_inbox from public, anon, authenticated;
grant select on table public.telegram_inbox to authenticated;
grant update (consumed_at) on table public.telegram_inbox to authenticated;

create policy "Users read own telegram inbox"
  on public.telegram_inbox for select to authenticated
  using (user_id = (select auth.uid()));

create policy "Users consume own telegram inbox"
  on public.telegram_inbox for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
