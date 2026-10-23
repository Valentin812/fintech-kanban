-- The owner is the only administrator who can grant or revoke admin rights.
-- Regular administrators can block and unblock users, but cannot change who
-- is an administrator. The owner can never be blocked or demoted.

alter table public.kanban_admins
  add column if not exists is_owner boolean not null default false,
  add column if not exists granted_by uuid references auth.users (id) on delete set null;

update public.kanban_admins a
set is_owner = true
from auth.users u
where u.id = a.user_id and lower(u.email) = 'v.n.yakovlev@tmn4.etagi.com';
