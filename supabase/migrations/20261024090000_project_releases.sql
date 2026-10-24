-- Project releases: presentations / texts attached to a project, with an
-- AI-made card (title, date, summary, changes, tags) and full-text search.
--
-- * project_releases      - one row per release card; the extracted text is
--                           searchable (Russian full-text search).
-- * storage bucket        - private bucket "project-releases" for the source files.
--
-- Access follows the project: a release of a shared project is visible to and
-- editable by every member of that project; a release of a personal project is
-- visible only to its owner.

create table if not exists public.project_releases (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  -- null = personal project of owner_id (identified by project_name);
  -- set   = shared project (project_name is a display copy).
  shared_project_id uuid references public.shared_projects (id) on delete cascade,
  project_name text not null check (char_length(project_name) between 1 and 200),
  title text not null check (char_length(title) between 1 and 300),
  version text not null default '' check (char_length(version) <= 60),
  released_on date not null default current_date,
  summary text not null default '' check (char_length(summary) <= 4000),
  changes jsonb not null default '[]'::jsonb check (jsonb_typeof(changes) = 'array'),
  tags text[] not null default '{}' check (cardinality(tags) <= 30),
  content text not null default '' check (char_length(content) <= 400000),
  file_path text check (file_path is null or char_length(file_path) <= 500),
  file_name text check (file_name is null or char_length(file_name) <= 300),
  file_type text check (file_type is null or char_length(file_type) <= 120),
  file_size integer check (file_size is null or file_size >= 0),
  search tsvector not null default ''::tsvector,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists project_releases_owner_idx on public.project_releases (owner_id, released_on desc);
create index if not exists project_releases_shared_idx on public.project_releases (shared_project_id, released_on desc);
create index if not exists project_releases_search_idx on public.project_releases using gin (search);

-- Keeps the search vector and updated_at current. Title and tags weigh more
-- than the summary, and the summary more than the full text.
create or replace function private.project_releases_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.search :=
    setweight(to_tsvector('russian', coalesce(new.title, '') || ' ' || coalesce(new.version, '')), 'A') ||
    setweight(to_tsvector('russian', coalesce(array_to_string(new.tags, ' '), '')), 'A') ||
    setweight(to_tsvector('russian', coalesce(new.summary, '') || ' ' || coalesce(new.project_name, '')), 'B') ||
    setweight(to_tsvector('russian', coalesce(new.content, '')), 'C');
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists project_releases_before_write on public.project_releases;
create trigger project_releases_before_write
  before insert or update on public.project_releases
  for each row execute function private.project_releases_before_write();

alter table public.project_releases enable row level security;
revoke all on table public.project_releases from public, anon, authenticated;
grant select, insert, update, delete on table public.project_releases to authenticated;

-- Can the signed-in user see / change this release row?
create or replace function private.can_access_release(rel_owner uuid, rel_shared uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when rel_shared is null then rel_owner = (select auth.uid())
    else private.is_shared_member(rel_shared)
  end;
$$;
revoke all on function private.can_access_release(uuid, uuid) from public;
grant execute on function private.can_access_release(uuid, uuid) to authenticated;

create policy "Read releases of my projects"
  on public.project_releases for select to authenticated
  using (private.can_access_release(owner_id, shared_project_id));

create policy "Add releases to my projects"
  on public.project_releases for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and private.can_access_release(owner_id, shared_project_id)
  );

create policy "Edit releases of my projects"
  on public.project_releases for update to authenticated
  using (private.can_access_release(owner_id, shared_project_id))
  with check (private.can_access_release(owner_id, shared_project_id));

create policy "Delete releases of my projects"
  on public.project_releases for delete to authenticated
  using (private.can_access_release(owner_id, shared_project_id));

-- Source files. Path layout: <uploader user id>/<random>/<file name>.
insert into storage.buckets (id, name, public, file_size_limit)
values ('project-releases', 'project-releases', false, 20971520)
on conflict (id) do update set public = false, file_size_limit = 20971520;

create policy "Upload release files to my folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'project-releases'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "Read release files of my projects"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'project-releases'
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or exists (select 1 from public.project_releases r where r.file_path = storage.objects.name)
    )
  );

create policy "Delete release files of my projects"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'project-releases'
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or exists (select 1 from public.project_releases r where r.file_path = storage.objects.name)
    )
  );
