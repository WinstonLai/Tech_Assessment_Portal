# WellnessTrack Tech Assessment Portal

Online technical assessment for HPB CDOO Data Engineering intern candidates.
Static React app (GitHub Pages) + Supabase free tier (Postgres, Auth, Row-Level Security, Edge Function, Storage).

**Candidates** sign in with their email and a password you issue. They answer 13 questions, each with a suitable editor: rich text, a SQL/PySpark code editor with syntax highlighting, or an Excalidraw canvas for the ERD and star-schema questions. Answers autosave. Candidates can *Save & exit* and resume later, and only **active** time is recorded.

**Admins** create candidates, issue or rotate passwords, set access expiry, and review submissions. Each review shows the candidate's answer next to the model answer, a keyword auto-score you can override, and comments. Admins can export a **Word report** per candidate and a summary (Word or CSV) across all candidates.

---

## ⚠️ Confidentiality

A free GitHub Pages site requires a **public** repo, so no assessment content is ever committed:

| Path | Contents | Committed? |
|---|---|---|
| `HPB_Interview_Materials/` | original Word docs + CSVs | ❌ gitignored |
| `private/assessment_content.mjs` | questions, model answers, keyword rubrics (source of truth) | ❌ gitignored |
| `supabase/seed/*.sql` | generated seed SQL | ❌ gitignored |
| `private.example/` | format example only | ✅ |

Questions are served from the database only to signed-in candidates whose access is still valid. Model answers and marks are readable **only by admins** (enforced by RLS).
Keep a backup of `private/` somewhere safe, such as OneDrive. Another option is to host from a **private** repo on Cloudflare Pages or Netlify, both free.

---

## One-time setup (~20 minutes)

### 1. Supabase project
1. Create a free project at <https://supabase.com>.
2. **Authentication → Sign In / Providers → Email**: keep Email enabled. Turn **off** “Allow new users to sign up” and turn **off** “Confirm email”. Candidates are created only by the admin function.
3. **SQL Editor** → run, in order:
   1. `supabase/migrations/001_init.sql`
   2. `supabase/migrations/002_answer_limits.sql` (size caps on answers and the inline-PNG check on diagram snapshots; skipping it leaves those protections off)
   3. `supabase/seed/questions.sql` (generate first, see below)
   4. `supabase/seed/answer_key.sql`

   To check that the limits are active, run `select conname from pg_constraint where conrelid = 'public.answers'::regclass;`. The result should include `answers_size_limits` and `answers_diagram_png_format`.
4. **Storage → `assessment-data` bucket** (created by the migration) → upload `private/wellnesstrack_sample_data.zip`.

Generate the seed SQL and the data zip locally:
```bash
npm install
npm run seed:generate   # validates rubric totals (=100) and writes supabase/seed/*.sql
npm run data:zip        # writes private/wellnesstrack_sample_data.zip from HPB_Interview_Materials/
```

### 2. Admin account(s)
1. **Authentication → Users → Add user** → your email plus a strong password (tick *Auto confirm*).
2. SQL Editor:
   ```sql
   insert into public.admins (user_id, email)
   select id, email from auth.users where email = 'you@example.com';
   ```
   Repeat for colleagues who should be able to review.

### 3. Edge Function (password issuing)
Using the Supabase CLI (`brew install supabase/tap/supabase`):
```bash
supabase login
supabase link --project-ref <your-project-ref>
supabase functions deploy admin-candidates
```
Alternatively, in the Dashboard go to **Edge Functions → Deploy a new function → Via editor**, name it `admin-candidates`, and paste in `supabase/functions/admin-candidates/index.ts`.
The function rejects any caller who is not in `admins`.

### 4. GitHub Pages
1. Push this repo to GitHub.
2. **Settings → Secrets and variables → Actions** → add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. Both are in Supabase under **Project Settings → API**. The anon key is designed to be public, because RLS protects the data.
3. **Settings → Pages → Source: GitHub Actions**.
4. Push to `main`. The workflow in `.github/workflows/deploy.yml` runs the tests, builds the site and deploys it. The URL is `https://<user>.github.io/<repo>/`.
5. Optionally, set **Authentication → URL Configuration → Site URL** in Supabase to that URL.

