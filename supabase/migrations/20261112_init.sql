-- ==============================================================================
-- Hey Darling: Supabase Initial Migration
-- Tanggal: 2026-11-12
-- Deskripsi: Skema tabel 1-on-1 chat, push subscriptions, 2-user lock, RLS, & keepalive
-- ==============================================================================

-- 1. Whitelist Email Pengguna (Opsional / Diisi 2 email sah)
create table public.allowed_emails (
    email text primary key
);

alter table public.allowed_emails enable row level security;

comment on table public.allowed_emails is 'Daftar email yang diizinkan mendaftar. Jika kosong, maksimal 2 akun pertama diizinkan.';

-- 2. Profil Pengguna
create table public.profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    display_name text not null,
    updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Helper anti-rekursi RLS untuk memverifikasi user terdaftar di profiles
create or replace function public.is_registered_user()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
    select exists (select 1 from public.profiles where id = auth.uid());
$$;

-- RLS: Profil dapat dibaca oleh user yang sudah terdaftar
drop policy if exists "Profil dapat dibaca oleh user sah" on public.profiles;
create policy "Profil dapat dibaca oleh user sah"
on public.profiles for select
to authenticated
using (public.is_registered_user());

-- RLS: User hanya dapat mengupdate profil sendiri
drop policy if exists "User dapat update profil sendiri" on public.profiles;
create policy "User dapat update profil sendiri"
on public.profiles for update
to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

-- 3. Langganan Web Push Multi-Device (Mendukung HP + Laptop sekaligus)
create table public.push_subscriptions (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    endpoint text not null unique,
    p256dh text not null,
    auth text not null,
    user_agent text,
    updated_at timestamptz not null default now()
);

create index idx_push_subs_user_id on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

drop policy if exists "User dapat mengelola push subscription sendiri" on public.push_subscriptions;
create policy "User dapat mengelola push subscription sendiri"
on public.push_subscriptions for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- 4. Pesan Chat (Hanya 1 percakapan bersama antara 2 user)
create table public.messages (
    id uuid primary key default gen_random_uuid(),
    sender_id uuid not null references auth.users(id) on delete cascade,
    body text not null check (char_length(body) between 1 and 2000),
    created_at timestamptz not null default now()
);

create index idx_messages_created_at on public.messages (created_at desc);

alter table public.messages enable row level security;

drop policy if exists "Pesan dapat dibaca oleh user sah" on public.messages;
create policy "Pesan dapat dibaca oleh user sah"
on public.messages for select
to authenticated
using (public.is_registered_user());

drop policy if exists "User dapat kirim pesan atas nama sendiri" on public.messages;
create policy "User dapat kirim pesan atas nama sendiri"
on public.messages for insert
to authenticated
with check (
    auth.uid() = sender_id and
    public.is_registered_user()
);

-- 5. Trigger Pengunci 2 Pengguna Sah (handle_new_user)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
    whitelist_count int;
    current_profiles_count int;
    chosen_display_name text;
begin
    -- Cek apakah ada aturan whitelist
    select count(*) into whitelist_count from public.allowed_emails;
    select count(*) into current_profiles_count from public.profiles;

    if whitelist_count > 0 then
        -- Jika whitelist aktif, email wajib terdaftar
        if not exists (select 1 from public.allowed_emails where lower(email) = lower(new.email)) then
            raise exception 'Pendaftaran ditolak: Email % tidak terdaftar dalam whitelist.', new.email;
        end if;
    else
        -- Jika whitelist kosong, batasi maksimal 2 akun
        if current_profiles_count >= 2 then
            raise exception 'Pendaftaran ditolak: Kuota 2 akun pengguna telah penuh.';
        end if;
    end if;

    -- Tentukan display name (dari raw_user_meta_data atau prefix email)
    chosen_display_name := coalesce(
        nullif(trim(new.raw_user_meta_data->>'display_name'), ''),
        split_part(new.email, '@', 1)
    );

    insert into public.profiles (id, display_name, updated_at)
    values (new.id, chosen_display_name, now());

    return new;
end;
$$;

-- Pasang trigger pada auth.users
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();

-- 6. RPC Keep-Alive (Anti-Pause Supabase Free Tier)
create or replace function public.keep_alive()
returns int
language sql
security definer
as $$
    select 1;
$$;

grant execute on function public.keep_alive() to anon, authenticated;

-- Aktifkan Realtime Replication untuk tabel messages
alter publication supabase_realtime add table public.messages;
