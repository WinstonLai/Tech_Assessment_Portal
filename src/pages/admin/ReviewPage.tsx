import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { saveAs } from 'file-saver';
import { errorMessage, supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { elapsedSeconds, formatDateTime, formatDuration } from '../../lib/format';
import { computeAutoMarks, effectiveScore, sectionTotals } from '../../lib/marking';
import { safePngDataUrl, sanitizeHtml } from '../../lib/markdown';
import { buildCandidateReport } from '../../lib/exportDocx';
import type { Answer, AnswerKey, Candidate, Mark, Question } from '../../lib/types';
import { Alert, Button, Markdown, Spinner, StatusBadge, inputClass } from '../../components/ui';
import CodeEditor from '../../components/CodeEditor';
import AdminHeader from './AdminHeader';

const DiagramEditor = lazy(() => import('../../components/DiagramEditor'));

export default function ReviewPage() {
  const { candidateId } = useParams();
  const { session } = useAuth();
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [keys, setKeys] = useState<Record<string, AnswerKey>>({});
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [marks, setMarks] = useState<Record<string, Mark>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [includeModel, setIncludeModel] = useState(false);
  const [includeRubric, setIncludeRubric] = useState(true);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    if (!candidateId) return;
    setLoading(true);
    setError(null);
    const [c, q, k, a, m] = await Promise.all([
      supabase.from('candidates').select('*').eq('id', candidateId).single(),
      supabase.from('questions').select('*').order('sort_order'),
      supabase.from('answer_key').select('*'),
      supabase.from('answers').select('*').eq('candidate_id', candidateId),
      supabase.from('marks').select('*').eq('candidate_id', candidateId),
    ]);
    const err = c.error ?? q.error ?? k.error ?? a.error ?? m.error;
    if (err) { setError(await errorMessage(err)); setLoading(false); return; }

    const qs = q.data as Question[];
    const keyMap = Object.fromEntries((k.data as AnswerKey[]).map((x) => [x.question_id, x]));
    const ansMap = Object.fromEntries((a.data as Answer[]).map((x) => [x.question_id, x]));
    const storedMarks: Record<string, Mark> = Object.fromEntries((m.data as Mark[]).map((x) => [x.question_id, x]));

    // (Re)compute keyword auto-scores; keep reviewer overrides and comments untouched.
    const { changed, marks: markMap } = computeAutoMarks(candidateId, qs, keyMap, ansMap, storedMarks);
    if (changed.length) {
      const { error: upErr } = await supabase.from('marks').upsert(changed, { onConflict: 'candidate_id,question_id' });
      if (upErr) setError(`Could not store auto-scores: ${await errorMessage(upErr)}`);
    }

    setCandidate(c.data as Candidate);
    setQuestions(qs);
    setKeys(keyMap);
    setAnswers(ansMap);
    setMarks(markMap);
    setLoading(false);
  }, [candidateId]);

  useEffect(() => { void load(); }, [load]);

  const totals = useMemo(() => sectionTotals(questions, marks), [questions, marks]);

  const saveMark = async (questionId: string, patch: Partial<Pick<Mark, 'final_score' | 'reviewer_comment'>>) => {
    const row = {
      candidate_id: candidateId!, question_id: questionId, ...patch,
      reviewed_by: session?.user.id ?? null, reviewed_at: new Date().toISOString(),
    };
    const { error } = await supabase.from('marks').upsert(row, { onConflict: 'candidate_id,question_id' });
    if (error) { setError(await errorMessage(error)); return false; }
    setMarks((prev) => ({ ...prev, [questionId]: { ...prev[questionId], ...row } }));
    return true;
  };

  const exportWord = async () => {
    if (!candidate) return;
    setExporting(true);
    try {
      const blob = await buildCandidateReport({
        candidate, questions, answers, marks, keys,
        includeModelAnswers: includeModel, includeRubric,
        reviewer: session?.user.email ?? 'admin',
      });
      const safe = (candidate.full_name || candidate.email).replace(/[^\w.-]+/g, '_');
      saveAs(blob, `WellnessTrack_Assessment_${safe}.docx`);
    } catch (e) {
      setError(`Export failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    setExporting(false);
  };

  return (
    <div className="min-h-screen">
      <AdminHeader />
      <main className="mx-auto max-w-[1400px] space-y-6 px-4 py-6">
        <Link to="/admin" className="text-sm text-indigo-700 dark:text-indigo-300 hover:underline">← All candidates</Link>
        {error && <Alert>{error}</Alert>}
        {loading ? <Spinner /> : !candidate ? (
          <Button variant="secondary" onClick={load}>Try again</Button>
        ) : (
          <>
            {/* Summary */}
            <section className="grid gap-4 lg:grid-cols-[1fr_auto]">
              <div className="rounded-xl border border-slate-200 bg-surface p-5 shadow-sm">
                <div className="flex flex-wrap items-center gap-3">
                  <h1 className="text-xl font-bold">{candidate.full_name || candidate.email}</h1>
                  <StatusBadge status={candidate.status} />
                </div>
                <p className="text-sm text-slate-600">{candidate.email}</p>
                <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-5">
                  <div><dt className="text-slate-500">Active time</dt><dd className="font-mono font-semibold">{formatDuration(candidate.active_seconds)}</dd></div>
                  <div>
                    <dt className="text-slate-500" title="First answer saved to submission. Set by the server, so it cannot be shortened by the candidate; includes breaks.">Elapsed</dt>
                    <dd className="font-mono font-semibold">{(() => { const e = elapsedSeconds(candidate.started_at, candidate.submitted_at); return e == null ? '—' : formatDuration(e); })()}</dd>
                  </div>
                  <div><dt className="text-slate-500">Started</dt><dd>{formatDateTime(candidate.started_at)}</dd></div>
                  <div><dt className="text-slate-500">Submitted</dt><dd>{formatDateTime(candidate.submitted_at)}</dd></div>
                  <div><dt className="text-slate-500">Access until</dt><dd>{formatDateTime(candidate.access_expires_at)}</dd></div>
                </dl>
                {candidate.status !== 'submitted' && (
                  <div className="mt-4"><Alert kind="info">This candidate has not submitted yet — answers and scores may still change.</Alert></div>
                )}
              </div>
              <div className="min-w-[300px] rounded-xl border border-slate-200 bg-surface p-5 shadow-sm">
                <div className="text-sm text-slate-500">Total score</div>
                <div className="text-4xl font-bold">{totals.total}<span className="text-lg font-medium text-slate-400"> / {totals.max}</span></div>
                <ul className="mt-3 space-y-1 text-sm">
                  {[...totals.sections.entries()].map(([s, v]) => (
                    <li key={s} className="flex justify-between gap-4">
                      <span className="text-slate-600">{v.title.replace(/^Section \w+: /, `${s}. `)}</span>
                      <span className="font-medium">{Math.round(v.score * 10) / 10} / {v.max}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-4 space-y-1.5 border-t border-slate-100 pt-3 text-sm">
                  <label className="flex items-center gap-2"><input type="checkbox" checked={includeRubric} onChange={(e) => setIncludeRubric(e.target.checked)} /> Include keyword checks</label>
                  <label className="flex items-center gap-2"><input type="checkbox" checked={includeModel} onChange={(e) => setIncludeModel(e.target.checked)} /> Include model answers</label>
                  <Button className="mt-2 w-full" onClick={exportWord} disabled={exporting}>{exporting ? 'Building…' : '⬇ Export to Word'}</Button>
                  <Button variant="ghost" className="w-full" onClick={load}>↻ Recalculate auto-scores</Button>
                </div>
              </div>
            </section>

            {/* Per-question */}
            {questions.map((q) => (
              <QuestionReview
                key={q.id}
                q={q}
                answer={answers[q.id]}
                keyEntry={keys[q.id]}
                mark={marks[q.id]}
                onSave={(patch) => saveMark(q.id, patch)}
              />
            ))}
          </>
        )}
      </main>
    </div>
  );
}

function QuestionReview({ q, answer, keyEntry, mark, onSave }: {
  q: Question;
  answer: Answer | undefined;
  keyEntry: AnswerKey | undefined;
  mark: Mark | undefined;
  onSave: (patch: Partial<Pick<Mark, 'final_score' | 'reviewer_comment'>>) => Promise<boolean>;
}) {
  const [score, setScore] = useState(mark?.final_score != null ? String(mark.final_score) : '');
  const [comment, setComment] = useState(mark?.reviewer_comment ?? '');
  const [saved, setSaved] = useState<string | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);
  const [interactive, setInteractive] = useState(false);
  const max = Number(q.max_score);
  const auto = mark?.auto_score != null ? Number(mark.auto_score) : null;
  const overridden = mark?.final_score != null;

  const flash = (t: string) => { setSaved(t); window.setTimeout(() => setSaved(null), 1500); };

  const commitScore = async () => {
    const trimmed = score.trim();
    if (trimmed === '' && !overridden) return;
    const n = trimmed === '' ? null : Math.min(max, Math.max(0, Number(trimmed)));
    if (n !== null && Number.isNaN(n)) return;
    if (n === (mark?.final_score ?? null)) return;
    if (await onSave({ final_score: n })) { setScore(n == null ? '' : String(n)); flash('Score saved'); }
  };

  const commitComment = async () => {
    if ((mark?.reviewer_comment ?? '') === comment) return;
    if (await onSave({ reviewer_comment: comment || null })) flash('Comment saved');
  };

  // Regex over a multi-MB base64 string: compute once, not on every keystroke in the score/comment inputs.
  const pngSrc = useMemo(() => safePngDataUrl(answer?.diagram_png), [answer?.diagram_png]);
  const hasRich = Boolean(answer?.rich_text_plain?.trim());
  const empty = !answer || (!hasRich && !answer.code?.trim() && !answer.diagram_scene?.elements?.length);

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-surface shadow-sm" aria-labelledby={`q-${q.id}`}>
      <header className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-slate-50 px-5 py-3">
        <h2 id={`q-${q.id}`} className="font-semibold"><span className="font-mono text-slate-500">{q.id}</span> · {q.title}</h2>
        <button className="text-xs text-indigo-700 dark:text-indigo-300 hover:underline" onClick={() => setShowPrompt((s) => !s)}>{showPrompt ? 'Hide question' : 'Show question'}</button>
        <div className="ml-auto text-sm">
          <span className="text-slate-500">Score </span>
          <span className="text-lg font-bold">{Math.round(effectiveScore(mark) * 10) / 10}</span>
          <span className="text-slate-500"> / {max}</span>
          {overridden && <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800">adjusted</span>}
        </div>
      </header>
      {showPrompt && <div className="border-b border-slate-100 bg-slate-50/50 px-5 py-4"><Markdown md={q.prompt_md} className="prose-sm" /></div>}

      <div className="grid gap-0 lg:grid-cols-2">
        {/* Candidate answer */}
        <div className="min-w-0 space-y-3 p-5 lg:border-r lg:border-slate-100">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Candidate answer</h3>
          {empty && <p className="text-sm italic text-slate-400">No answer provided.</p>}
          {answer?.diagram_scene?.elements?.length ? (
            <div className="space-y-2">
              {interactive ? (
                <Suspense fallback={<Spinner />}>
                  <DiagramEditor initialScene={answer.diagram_scene} readOnly height={460} />
                </Suspense>
              ) : pngSrc ? (
                <img src={pngSrc} alt={`${q.id} diagram`} className="max-h-[460px] w-full rounded border border-slate-200 object-contain" />
              ) : null}
              <button className="text-xs text-indigo-700 dark:text-indigo-300 hover:underline" onClick={() => setInteractive((v) => !v)}>
                {interactive ? 'Show image' : 'Open interactive view (zoom / pan)'}
              </button>
            </div>
          ) : null}
          {answer?.code?.trim() ? <CodeEditor value={answer.code} language={answer.code_language} readOnly minHeight="120px" /> : null}
          {hasRich && (
            <div>
              {q.answer_type !== 'rich_text' && <div className="mb-1 text-xs font-medium text-slate-500">{q.answer_type === 'code' ? 'Notes' : 'Explanation'}</div>}
              <div className="answer-html prose prose-sm prose-slate max-w-none rounded-lg border border-slate-200 p-4"
                dangerouslySetInnerHTML={{ __html: sanitizeHtml(answer!.rich_text_html ?? '') }} />
            </div>
          )}
          {answer?.updated_at && <p className="text-xs text-slate-400">Last edited {formatDateTime(answer.updated_at)}</p>}
        </div>

        {/* Marking + model answer */}
        <div className="min-w-0 space-y-4 bg-slate-50/40 p-5">
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Keyword checks · auto score {auto ?? '—'} / {max}
            </h3>
            <ul className="space-y-1 text-sm">
              {(mark?.rubric_hits ?? []).map((h) => (
                <li key={h.id} className="flex items-start gap-2">
                  <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${h.matched ? 'bg-emerald-500 text-white' : 'bg-slate-200 text-slate-500'}`}>
                    {h.matched ? '✓' : '✗'}
                  </span>
                  <span className={h.matched ? '' : 'text-slate-500'}>{h.label}</span>
                  <span className="ml-auto shrink-0 text-xs text-slate-500">{h.points}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600" htmlFor={`s-${q.id}`}>Final score (blank = auto)</label>
              <div className="flex items-center gap-1">
                <input
                  id={`s-${q.id}`} type="number" min={0} max={max} step={0.5}
                  className={`${inputClass} w-24`} placeholder={auto != null ? String(auto) : ''}
                  value={score} onChange={(e) => setScore(e.target.value)} onBlur={commitScore}
                  onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                />
                <span className="text-sm text-slate-500">/ {max}</span>
              </div>
              {overridden && (
                <button className="mt-1 text-xs text-indigo-700 dark:text-indigo-300 hover:underline" onClick={async () => {
                  if (await onSave({ final_score: null })) { setScore(''); flash('Reset to auto'); }
                }}>Reset to auto</button>
              )}
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600" htmlFor={`c-${q.id}`}>Reviewer comment</label>
              <textarea id={`c-${q.id}`} rows={3} className={inputClass} value={comment}
                onChange={(e) => setComment(e.target.value)} onBlur={commitComment} placeholder="Strengths, gaps, notes for colleagues…" />
            </div>
          </div>
          {saved && <p className="text-xs text-emerald-700 dark:text-emerald-300" role="status">✓ {saved}</p>}

          {keyEntry && (
            <details className="rounded-lg border border-slate-200 bg-surface">
              <summary className="cursor-pointer px-4 py-2 text-sm font-medium text-slate-700">Model answer</summary>
              <div className="border-t border-slate-100 px-4 py-3"><Markdown md={keyEntry.model_answer_md} className="prose-sm" /></div>
            </details>
          )}
        </div>
      </div>
    </section>
  );
}
