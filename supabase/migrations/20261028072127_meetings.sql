-- Meetings: results of recorded meetings (summary, decisions, tasks, transcript) sent from Meeting Hub.
--
-- * public.meetings        - one row per meeting; owner-only (RLS). The "Meetings" tab reads this table.
-- * public.meeting_tokens  - long-lived access tokens for Meeting Hub (only a SHA-256 hash is stored;
--                            the plain token is shown once when it is issued by the meeting-intake function).
-- Rows are written by the meeting-intake edge function (service role) after it has checked a token,
-- or directly by the signed-in owner under RLS.

create schema if not exists private;

create table if not exists public.meetings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  -- stable id from the sender (recording name), makes re-sending an update instead of a duplicate
  external_id text not null check (char_length(external_id) between 1 and 200),
  title text not null check (char_length(title) between 1 and 300),
  held_at timestamptz,
  duration_sec integer check (duration_sec is null or duration_sec >= 0),
  meeting_app text not null default '' check (char_length(meeting_app) <= 120),
  description text not null default '' check (char_length(description) <= 2000),
  summary jsonb not null default '[]'::jsonb check (jsonb_typeof(summary) = 'array'),
  decisions jsonb not null default '[]'::jsonb check (jsonb_typeof(decisions) = 'array'),
  tasks jsonb not null default '[]'::jsonb check (jsonb_typeof(tasks) = 'array'),
  open_questions jsonb not null default '[]'::jsonb check (jsonb_typeof(open_questions) = 'array'),
  transcript text not null default '' check (char_length(transcript) <= 400000),
  project_name text not null default '' check (char_length(project_name) <= 200),
  source text not null default 'meeting-hub' check (char_length(source) <= 60),
  search tsvector not null default ''::tsvector,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, external_id)
);

create index if not exists meetings_owner_idx on public.meetings (owner_id, held_at desc);
create index if not exists meetings_search_idx on public.meetings using gin (search);

create or replace function private.meetings_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.search :=
    setweight(to_tsvector('russian', coalesce(new.title, '') || ' ' || coalesce(new.project_name, '')), 'A') ||
    setweight(to_tsvector('russian', coalesce(new.description, '') || ' ' || coalesce(new.summary::text, '')), 'B') ||
    setweight(to_tsvector('russian', coalesce(new.decisions::text, '') || ' ' || coalesce(new.tasks::text, '')), 'B') ||
    setweight(to_tsvector('russian', coalesce(new.transcript, '')), 'C');
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists meetings_before_write on public.meetings;
create trigger meetings_before_write
  before insert or update on public.meetings
  for each row execute function private.meetings_before_write();

alter table public.meetings enable row level security;
revoke all on table public.meetings from public, anon, authenticated;
grant select, insert, update, delete on table public.meetings to authenticated;

create policy "Read my meetings"
  on public.meetings for select to authenticated
  using (owner_id = (select auth.uid()));

create policy "Add my meetings"
  on public.meetings for insert to authenticated
  with check (owner_id = (select auth.uid()));

create policy "Edit my meetings"
  on public.meetings for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy "Delete my meetings"
  on public.meetings for delete to authenticated
  using (owner_id = (select auth.uid()));

-- Tokens for Meeting Hub. Created only by the edge function; the owner can list and revoke them.
create table if not exists public.meeting_tokens (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  token_hash text not null unique check (char_length(token_hash) = 64),
  label text not null default '' check (char_length(label) <= 120),
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

create index if not exists meeting_tokens_owner_idx on public.meeting_tokens (owner_id);

alter table public.meeting_tokens enable row level security;
revoke all on table public.meeting_tokens from public, anon, authenticated;
grant delete on table public.meeting_tokens to authenticated;
-- Never expose the hash itself to the browser: only these columns can be read.
grant select (id, owner_id, label, created_at, last_used_at) on table public.meeting_tokens to authenticated;

create policy "Read my meeting tokens"
  on public.meeting_tokens for select to authenticated
  using (owner_id = (select auth.uid()));

create policy "Revoke my meeting tokens"
  on public.meeting_tokens for delete to authenticated
  using (owner_id = (select auth.uid()));
