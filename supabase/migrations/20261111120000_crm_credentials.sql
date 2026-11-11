-- Логин и пароль внешней CRM, которые владелец вводит в приложении.
-- Пароль хранится только зашифрованным (AES-GCM, ключ — секрет функции crm-sync CRM_CRED_KEY).
-- Таблицу читает и пишет только сама функция (service role): клиентам (anon, authenticated) доступа нет.

create table if not exists public.crm_credentials (
  id boolean primary key default true check (id),   -- единственная запись: интеграция личная
  login text not null check (char_length(login) between 1 and 200),
  password_enc text not null check (char_length(password_enc) between 1 and 2000),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);

alter table public.crm_credentials enable row level security;
revoke all on public.crm_credentials from anon, authenticated;
-- политик намеренно нет: через API таблица недоступна
