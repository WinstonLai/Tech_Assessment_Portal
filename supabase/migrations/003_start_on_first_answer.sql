-- Stamp started_at / in_progress when a candidate first writes an answer, not only on the first heartbeat().
--
-- Why: active_seconds is reported by the browser through heartbeat(); the server only validates the gaps.
-- A candidate who talks to the REST API directly can write answers and submit without ever sending a
-- heartbeat. Before this, submit_assessment() then set started_at = submitted_at (elapsed 0), which made the
-- wall-clock span useless as a cross-check. With this trigger started_at is set by the server at the first
-- answer write, so (submitted_at - started_at) is a figure the candidate cannot shorten after the fact.
-- active_seconds itself stays advisory (see README).
--
-- Only candidate writes count: admin / service-role edits have auth.uid() null or different from
-- candidate_id. The UPDATE is a no-op (and takes no row lock) once the candidate has started.
-- Idempotent: safe to re-run in the Supabase SQL editor.

create or replace function public.answers_mark_started() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and auth.uid() = new.candidate_id then
    update public.candidates set
      started_at = coalesce(started_at, now()),
      status     = case when status = 'not_started' then 'in_progress'::public.candidate_status else status end
    where id = new.candidate_id
      and status <> 'submitted'
      and (started_at is null or status = 'not_started');
  end if;
  return new;
end $$;

revoke all on function public.answers_mark_started() from public, anon, authenticated;

drop trigger if exists answers_mark_started on public.answers;
create trigger answers_mark_started
  after insert or update on public.answers
  for each row execute function public.answers_mark_started();
