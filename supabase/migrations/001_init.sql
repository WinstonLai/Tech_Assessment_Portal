-- WellnessTrack Tech Assessment Portal — schema, row-level security, RPCs, storage.
-- Run once in the Supabase SQL editor (or `supabase db push`).

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------
do $$ begin
  create type public.candidate_status as enum ('not_started', 'in_progress', 'submitted');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.answer_type as enum ('rich_text', 'code', 'diagram_plus_text');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table if not exists public.admins (
  user_id    uuid primary key references auth.users on delete cascade,
  email      text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.candidates (
  id                 uuid primary key references auth.users on delete cascade,
  email              text not null unique,
  full_name          text,
  access_expires_at  timestamptz not null,
  is_active          boolean not null default true,
  status             public.candidate_status not null default 'not_started',
  started_at         timestamptz,
  submitted_at       timestamptz,
  active_seconds     integer not null default 0,
  last_heartbeat_at  timestamptz,
  password_issued_at timestamptz,
  created_by         uuid references auth.users on delete set null,
  created_at         timestamptz not null default now()
);

-- Single-row table holding the intro / instructions page (markdown).
create table if not exists public.assessment_info (
  id       integer primary key default 1 check (id = 1),
  title    text not null,
  intro_md text not null
);

create table if not exists public.questions (
  id            text primary key,              -- 'A1', 'B3', ...
  section       text not null,                 -- 'A'
  section_title text not null,
  sort_order    integer not null,
  title         text not null,
  prompt_md     text not null,
  answer_type   public.answer_type not null,
  max_score     numeric not null check (max_score >= 0)
);

create table if not exists public.answers (
  candidate_id    uuid not null references public.candidates on delete cascade,
  question_id     text not null references public.questions on delete cascade,
  rich_text_json  jsonb,
  rich_text_html  text,
  rich_text_plain text,
  code            text,
  code_language   text not null default 'sql' check (code_language in ('sql', 'pyspark')),
  diagram_scene   jsonb,
  diagram_png     text,                         -- data:image/png;base64,... snapshot for review/export
  updated_at      timestamptz not null default now(),
  primary key (candidate_id, question_id)
);

-- Admin-only: model answers and keyword rubric.
create table if not exists public.answer_key (
  question_id     text primary key references public.questions on delete cascade,
  model_answer_md text not null,
  rubric          jsonb not null default '[]'::jsonb
);

-- Admin-only: marks per candidate per question.
create table if not exists public.marks (
  candidate_id     uuid not null references public.candidates on delete cascade,
  question_id      text not null references public.questions on delete cascade,
  auto_score       numeric,
  rubric_hits      jsonb,
  final_score      numeric,
  reviewer_comment text,
  reviewed_by      uuid references auth.users on delete set null,
  reviewed_at      timestamptz,
  primary key (candidate_id, question_id)
);

-- ---------------------------------------------------------------------------
-- Helper predicates (security definer so they can be used inside policies)
-- ---------------------------------------------------------------------------
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

create or replace function public.candidate_has_access() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.candidates
    where id = auth.uid() and is_active and now() < access_expires_at
  );
$$;

create or replace function public.candidate_can_edit() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.candidates
    where id = auth.uid() and is_active and now() < access_expires_at and status <> 'submitted'
  );
$$;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
alter table public.admins          enable row level security;
alter table public.candidates      enable row level security;
alter table public.assessment_info enable row level security;
alter table public.questions       enable row level security;
alter table public.answers         enable row level security;
alter table public.answer_key      enable row level security;
alter table public.marks           enable row level security;

drop policy if exists admins_select on public.admins;
create policy admins_select on public.admins for select
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists candidates_self_select on public.candidates;
create policy candidates_self_select on public.candidates for select
  using (id = auth.uid() or public.is_admin());
drop policy if exists candidates_admin_write on public.candidates;
create policy candidates_admin_write on public.candidates for all
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists info_select on public.assessment_info;
create policy info_select on public.assessment_info for select
  using (public.candidate_has_access() or public.is_admin());
drop policy if exists info_admin_write on public.assessment_info;
create policy info_admin_write on public.assessment_info for all
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists questions_select on public.questions;
create policy questions_select on public.questions for select
  using (public.candidate_has_access() or public.is_admin());
drop policy if exists questions_admin_write on public.questions;
create policy questions_admin_write on public.questions for all
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists answers_select on public.answers;
create policy answers_select on public.answers for select
  using ((candidate_id = auth.uid() and public.candidate_has_access()) or public.is_admin());
