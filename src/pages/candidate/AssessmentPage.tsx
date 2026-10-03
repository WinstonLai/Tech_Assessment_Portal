import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { errorMessage, supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { useActiveTimer } from '../../lib/useActiveTimer';
import { useAutosave, type SaveStatus } from '../../lib/useAutosave';
import { flushDiagramSaves } from '../../lib/diagramFlush';
import { safeStorage } from '../../lib/safeStorage';
import { shouldApplyRecovered } from '../../lib/recovery';
import { formatDateTime, formatDuration } from '../../lib/format';
import { isAnswered } from '../../lib/marking';
import type { Answer, AnswerPatch, Candidate, Question } from '../../lib/types';
import { Alert, Button, Markdown, Modal, Spinner } from '../../components/ui';
import CandidateHeader from '../../components/CandidateHeader';
import RichTextEditor from '../../components/RichTextEditor';
import CodeEditor from '../../components/CodeEditor';

const DiagramEditor = lazy(() => import('../../components/DiagramEditor'));

type Draft = Partial<Answer>;
const LAST_Q_KEY = 'wt-last-question';
const REVIEW = 'review';

export default function AssessmentPage() {
  const { candidate, setCandidate, refreshCandidate, signOut } = useAuth();
  const c = candidate as Candidate;
  const { qid } = useParams();
  const navigate = useNavigate();

  const [questions, setQuestions] = useState<Question[] | null>(null);
  const [answers, setAnswers] = useState<Record<string, Draft>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [exiting, setExiting] = useState(false);
  const [recoveredNotice, setRecoveredNotice] = useState<string | null>(null);

  const autosave = useAutosave(c.id);
  const timer = useActiveTimer({
    enabled: true,
    initialSeconds: c.active_seconds,
    onCandidate: setCandidate,
    onExpired: () => void refreshCandidate(),
  });

  // ---- load questions + saved answers (+ any unsynced local edits)
  useEffect(() => {
    (async () => {
      const [qRes, aRes] = await Promise.all([
        supabase.from('questions').select('*').order('sort_order'),
        supabase.from('answers').select('*').eq('candidate_id', c.id),
      ]);
      if (qRes.error || aRes.error) {
        setLoadError(await errorMessage(qRes.error ?? aRes.error));
        return;
      }
      const map: Record<string, Draft> = {};
      for (const a of (aRes.data ?? []) as Answer[]) map[a.question_id] = a;
      // Re-apply unsynced edits from an earlier session, unless the server holds a newer copy of that answer
      // (saved afterwards, e.g. from another device): then the stale local edit must not overwrite it.
      const recovered = autosave.takeRecovered();
      const skipped: string[] = [];
      for (const [q, { patch, at }] of Object.entries(recovered)) {
        if (shouldApplyRecovered(map[q]?.updated_at, at)) map[q] = { ...map[q], ...patch };
        else skipped.push(q);
      }
      if (skipped.length) {
        autosave.discardRecovered(skipped);
        setRecoveredNotice(`Unsaved edits from an earlier session were not restored for ${skipped.join(', ')}, because a newer version of ${skipped.length > 1 ? 'those answers was' : 'that answer was'} already saved.`);
      }
      setAnswers(map);
      setQuestions((qRes.data ?? []) as Question[]);
      if (Object.keys(recovered).length > skipped.length) void autosave.flush();
    })();
  }, [c.id]);

  const current = useMemo(() => {
    if (!questions?.length) return null;
    if (qid === REVIEW) return REVIEW;
    const fromRoute = questions.find((q) => q.id === qid);
    if (fromRoute) return fromRoute;
    const last = safeStorage.get(LAST_Q_KEY);
    return questions.find((q) => q.id === last) ?? questions[0];
  }, [qid, questions]);

  useEffect(() => {
    if (current && current !== REVIEW) safeStorage.set(LAST_Q_KEY, current.id);
  }, [current]);

  const update = useCallback((questionId: string, patch: AnswerPatch) => {
    setAnswers((prev) => ({ ...prev, [questionId]: { ...prev[questionId], ...patch } }));
    autosave.queue(questionId, patch);
  }, [autosave]);

  // The diagram editor debounces and exports a PNG before it reaches autosave; wait for that first.
  const flushAll = useCallback(async () => {
    await flushDiagramSaves();
    return autosave.flush();
  }, [autosave]);

  const saveAndExit = async () => {
    setExiting(true);
    await flushAll();
    await timer.pause();
    await signOut();
  };

  if (loadError) return <div className="mx-auto max-w-xl p-8"><Alert>{loadError}</Alert></div>;
  if (!questions || !current) return <Spinner label="Loading assessment…" />;

  const answeredCount = questions.filter((q) => isAnswered(answers[q.id] as Answer)).length;
  const idx = current === REVIEW ? questions.length : questions.findIndex((q) => q.id === current.id);
  const go = (i: number) => navigate(`/assessment/${i >= questions.length ? REVIEW : questions[Math.max(0, i)].id}`);

  return (
    <div className="flex min-h-screen flex-col">
      <CandidateHeader
        right={
          <>
            <SaveIndicator status={autosave.status} error={autosave.lastError} />
            <div
              className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 ${timer.running ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-slate-50'}`}
              title="Active time — pauses when you are idle for 5 minutes, switch tabs, or exit"
            >
              <span className={`h-2 w-2 rounded-full ${timer.running ? 'animate-pulse bg-emerald-500' : 'bg-slate-400'}`} />
              <span className="text-xs text-slate-500">{timer.running ? 'Active' : 'Paused'}</span>
              <span className="font-mono text-sm font-semibold tabular-nums">{formatDuration(timer.seconds)}</span>
            </div>
            <Button variant="secondary" onClick={saveAndExit} disabled={exiting}>
              {exiting ? 'Saving…' : 'Save & exit'}
            </Button>
          </>
        }
      />

      <div className="mx-auto flex w-full max-w-[1600px] flex-1">
        {/* Sidebar */}
        <nav aria-label="Questions" className="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-64 shrink-0 overflow-y-auto border-r border-slate-200 bg-white p-4 md:block">
          <div className="mb-3">
            <div className="flex justify-between text-xs text-slate-500">
              <span>Progress</span><span>{answeredCount}/{questions.length} answered</span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full bg-indigo-500 transition-all" style={{ width: `${(answeredCount / questions.length) * 100}%` }} />
            </div>
          </div>
          {[...new Set(questions.map((q) => q.section))].map((s) => (
            <div key={s} className="mb-4">
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                {questions.find((q) => q.section === s)!.section_title.replace(/^Section \w+: /, `${s}. `)}
              </div>
              <ul>
                {questions.filter((q) => q.section === s).map((q) => {
                  const active = current !== REVIEW && current.id === q.id;
                  const done = isAnswered(answers[q.id] as Answer);
                  return (
                    <li key={q.id}>
                      <Link
                        to={`/assessment/${q.id}`}
                        aria-current={active ? 'page' : undefined}
                        className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm ${active ? 'bg-indigo-50 font-semibold text-indigo-700' : 'text-slate-700 hover:bg-slate-50'}`}
                      >
                        <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] ${done ? 'bg-emerald-500 text-white' : 'border border-slate-300'}`}>
                          {done ? '✓' : ''}
                        </span>
                        <span className="w-6 shrink-0 font-mono text-xs">{q.id}</span>
                        <span className="truncate">{q.title}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
          <Link
            to={`/assessment/${REVIEW}`}
            className={`mt-2 block rounded-lg border px-3 py-2 text-center text-sm font-semibold ${current === REVIEW ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-indigo-200 text-indigo-700 hover:bg-indigo-50'}`}
          >
            Review & submit
          </Link>
          <p className="mt-4 text-xs text-slate-500">Access until {formatDateTime(c.access_expires_at)}</p>
        </nav>

        {/* Main */}
        <main className="min-w-0 flex-1 p-4 md:p-8">
          {recoveredNotice && (
            <div className="mx-auto mb-4 max-w-5xl"><Alert kind="info">{recoveredNotice}</Alert></div>
          )}

          <ExpiryBanner expiresAt={c.access_expires_at} onExpired={() => void refreshCandidate()} />

          {autosave.blocked.length > 0 && (
            <div className="mx-auto mb-4 max-w-5xl">
              <Alert>
                <strong>Not saved:</strong>{' '}
                {autosave.blocked.map((b) => `${b.questionId} — ${b.message}`).join(' · ')}
                {' '}Your work on {autosave.blocked.length > 1 ? 'these questions' : 'this question'} is not stored yet and you cannot submit until it is.
              </Alert>
            </div>
          )}

          {/* Mobile question picker */}
          <select
            className="mb-4 w-full rounded-lg border border-slate-300 p-2 text-sm md:hidden"
            value={current === REVIEW ? REVIEW : current.id}
            onChange={(e) => navigate(`/assessment/${e.target.value}`)}
            aria-label="Go to question"
          >
            {questions.map((q) => <option key={q.id} value={q.id}>{q.id} · {q.title}</option>)}
            <option value={REVIEW}>Review & submit</option>
          </select>

          {current === REVIEW ? (
            <ReviewSubmit
              questions={questions}
              answers={answers}
              flush={flushAll}
              onSubmitted={(cand) => setCandidate(cand)}
            />
          ) : (
            <QuestionView key={current.id} q={current} answer={answers[current.id] ?? {}} update={update} />
          )}

          <div className="mx-auto mt-8 flex max-w-5xl justify-between">
            <Button variant="secondary" onClick={() => go(idx - 1)} disabled={idx <= 0}>← Previous</Button>
            {idx < questions.length && (
              <Button onClick={() => go(idx + 1)}>{idx === questions.length - 1 ? 'Review & submit →' : 'Next →'}</Button>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

const EXPIRY_WARNING_MS = 15 * 60 * 1000;

/**
 * Writes are rejected once access_expires_at passes, and unsubmitted work is then locked out, so warn in the
 * last minutes. At zero it refreshes the candidate row so the route guard shows the expired screen even when
 * the timer is paused (no heartbeat would otherwise notice).
 */
function ExpiryBanner({ expiresAt, onExpired }: { expiresAt: string; onExpired: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  const remaining = new Date(expiresAt).getTime() - now;
  const expired = remaining <= 0;

  useEffect(() => {
    if (expired) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [expired]);

  useEffect(() => {
    if (expired) onExpired();
  }, [expired]); // fires once when the deadline passes

  if (expired || remaining > EXPIRY_WARNING_MS) return null;
  return (
    <div className="mx-auto mb-4 max-w-5xl">
      <Alert kind="warning">
        <strong>Access ends in {formatDuration(Math.ceil(remaining / 1000))}.</strong> Submit from “Review &amp; submit” before then —
        answers cannot be saved or submitted after your access expires.
      </Alert>
    </div>
  );
}

function SaveIndicator({ status, error }: { status: SaveStatus; error: string | null }) {
  const text: Record<SaveStatus, string> = {
    idle: 'All changes saved', saved: 'All changes saved', unsaved: 'Unsaved changes…', saving: 'Saving…', error: 'Save failed — retrying',
  };
  const color = status === 'error' ? 'text-rose-600' : status === 'saved' || status === 'idle' ? 'text-emerald-700' : 'text-slate-500';
  return <span className={`hidden text-xs sm:inline ${color}`} title={error ?? undefined} aria-live="polite">{text[status]}</span>;
}

function QuestionView({ q, answer, update }: { q: Question; answer: Draft; update: (id: string, patch: AnswerPatch) => void }) {
  return (
    <article className="mx-auto max-w-5xl space-y-5">
      <header>
        <p className="text-sm font-medium text-indigo-700">{q.section_title}</p>
        <div className="mt-1 flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-2xl font-bold">
            <span className="text-slate-400">{q.id}.</span> {q.title}
          </h1>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-medium text-slate-700">{q.max_score} marks</span>
        </div>
      </header>

      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <Markdown md={q.prompt_md} />
      </div>

      {q.answer_type === 'diagram_plus_text' && (
        <>
          <section aria-label="Diagram">
            <h2 className="mb-2 text-sm font-semibold text-slate-700">Diagram</h2>
            <Suspense fallback={<div className="flex h-[560px] items-center justify-center rounded-lg border border-slate-300 bg-white"><Spinner label="Loading drawing canvas…" /></div>}>
              <DiagramEditor
                initialScene={answer.diagram_scene ?? null}
                onChange={(scene, png) => update(q.id, { diagram_scene: scene, diagram_png: png })}
              />
            </Suspense>
          </section>
          <section aria-label="Explanation">
            <h2 className="mb-2 text-sm font-semibold text-slate-700">Explanation</h2>
            <RichTextEditor
              initialContent={answer.rich_text_json ?? null}
              placeholder="Describe keys, relationships, and your reasoning…"
              onChange={(v) => update(q.id, { rich_text_json: v.json, rich_text_html: v.html, rich_text_plain: v.plain })}
            />
          </section>
        </>
      )}

      {q.answer_type === 'code' && (
        <>
          <section aria-label="Code answer">
            <h2 className="mb-2 text-sm font-semibold text-slate-700">Your code</h2>
            <CodeEditor
              value={answer.code ?? ''}
              language={answer.code_language ?? 'sql'}
              onChange={(code) => update(q.id, { code })}
              onLanguageChange={(code_language) => update(q.id, { code_language })}
            />
          </section>
          <section aria-label="Notes">
            <h2 className="mb-2 text-sm font-semibold text-slate-700">Notes / assumptions <span className="font-normal text-slate-500">(optional)</span></h2>
            <RichTextEditor
              initialContent={answer.rich_text_json ?? null}
              minHeight={100}
              placeholder="Any assumptions or explanation of your approach…"
              onChange={(v) => update(q.id, { rich_text_json: v.json, rich_text_html: v.html, rich_text_plain: v.plain })}
            />
          </section>
        </>
      )}

      {q.answer_type === 'rich_text' && (
        <section aria-label="Answer">
          <h2 className="mb-2 text-sm font-semibold text-slate-700">Your answer</h2>
          <RichTextEditor
            initialContent={answer.rich_text_json ?? null}
            minHeight={340}
            onChange={(v) => update(q.id, { rich_text_json: v.json, rich_text_html: v.html, rich_text_plain: v.plain })}
          />
        </section>
      )}
    </article>
  );
}

function ReviewSubmit({ questions, answers, flush, onSubmitted }: {
  questions: Question[];
  answers: Record<string, Draft>;
  flush: () => Promise<boolean>;
  onSubmitted: (c: Candidate) => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const unanswered = questions.filter((q) => !isAnswered(answers[q.id] as Answer));

  const submit = async () => {
    setBusy(true);
    setError(null);
    const saved = await flush();
    if (!saved) {
      setBusy(false);
      setError('Some answers could not be saved. Check the red notice at the top of the page and your connection, then try again.');
      return;
    }
    const { data, error } = await supabase.rpc('submit_assessment');
    setBusy(false);
    if (error) {
      setError(await errorMessage(error));
      return;
    }
    onSubmitted((Array.isArray(data) ? data[0] : data) as Candidate);
  };

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <h1 className="text-2xl font-bold">Review & submit</h1>
      {unanswered.length > 0 ? (
        <Alert kind="warning">
          You have {unanswered.length} unanswered question{unanswered.length > 1 ? 's' : ''}: {unanswered.map((q) => q.id).join(', ')}.
          You can still submit, but unanswered questions score zero.
        </Alert>
      ) : (
        <Alert kind="success">All questions have an answer. 🎉</Alert>
      )}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-600">
            <tr><th className="px-4 py-2">Question</th><th className="px-4 py-2">Marks</th><th className="px-4 py-2">Status</th><th /></tr>
          </thead>
          <tbody>
            {questions.map((q) => {
              const done = isAnswered(answers[q.id] as Answer);
              return (
                <tr key={q.id} className="border-t border-slate-100">
                  <td className="px-4 py-2"><span className="font-mono text-xs text-slate-500">{q.id}</span> {q.title}</td>
                  <td className="px-4 py-2">{q.max_score}</td>
                  <td className="px-4 py-2">{done ? <span className="text-emerald-700">✓ Answered</span> : <span className="text-amber-700">Not answered</span>}</td>
                  <td className="px-4 py-2 text-right"><Link className="text-indigo-700 hover:underline" to={`/assessment/${q.id}`}>Open</Link></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {error && <Alert>{error}</Alert>}
      <div className="flex justify-end">
        <Button onClick={() => setConfirm(true)}>Submit assessment</Button>
      </div>

      <Modal
        open={confirm}
        title="Submit your assessment?"
        onClose={() => !busy && setConfirm(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirm(false)} disabled={busy}>Cancel</Button>
            <Button onClick={submit} disabled={busy}>{busy ? 'Submitting…' : 'Yes, submit'}</Button>
          </>
        }
      >
        <p className="text-sm text-slate-600">
          After submitting you will <strong>not</strong> be able to change your answers. Your active time will stop.
        </p>
      </Modal>
    </div>
  );
}
