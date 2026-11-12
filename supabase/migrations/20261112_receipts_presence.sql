-- ==============================================================================
-- Hey Darling Migration: Message Receipts (Sent/Delivered/Read) & Presence/Last Seen
-- Tanggal: 2026-11-12
-- ==============================================================================

-- 1. Tambah kolom delivered_at dan read_at pada tabel messages
alter table public.messages
    add column if not exists delivered_at timestamptz default null,
    add column if not exists read_at timestamptz default null;

create index if not exists idx_messages_delivered_at on public.messages (delivered_at) where delivered_at is null;
create index if not exists idx_messages_read_at on public.messages (read_at) where read_at is null;

-- 2. Kebijakan RLS: Penerima pesan dapat memperbarui delivered_at dan read_at
drop policy if exists "Recipient dapat update status pesan" on public.messages;
create policy "Recipient dapat update status pesan"
on public.messages for update
to authenticated
using (
    public.is_registered_user() and
    sender_id != auth.uid()
)
with check (
    public.is_registered_user() and
    sender_id != auth.uid()
);

-- 3. Tambah kolom last_seen_at pada tabel profiles
alter table public.profiles
    add column if not exists last_seen_at timestamptz not null default now();

-- 4. RPC efisien untuk batch update status pesan
create or replace function public.mark_messages_delivered(message_ids uuid[])
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
    updated_count int;
begin
    if not public.is_registered_user() then
        raise exception 'Unauthorized';
    end if;

    update public.messages
    set delivered_at = coalesce(delivered_at, now())
    where id = any(message_ids)
      and sender_id != auth.uid()
      and delivered_at is null;

    get diagnostics updated_count = row_count;
    return updated_count;
end;
$$;

create or replace function public.mark_messages_read(message_ids uuid[])
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
    updated_count int;
begin
    if not public.is_registered_user() then
        raise exception 'Unauthorized';
    end if;

    update public.messages
    set read_at = coalesce(read_at, now()),
        delivered_at = coalesce(delivered_at, now())
    where id = any(message_ids)
      and sender_id != auth.uid()
      and read_at is null;

    get diagnostics updated_count = row_count;
    return updated_count;
end;
$$;

grant execute on function public.mark_messages_delivered(uuid[]) to authenticated;
grant execute on function public.mark_messages_read(uuid[]) to authenticated;

-- 5. Enable Realtime for profiles (optional fallback for last_seen_at updates)
alter publication supabase_realtime add table public.profiles;
