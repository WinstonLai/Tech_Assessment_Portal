-- Bound what a candidate can store in `answers`.
-- Candidates write this table directly through the REST API (RLS only checks *who* writes, not *what*),
-- so without limits one account could fill the free-tier database or send payloads that freeze the
-- admin's browser during review / Word export. `diagram_png` must also be an inline PNG, never a URL
-- (the admin's browser would fetch it).
-- Sizes use the logical length (octet_length of the text form), not pg_column_size, which reports the
-- compressed TOAST size and so would not bound highly compressible payloads.
-- The diagram limit is generous because pasted screenshots are embedded in `diagram_scene.files` as base64.
-- NOT VALID: applies to new and updated rows only, so existing data can never block the migration.
-- Idempotent: safe to re-run in the Supabase SQL editor.

do $$ begin
  alter table public.answers add constraint answers_size_limits check (
    coalesce(length(rich_text_html), 0)            <= 1000000 and
    coalesce(length(rich_text_plain), 0)           <= 500000  and
    coalesce(length(code), 0)                      <= 200000  and
    coalesce(octet_length(rich_text_json::text), 0) <= 2000000 and
    coalesce(octet_length(diagram_scene::text), 0)  <= 20000000
  ) not valid;
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.answers add constraint answers_diagram_png_format check (
    diagram_png is null
    or (left(diagram_png, 22) = 'data:image/png;base64,' and length(diagram_png) <= 6000000)
  ) not valid;
exception when duplicate_object then null; end $$;
