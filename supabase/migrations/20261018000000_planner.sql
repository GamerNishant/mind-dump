-- Mind Dump — planner (Today list, routines, focus blocks, time log, day plans/reviews, if-then rules).
-- Run once in the Supabase dashboard: SQL Editor → New query → paste → Run.
-- Safe to re-run: every statement is idempotent.
--
-- One generic document table instead of a table per feature: each row is a small JSON document
-- of a given `kind`, optionally tied to a local calendar `day`. New planner features can then
-- ship without another migration. RLS locks every row to its owner, exactly like `dumps`.

create table if not exists public.planner_docs (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind       text not null,
  day        text,
  data       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.planner_docs drop constraint if exists planner_docs_kind_check;
alter table public.planner_docs add constraint planner_docs_kind_check
  check (kind ~ '^[a-z][a-z0-9_]{0,31}$');

alter table public.planner_docs drop constraint if exists planner_docs_day_check;
alter table public.planner_docs add constraint planner_docs_day_check
  check (day is null or day ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$');

-- Documents are small (a task, a day's hour log); cap them so one row can't bloat the database.
alter table public.planner_docs drop constraint if exists planner_docs_data_check;
alter table public.planner_docs add constraint planner_docs_data_check
  check (jsonb_typeof(data) = 'object' and pg_column_size(data) <= 32768);

create index if not exists planner_docs_user_kind_day_idx
  on public.planner_docs (user_id, kind, day);

alter table public.planner_docs enable row level security;

drop policy if exists "planner_docs: read own" on public.planner_docs;
create policy "planner_docs: read own" on public.planner_docs
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "planner_docs: insert own" on public.planner_docs;
create policy "planner_docs: insert own" on public.planner_docs
  for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists "planner_docs: update own" on public.planner_docs;
create policy "planner_docs: update own" on public.planner_docs
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "planner_docs: delete own" on public.planner_docs;
create policy "planner_docs: delete own" on public.planner_docs
  for delete to authenticated using ((select auth.uid()) = user_id);

-- Server-owned timestamps; identity, owner and kind can't change after insert.
create or replace function public.planner_docs_set_timestamps()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    new.id := old.id;
    new.user_id := old.user_id;
    new.kind := old.kind;
    new.created_at := old.created_at;
  else
    new.created_at := now();
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists planner_docs_set_timestamps on public.planner_docs;
create trigger planner_docs_set_timestamps
  before insert or update on public.planner_docs
  for each row execute function public.planner_docs_set_timestamps();

-- Per-user cap, like dumps: keeps one account from exhausting the free-tier database.
create or replace function public.planner_docs_enforce_quota()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select count(*) from public.planner_docs where user_id = new.user_id) >= 50000 then
    raise exception 'Planner limit reached (50000 entries).' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists planner_docs_enforce_quota on public.planner_docs;
create trigger planner_docs_enforce_quota
  before insert on public.planner_docs
  for each row execute function public.planner_docs_enforce_quota();

-- Live sync between a user's devices (RLS still filters events).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'planner_docs'
     ) then
    alter publication supabase_realtime add table public.planner_docs;
  end if;
end;
$$;
