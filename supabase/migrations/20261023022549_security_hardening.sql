-- Security hardening for FinTech Kanban.
--
-- 1. Least-privilege table grants. The browser app only talks to the
--    database as `authenticated` and only needs:
--      kanban_state        select, insert, update  (own row, enforced by RLS)
--      kanban_profiles     select                  (participant directory)
--      messenger_accounts  select                  (own Telegram link)
--      telegram_link_codes nothing                 (Edge Functions only)
--    The `anon` role needs no table access at all. Edge Functions use
--    service_role and are not affected. RLS policies are unchanged.
-- 2. kanban_sync_profile() is a trigger function: nobody should be able to
--    call it through the API. Triggers keep working without EXECUTE grants.
-- 3. telegram_notification_log: server-side log used by the telegram-notify
--    Edge Function for rate limiting. Not reachable from the browser.

revoke all on table
  public.kanban_state,
  public.kanban_profiles,
  public.messenger_accounts,
  public.telegram_link_codes
from anon;

revoke all on table
  public.kanban_state,
  public.kanban_profiles,
  public.messenger_accounts,
  public.telegram_link_codes
from authenticated;

grant select, insert, update on table public.kanban_state to authenticated;
grant select on table public.kanban_profiles to authenticated;
grant select on table public.messenger_accounts to authenticated;

revoke execute on function public.kanban_sync_profile() from public, anon, authenticated;

create table if not exists public.telegram_notification_log (
  id bigint generated always as identity primary key,
  sender_id uuid not null references auth.users (id) on delete cascade,
  recipient_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists telegram_notification_log_sender_idx
  on public.telegram_notification_log (sender_id, created_at desc);

alter table public.telegram_notification_log enable row level security;

revoke all on table public.telegram_notification_log from public, anon, authenticated;
