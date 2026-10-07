-- Cap what one candidate can store across ALL of their `answers` rows.
--
-- Why: 002 bounds each row (~29.7 MB worst case) but a candidate has up to 13 rows, so one account could still
-- store ~386 MB through the REST API and fill the 500 MB free-tier database. Past that limit Supabase makes the
-- database read-only and autosave / submit fail for every candidate.
-- Sizing: 15 MB per candidate -> 20 candidates = 300 MB worst case, leaving ~200 MB for Supabase's own schemas,
-- the small tables, auth users and dead space from deleting a batch (Postgres reuses that space for the next batch).
-- Honest answers are kilobytes to a few MB, so this never affects normal use.
--
-- Size is pg_column_size (stored, compressed size): that is what the disk limit counts, and it avoids
-- re-serialising multi-MB jsonb on every autosave. The incoming row is measured uncompressed, which is conservative.
--
-- Safe for work in progress: a write is rejected only when the candidate would be over the cap AND the write makes
-- that row larger than it was. Edits that keep a row the same size or shrink it always succeed, so a candidate who is
-- already over the cap can still edit, shrink and submit. Existing rows are never touched or re-checked.
-- The rejection is a check_violation (23514), which the client already treats as a permanent, visible "Not saved".
-- Idempotent: safe to re-run in the Supabase SQL editor.

create or replace function public.answers_enforce_total_cap() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  cap constant bigint := 15000000;
  new_size bigint;
  old_size bigint := 0;
  others   bigint;
begin
  -- Serialise one candidate's writes so two concurrent saves cannot both pass the check.
  perform pg_advisory_xact_lock(hashtext(new.candidate_id::text));

  new_size := coalesce(pg_column_size(new.rich_text_json), 0) + coalesce(pg_column_size(new.rich_text_html), 0)
            + coalesce(pg_column_size(new.rich_text_plain), 0) + coalesce(pg_column_size(new.code), 0)
            + coalesce(pg_column_size(new.diagram_scene), 0) + coalesce(pg_column_size(new.diagram_png), 0);

  if tg_op = 'UPDATE' then
    old_size := coalesce(pg_column_size(old.rich_text_json), 0) + coalesce(pg_column_size(old.rich_text_html), 0)
              + coalesce(pg_column_size(old.rich_text_plain), 0) + coalesce(pg_column_size(old.code), 0)
              + coalesce(pg_column_size(old.diagram_scene), 0) + coalesce(pg_column_size(old.diagram_png), 0);
  end if;

  select coalesce(sum(
           coalesce(pg_column_size(a.rich_text_json), 0) + coalesce(pg_column_size(a.rich_text_html), 0)
         + coalesce(pg_column_size(a.rich_text_plain), 0) + coalesce(pg_column_size(a.code), 0)
         + coalesce(pg_column_size(a.diagram_scene), 0) + coalesce(pg_column_size(a.diagram_png), 0)), 0)
    into others
    from public.answers a
   where a.candidate_id = new.candidate_id and a.question_id <> new.question_id;

  if others + new_size > cap and new_size > old_size then
    raise exception 'answers_total_size_limit: this candidate''s answers exceed the % MB total storage limit',
      cap / 1000000
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists answers_enforce_total_cap on public.answers;
create trigger answers_enforce_total_cap
  before insert or update on public.answers
  for each row execute function public.answers_enforce_total_cap();
