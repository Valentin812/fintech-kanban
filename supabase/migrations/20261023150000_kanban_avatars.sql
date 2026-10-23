-- Profile photos for registered accounts.
-- Stored as a small (client-resized, <= ~45 KB) data URL; anyone signed in can see
-- colleagues' photos, each user can only change or remove their own.
create table if not exists public.kanban_avatars (
  user_id uuid primary key references auth.users(id) on delete cascade default auth.uid(),
  image text not null check (
    image ~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$' and length(image) <= 60000
  ),
  updated_at timestamptz not null default now()
);

alter table public.kanban_avatars enable row level security;

revoke all on public.kanban_avatars from anon, authenticated;
grant select, insert, update, delete on public.kanban_avatars to authenticated;

create policy "Signed-in users can view avatars" on public.kanban_avatars
  for select to authenticated using (auth.uid() is not null);
create policy "Users insert their own avatar" on public.kanban_avatars
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "Users update their own avatar" on public.kanban_avatars
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "Users delete their own avatar" on public.kanban_avatars
  for delete to authenticated using (user_id = (select auth.uid()));
