-- Administrators of FinTech Kanban.
--
-- Members of this table can open the in-app "Пользователи" panel and block or
-- unblock other accounts through the admin-users Edge Function. The table is
-- read only by Edge Functions (service_role); the browser has no access.

create table if not exists public.kanban_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.kanban_admins enable row level security;

revoke all on table public.kanban_admins from public, anon, authenticated;

-- Initial administrator: the project owner's Kanban account.
insert into public.kanban_admins (user_id)
select id from auth.users where lower(email) = 'v.n.yakovlev@tmn4.etagi.com'
on conflict (user_id) do nothing;
