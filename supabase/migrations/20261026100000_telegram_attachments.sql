-- Telegram tasks: original screenshot / voice file attached to the task, and a
-- short "which project?" step in the bot before the task reaches the app.
--
-- * telegram_inbox.attachment  - {path, name, type, size, kind} of the file in
--                                the "task-files" bucket (null = no file).
-- * telegram_inbox.status      - 'pending' while the bot waits for the user to
--                                pick a project, otherwise 'ready'. The app
--                                imports pending rows after 10 minutes anyway.
-- * telegram_inbox.choices     - project names offered as buttons, so a button
--                                press maps to the same name later.
-- * storage bucket "task-files" (private). Files are written only by the bot
--   (service role) into <user id>/... . A file can be read by its owner and by
--   members of the shared project whose task references it.

alter table public.telegram_inbox
  add column if not exists attachment jsonb,
  add column if not exists status text not null default 'ready',
  add column if not exists choices text[] not null default '{}';

alter table public.telegram_inbox
  drop constraint if exists telegram_inbox_status_check;
alter table public.telegram_inbox
  add constraint telegram_inbox_status_check check (status in ('ready', 'pending'));
alter table public.telegram_inbox
  drop constraint if exists telegram_inbox_attachment_check;
alter table public.telegram_inbox
  add constraint telegram_inbox_attachment_check check (attachment is null or jsonb_typeof(attachment) = 'object');

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('task-files', 'task-files', false, 20971520,
        array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/wav'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- True when the current user is a member of a shared project that has a task
-- referencing this file.
create or replace function private.can_read_task_file(object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.shared_tasks st
    join public.shared_project_members m
      on m.project_id = st.project_id and m.user_id = (select auth.uid())
    where st.data -> 'attachments' @> jsonb_build_array(jsonb_build_object('path', object_name))
  );
$$;

revoke all on function private.can_read_task_file(text) from public;
grant execute on function private.can_read_task_file(text) to authenticated;

drop policy if exists "Read task files of my tasks" on storage.objects;
create policy "Read task files of my tasks"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'task-files'
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or private.can_read_task_file(name)
    )
  );

drop policy if exists "Delete my task files" on storage.objects;
create policy "Delete my task files"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'task-files'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
