-- Свои файлы в задаче: приложение (роль authenticated) может загружать файлы в СВОЮ папку
-- бакета "task-files" ({user_id}/...). Читать и удалять свои файлы можно уже сейчас.
-- Типы файлов расширены документами; лимит 20 МБ на файл не меняется.

update storage.buckets
set allowed_mime_types = array[
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/wav',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain', 'text/csv'
]
where id = 'task-files';

drop policy if exists "Upload my task files" on storage.objects;
create policy "Upload my task files"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'task-files'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
