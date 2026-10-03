# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

An online tech assessment portal for shortlisting HPB CDOO Data Engineering interns. It is a static React SPA (Vite, TypeScript, Tailwind v4, HashRouter) deployed to GitHub Pages, backed by Supabase (Postgres + RLS, Auth, one Edge Function, Storage). There is no app server: every authorization rule is enforced in Postgres RLS / security-definer functions or in the Edge Function.

## Commands

```bash
npm run dev            # Vite dev server (needs .env.local with VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)
npm run build          # tsc -p tsconfig.json && vite build
npm run typecheck
npm test               # vitest run
npx vitest run src/lib/marking.test.ts -t "caps at max"   # single test
npm run seed:generate  # private/assessment_content.mjs -> supabase/seed/{questions,answer_key}.sql (+ validation)
npm run data:zip       # HPB_Interview_Materials CSVs -> private/wellnesstrack_sample_data.zip
```

There is no linter configured. `tsconfig.json` excludes `*.test.ts` (tests use node APIs and are type-checked only by vitest).

Deploy: pushing to `main` runs `.github/workflows/deploy.yml` (npm ci → test → build with the `VITE_SUPABASE_*` repo secrets → GitHub Pages). Live URL: https://winstonlai.github.io/Tech_Assessment_Portal/. Supabase project ref: `giqqreoohsuwrxngxdkq`.

## Confidentiality: the most important constraint

The repo is **public** because free GitHub Pages requires it. Assessment content must never reach git:

- `private/` (gitignored) is the source of truth: `assessment_content.mjs` holds the questions, model answers, keyword rubrics and weights, and it imports `model_code.json`. `private.example/` documents the format.
- `supabase/seed/*.sql` is generated from it and also gitignored. You apply it by pasting it into the Supabase SQL editor; it upserts, so re-running is safe.
- `HPB_Interview_Materials/` (the original Word docs + CSVs) is gitignored.
- Never move question or answer text into `src/` or any committed file. Content changes go: edit `private/assessment_content.mjs` → `npm run seed:generate` → re-run both seed SQL files in Supabase → click "Recalculate auto-scores" on a review page.
- The `VITE_SUPABASE_*` values are compiled into the public JS bundle. Only the anon/publishable key belongs there, never the service-role key.

`scripts/generate-seed.mjs` fails if any question's rubric points don't sum to its `max_score`, if the total isn't 100, or if a regex doesn't compile.

## Architecture

**Roles** are resolved client-side in `src/lib/auth.tsx`: a row in `admins` makes the user an admin, a row in `candidates` makes them a candidate, otherwise they have no access. If the lookup itself fails (network or outage) the role is `'error'`, which shows a retry screen rather than "not registered". Route guards in `src/App.tsx` (`RequireCandidate` / `RequireAdmin`) redirect on status (submitted → `/submitted`; inactive or expired → blocked). The real enforcement is server-side.

**Database** (`supabase/migrations/001_init.sql`, `002_answer_limits.sql`, `003_start_on_first_answer.sql`, all idempotent and applied in order; 002 adds the size caps and inline-PNG check on `answers`, 003 a trigger that stamps `started_at` on the first answer write):
- Helper predicates `is_admin()`, `candidate_has_access()` (active and not expired) and `candidate_can_edit()` (that, plus not submitted) are used by every RLS policy.
- `answer_key` and `marks` are admin-only. `questions` and `assessment_info` are readable only by candidates with valid access. A candidate can write their own `answers` only while `candidate_can_edit()` holds.
- Candidates can SELECT their own `candidates` row but never write it. Timer and status columns change only through the security-definer RPCs `heartbeat()`, `pause_timer()` and `submit_assessment()`.

