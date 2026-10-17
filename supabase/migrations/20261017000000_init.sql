-- Mind Dump — initial schema.
-- Run once in the Supabase dashboard: SQL Editor → New query → paste → Run.
-- Safe to re-run: every statement is idempotent.

-- ---------------------------------------------------------------------------
-- Profiles: one row per auth user (display name, room for future settings).
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 100),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles: read own" on public.profiles;
create policy "profiles: read own" on public.profiles
  for select to authenticated using ((select auth.uid()) = id);

drop policy if exists "profiles: update own" on public.profiles;
create policy "profiles: update own" on public.profiles
  for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

-- Create/refresh the profile whenever an auth user is created or their metadata changes.
create or replace function public.sync_profile_from_auth()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, left(coalesce(new.raw_user_meta_data ->> 'display_name', ''), 100))
  on conflict (id) do update
    set display_name = excluded.display_name,
        updated_at   = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.sync_profile_from_auth();

drop trigger if exists on_auth_user_meta_updated on auth.users;
create trigger on_auth_user_meta_updated
  after update of raw_user_meta_data on auth.users
  for each row execute function public.sync_profile_from_auth();

-- ---------------------------------------------------------------------------
-- Dumps
-- ---------------------------------------------------------------------------
create table if not exists public.dumps (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  content      text not null,
  position     double precision not null default 0,
  status       text not null default 'active' check (status in ('active', 'done')),
  completed_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Total length is capped (not just the trimmed text), so whitespace padding can't bloat rows.
alter table public.dumps drop constraint if exists dumps_content_check;
alter table public.dumps add constraint dumps_content_check
  check (char_length(content) <= 5000 and char_length(btrim(content)) >= 1);

-- Board query: active dumps by position. History query: done dumps by completion time.
create index if not exists dumps_user_active_position_idx
  on public.dumps (user_id, position) where status = 'active';
create index if not exists dumps_user_done_completed_idx
  on public.dumps (user_id, completed_at desc) where status = 'done';

alter table public.dumps enable row level security;

drop policy if exists "dumps: read own" on public.dumps;
create policy "dumps: read own" on public.dumps
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "dumps: insert own" on public.dumps;
create policy "dumps: insert own" on public.dumps
  for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists "dumps: update own" on public.dumps;
create policy "dumps: update own" on public.dumps
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "dumps: delete own" on public.dumps;
create policy "dumps: delete own" on public.dumps
  for delete to authenticated using ((select auth.uid()) = user_id);

-- Server-authoritative timestamps: updated_at always, completed_at on status change.
create or replace function public.dumps_set_timestamps()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    -- Identity and creation time are immutable: "days pending" can't be rewritten via the API.
    new.id := old.id;
    new.user_id := old.user_id;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.completed_at := case when new.status = 'done' then now() else null end;
  elsif new.status is distinct from old.status then
    new.completed_at := case when new.status = 'done' then now() else null end;
  else
    new.completed_at := old.completed_at;
  end if;
  return new;
end;
$$;

drop trigger if exists dumps_set_timestamps on public.dumps;
create trigger dumps_set_timestamps
  before insert or update on public.dumps
  for each row execute function public.dumps_set_timestamps();

-- Per-user cap: keeps one account from exhausting the free-tier database.
create or replace function public.dumps_enforce_quota()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select count(*) from public.dumps where user_id = new.user_id) >= 20000 then
    raise exception 'Dump limit reached (20000). Clear some history first.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists dumps_enforce_quota on public.dumps;
create trigger dumps_enforce_quota
  before insert on public.dumps
  for each row execute function public.dumps_enforce_quota();

-- Batch reorder in one round trip. Runs as the caller, so RLS still applies.
create or replace function public.set_dump_positions(p_ids uuid[], p_positions double precision[])
returns void
language sql
security invoker
set search_path = ''
as $$
  update public.dumps as d
     set position = u.pos
    from unnest(p_ids, p_positions) as u(id, pos)
   where d.id = u.id
     and d.user_id = (select auth.uid());
$$;

revoke all on function public.set_dump_positions(uuid[], double precision[]) from public, anon;
grant execute on function public.set_dump_positions(uuid[], double precision[]) to authenticated;

-- ---------------------------------------------------------------------------
-- Realtime: live sync between a user's devices (RLS still filters events).
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'dumps'
     ) then
    alter publication supabase_realtime add table public.dumps;
  end if;
end;
$$;