drop policy if exists answers_insert on public.answers;
create policy answers_insert on public.answers for insert
  with check (candidate_id = auth.uid() and public.candidate_can_edit());
drop policy if exists answers_update on public.answers;
create policy answers_update on public.answers for update
  using (candidate_id = auth.uid() and public.candidate_can_edit())
  with check (candidate_id = auth.uid() and public.candidate_can_edit());
drop policy if exists answers_admin_all on public.answers;
create policy answers_admin_all on public.answers for all
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists answer_key_admin on public.answer_key;
create policy answer_key_admin on public.answer_key for all
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists marks_admin on public.marks;
create policy marks_admin on public.marks for all
  using (public.is_admin()) with check (public.is_admin());

-- Note: candidates can only SELECT their own row; all writes to candidates are admin-only (RLS),
-- so timer/status columns change only through the security-definer RPCs below.

-- ---------------------------------------------------------------------------
-- Active-time tracking (server-authoritative)
--   heartbeat():   client calls every ~30 s while the tab is visible and the user is active.
--                  Time since the previous heartbeat is added only if the gap is <= 90 s.
--   pause_timer(): client calls on tab hide / idle / "Save & exit"; banks time and stops the clock.
-- ---------------------------------------------------------------------------
create or replace function public._bank_active_time(c public.candidates) returns integer
language plpgsql stable as $$
declare delta numeric;
begin
  if c.last_heartbeat_at is null then return c.active_seconds; end if;
  delta := extract(epoch from (now() - c.last_heartbeat_at));
  if delta > 0 and delta <= 90 then
    return c.active_seconds + round(delta)::integer;
  end if;
  return c.active_seconds;
end $$;

create or replace function public.heartbeat() returns public.candidates
language plpgsql security definer set search_path = public as $$
declare c public.candidates;
begin
  select * into c from public.candidates where id = auth.uid() for update;
  if not found then raise exception 'Not a candidate account'; end if;
  if not c.is_active or now() >= c.access_expires_at then
    raise exception 'ACCESS_EXPIRED';
  end if;
  if c.status = 'submitted' then return c; end if;

  update public.candidates set
    active_seconds    = public._bank_active_time(c),
    last_heartbeat_at = now(),
    started_at        = coalesce(started_at, now()),
    status            = 'in_progress'
  where id = c.id
  returning * into c;
  return c;
end $$;

create or replace function public.pause_timer() returns public.candidates
language plpgsql security definer set search_path = public as $$
declare c public.candidates;
begin
  select * into c from public.candidates where id = auth.uid() for update;
  if not found then raise exception 'Not a candidate account'; end if;
  if c.status = 'submitted' then return c; end if;

  update public.candidates set
    active_seconds    = public._bank_active_time(c),
    last_heartbeat_at = null
  where id = c.id
  returning * into c;
  return c;
end $$;

create or replace function public.submit_assessment() returns public.candidates
language plpgsql security definer set search_path = public as $$
declare c public.candidates;
begin
  select * into c from public.candidates where id = auth.uid() for update;
  if not found then raise exception 'Not a candidate account'; end if;
  if not c.is_active or now() >= c.access_expires_at then
    raise exception 'ACCESS_EXPIRED';
  end if;
  if c.status = 'submitted' then return c; end if;

  update public.candidates set
    active_seconds    = public._bank_active_time(c),
    last_heartbeat_at = null,
    started_at        = coalesce(started_at, now()),
    status            = 'submitted',
    submitted_at      = now()
  where id = c.id
  returning * into c;
  return c;
end $$;

revoke all on function public.heartbeat()         from public, anon;
revoke all on function public.pause_timer()       from public, anon;
revoke all on function public.submit_assessment() from public, anon;
grant execute on function public.heartbeat()         to authenticated;
grant execute on function public.pause_timer()       to authenticated;
grant execute on function public.submit_assessment() to authenticated;

-- ---------------------------------------------------------------------------
-- Storage: private bucket for the sample-data zip (signed URLs for valid candidates)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('assessment-data', 'assessment-data', false)
on conflict (id) do nothing;

drop policy if exists assessment_data_read on storage.objects;
create policy assessment_data_read on storage.objects for select
  using (bucket_id = 'assessment-data' and (public.candidate_has_access() or public.is_admin()));

drop policy if exists assessment_data_admin_write on storage.objects;
create policy assessment_data_admin_write on storage.objects for all
  using (bucket_id = 'assessment-data' and public.is_admin())
  with check (bucket_id = 'assessment-data' and public.is_admin());