**Active-time timer** (client-reported, server-validated; advisory, not tamper-proof):
- `src/lib/useActiveTimer.ts` sends a `heartbeat` every 30 s while the tab is visible and there has been input within 5 min.
- It calls `pause_timer` when the tab is hidden, the candidate is idle, or they use Save & exit.
- The server adds the elapsed time only if the gap since `last_heartbeat_at` is ≤ 90 s (`_bank_active_time`). `pause_timer` sets `last_heartbeat_at` to null so the next heartbeat starts fresh.
- A candidate calling the REST API directly can write answers without heartbeats, so `active_seconds` can only under-report. The trustworthy figure is `submitted_at - started_at` (`elapsedSeconds`, shown as "Elapsed" on `ReviewPage`): migration 003's trigger stamps `started_at` on the first answer write, so it does not depend on heartbeats.

**Candidate accounts** are real Supabase Auth users. They are created or rotated only by the Edge Function `supabase/functions/admin-candidates` (Deno, service-role key, actions `create` / `reset_password` / `delete`). It checks the caller against `admins`. Expiry and enable/disable are plain admin `UPDATE`s on `candidates` from the UI. `reset_password` never changes `is_active` (the UI warns if the candidate is still disabled) and does not end existing sessions; only Disable blocks a signed-in candidate.

**Answers**: one `answers` row per (candidate, question). It holds rich text (Tiptap JSON + HTML + plain text), `code` + `code_language` ('sql' or 'pyspark'), and `diagram_scene` (Excalidraw JSON) + `diagram_png` (a data-URL snapshot used for review and Word export).
- `src/lib/useAutosave.ts` debounces partial patches. It upserts **one row per request** on purpose: a bulk upsert would null out the columns missing from other rows.
- Unsynced patches (and the time of each local edit) are mirrored to localStorage and re-applied on the next load, unless the server already holds a newer copy of that answer (`shouldApplyRecovered` in `src/lib/recovery.ts`); the candidate is told when that happens.
- Question `answer_type` (`rich_text` | `code` | `diagram_plus_text`) drives which editors `AssessmentPage` renders. Code questions also get an optional notes rich-text box.

**Marking** (`src/lib/marking.ts`) is pure and runs in the admin's browser. `ReviewPage` and the "Auto-score submitted" button on `CandidatesPage` both go through `computeAutoMarks`. A candidate with no `marks` rows is "not marked" (blank in the CSV, left out of the ranking), never 0:
- Each rubric item has case-insensitive regex `patterns`, `match` ('any' or 'all') and a `source`.
  - 'text' means rich text plus the diagram's text labels.
  - 'code' falls back to the notes text if the code box is empty.
- The auto score is the sum of the matched items' points, capped at `max_score`. It is upserted into `marks` together with `rubric_hits`.
- The reviewer's `final_score` overrides it (null means use the auto score), and `effectiveScore` / `sectionTotals` apply that rule everywhere.
- The test suite also checks the real answer key from `private/answer_key.generated.json` when that file exists: each model answer must score ≥ 85% and an off-topic answer ≤ 20%. The test is skipped in CI, where the file is absent.

**Word export** (`src/lib/exportDocx.ts`, `docx` library, client-side) converts prompt and model-answer markdown (via `marked.lexer`) and candidate Tiptap JSON into docx. It embeds `diagram_png` and renders code in monospace. `buildSummaryReport` produces the ranked all-candidates table. The CSV summary lives in `CandidatesPage`.

Heavy editors are lazy-loaded: `AssessmentPage`, the admin pages and `DiagramEditor` (Excalidraw, around 1 MB). `vite.config.ts` uses `base: './'` with HashRouter so the build works from any Pages sub-path, and defines `process.env.IS_PREACT` for Excalidraw.

## Gotchas

- `supabase.functions.invoke` errors carry the JSON body in `error.context`; use `errorMessage()` from `src/lib/supabase.ts` to surface it.
- The login page maps only "Invalid login credentials" to the friendly message. Keep other errors visible, because a bad API key was once hidden behind "Incorrect email or password".
- Supabase free projects pause after 7 days without activity.
- **Dependency overrides:** `package.json` `overrides` pin patched `nanoid`, `lodash-es` and `sass` under Excalidraw so that `npm audit --omit=dev` is clean. Do not run `npm audit fix --force` (it downgrades Excalidraw). After bumping Excalidraw, re-check the overrides still apply (`npm ls nanoid lodash-es sass`).
