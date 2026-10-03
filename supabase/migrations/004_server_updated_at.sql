-- answers.updated_at is set by the server, not the browser.
--
-- Why: autosave used to send updated_at itself. That value decides whether a recovered local edit is "older"
-- than the server copy (src/lib/recovery.ts) and is shown to reviewers as "Last edited", so a client that controls it
-- (or a candidate talking to the REST API directly, or a wrong device clock) could misstate it.
-- The trigger overwrites whatever the client sends with now(). Admin / service-role writes get now() too.
-- Idempotent: safe to re-run in the Supabase SQL editor.

create or replace function public.answers_set_updated_at() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists answers_set_updated_at on public.answers;
create trigger answers_set_updated_at
  before insert or update on public.answers
  for each row execute function public.answers_set_updated_at();
