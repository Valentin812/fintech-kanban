-- Shared projects: a project that several Kanban users work on together.
--
-- * shared_projects        - name + column settings (meta) of the project
-- * shared_project_members - who has access; exactly one 'owner' per project
-- * shared_tasks           - one row per task, so two people editing different
--                            tasks never overwrite each other
--
-- Members read and edit the project, its tasks and columns directly (RLS).
-- Creating a project, inviting/removing members, leaving and deleting go
-- through the shared-projects Edge Function (service_role), which enforces
-- the owner-only rules.

create schema if not exists private;

create table if not exists public.shared_projects (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 200),
  owner_id uuid not null references auth.users (id) on delete cascade,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.shared_project_members (
  project_id uuid not null references public.shared_projects (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'editor' check (role in ('owner', 'editor')),
  added_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

create index if not exists shared_project_members_user_idx
  on public.shared_project_members (user_id);

create table if not exists public.shared_tasks (
  project_id uuid not null references public.shared_projects (id) on delete cascade,
  task_id bigint not null,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  primary key (project_id, task_id)
);

-- Membership check used by RLS. SECURITY DEFINER so policies on the members
-- table do not recurse; it lives in a schema that the API does not expose.
create or replace function private.is_shared_member(pid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.shared_project_members m
    where m.project_id = pid and m.user_id = (select auth.uid())
  );
$$;

revoke all on function private.is_shared_member(uuid) from public;
grant usage on schema private to authenticated;
grant execute on function private.is_shared_member(uuid) to authenticated;

alter table public.shared_projects enable row level security;
alter table public.shared_project_members enable row level security;
alter table public.shared_tasks enable row level security;

revoke all on table public.shared_projects, public.shared_project_members, public.shared_tasks
  from public, anon, authenticated;

grant select on table public.shared_projects to authenticated;
grant update (name, meta, updated_at) on table public.shared_projects to authenticated;
grant select on table public.shared_project_members to authenticated;
grant select, insert, update, delete on table public.shared_tasks to authenticated;

create policy "Members read shared projects"
  on public.shared_projects for select to authenticated
  using (private.is_shared_member(id));

create policy "Members edit shared projects"
  on public.shared_projects for update to authenticated
  using (private.is_shared_member(id))
  with check (private.is_shared_member(id));

create policy "Members see co-members"
  on public.shared_project_members for select to authenticated
  using (private.is_shared_member(project_id));

create policy "Members read shared tasks"
  on public.shared_tasks for select to authenticated
  using (private.is_shared_member(project_id));

create policy "Members add shared tasks"
  on public.shared_tasks for insert to authenticated
  with check (private.is_shared_member(project_id) and updated_by = (select auth.uid()));

create policy "Members edit shared tasks"
  on public.shared_tasks for update to authenticated
  using (private.is_shared_member(project_id))
  with check (private.is_shared_member(project_id) and updated_by = (select auth.uid()));

create policy "Members delete shared tasks"
  on public.shared_tasks for delete to authenticated
  using (private.is_shared_member(project_id));

-- Notifications can point at a shared task so the bell can open it.
alter table public.notifications
  add column if not exists project_id uuid references public.shared_projects (id) on delete set null,
  add column if not exists task_id bigint;
