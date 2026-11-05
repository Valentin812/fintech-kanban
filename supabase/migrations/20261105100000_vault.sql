-- Личный сейф: одна зашифрованная запись на пользователя.
-- Шифрование выполняется в браузере (PBKDF2 + AES-GCM) по мастер-паролю, который нигде не хранится.
-- В базе лежит только шифротекст (payload): прочитать его без мастер-пароля нельзя.
-- Доступ — только владелец (RLS).

create table if not exists public.vault (
  owner_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  payload text not null check (char_length(payload) between 1 and 400000),
  updated_at timestamptz not null default now()
);

alter table public.vault enable row level security;

revoke all on public.vault from anon;
grant select, insert, update, delete on public.vault to authenticated;

drop policy if exists "Vault select own" on public.vault;
drop policy if exists "Vault insert own" on public.vault;
drop policy if exists "Vault update own" on public.vault;
drop policy if exists "Vault delete own" on public.vault;

create policy "Vault select own" on public.vault for select to authenticated
  using (owner_id = (select auth.uid()));
create policy "Vault insert own" on public.vault for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy "Vault update own" on public.vault for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "Vault delete own" on public.vault for delete to authenticated
  using (owner_id = (select auth.uid()));