### Local development
```bash
cp .env.example .env.local   # fill in URL + anon key
npm run dev                  # http://localhost:5173
npm test                     # marking unit tests (+ answer-key checks when private/ exists)
```

---

## Day-to-day use

1. Sign in at the portal URL with your admin account. You'll land on **Candidates**.
2. **+ Add candidate** → enter the email, name and access expiry (defaults to 3 days). A password is generated and shown **once**, along with a ready-to-paste **invitation email**.
3. To give a candidate access again, or to rotate the password, click **New password**. The old password stops working. If access had expired, it's extended by 3 days.
   **Disable** blocks a candidate immediately. Click the expiry date to change it.
4. When a candidate submits, click **Mark & export**:
   - Auto-scores come from the keyword rubric. Each check shows ✓ or ✗.
   - To override a score, type a final score. Leave it blank to keep the auto score. Add comments for colleagues.
   - Click **Export to Word**. You can choose to include the keyword checks and the model answers. The report includes diagrams as images and code in a monospace font.
5. **Summary CSV / Summary Word** ranks all candidates by total score, with a subtotal per section.
6. **Reopen** unlocks a submitted assessment, for example if a candidate submitted by mistake.

### How the active-time timer works
- While the tab is visible and the candidate has used the keyboard or mouse in the last **5 minutes**, the browser sends a heartbeat every 30 s.
- The **server** adds the time since the previous heartbeat, but only if the gap is ≤ 90 s. When the candidate hides the tab, goes idle or clicks *Save & exit*, `pause_timer()` banks the time and stops the clock.
- Closing the laptop or losing the network therefore never counts as active time, and candidates cannot change the timer themselves.

### Marking scheme (100)
A1 10 · A2 8 · A3 7 · B1–B4 6 each · C1 10 · C2 7 · C3 7 · C4 7 · D1 10 · D2 10.
To change weights, rubric items or wording, edit `private/assessment_content.mjs`. Then run `npm run seed:generate` and re-run both seed files in the SQL editor. Re-running is safe: rows are upserted. The questions seed aborts, changing nothing, if candidates already have answers or reviewer marks for a question id that the new content drops or renames, because deleting that question would cascade-delete them. Export those reports first. Then open any review page and click **Recalculate auto-scores**.

The keyword auto-score is a **suggestion**. It checks for the key techniques (e.g. `ROW_NUMBER … PARTITION BY user_id`, `broadcast`, `stack(`). It cannot judge whether a candidate's reasoning is correct, so always review before you share the report.

---

## Project layout
```
src/
  pages/LoginPage.tsx
  pages/candidate/   WelcomePage, AssessmentPage (editors, autosave, timer, review & submit), SubmittedPage
  pages/admin/       CandidatesPage (accounts, passwords, expiry, summary export), ReviewPage (marking, Word export)
  components/        RichTextEditor (Tiptap), CodeEditor (CodeMirror), DiagramEditor (Excalidraw), ui
  lib/               supabase, auth, useActiveTimer, useAutosave, marking, exportDocx, markdown, format
supabase/
  migrations/001_init.sql            tables, RLS, heartbeat/pause/submit RPCs, storage policies
  migrations/002_answer_limits.sql   size caps and inline-PNG check on answers
  functions/admin-candidates/        create / reset_password / delete candidate accounts
scripts/generate-seed.mjs            private content -> seed SQL (+ validation)
scripts/package-sample-data.sh       CSVs -> zip for Storage
```

## Free-tier notes
- If a Supabase free project has no activity for **7 days**, it pauses. Open the dashboard and click *Restore* before sending invitations, or sign in to the admin page every few days during a hiring round.
- Free-tier limits (500 MB database, 50k monthly active users) are far above what this needs. Diagram snapshots are around 50–300 KB per candidate.
