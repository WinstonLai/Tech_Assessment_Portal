import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { saveAs } from 'file-saver';
import { errorMessage, supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { formatDateTime, formatDateTimeSgt, formatDuration, isExpired, toLocalInput } from '../../lib/format';
import { computeAutoMarks, sectionTotals } from '../../lib/marking';
import { csvCell } from '../../lib/csv';
import { buildInvitationEmail } from '../../lib/invitationEmail';
import { fetchAllRows } from '../../lib/paginate';
import { buildSummaryReport } from '../../lib/exportDocx';
import type { AnswerKey, Candidate, Mark, Question } from '../../lib/types';
import { Alert, Button, Modal, Spinner, StatusBadge, inputClass } from '../../components/ui';
import AdminHeader from './AdminHeader';

const DEFAULT_ACCESS_DAYS = 3;
const defaultExpiry = () => toLocalInput(new Date(Date.now() + DEFAULT_ACCESS_DAYS * 86400_000));
const portalUrl = () => window.location.href.split('#')[0];

interface Credentials { candidate: Candidate; password: string; isNew: boolean }

async function invoke(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('admin-candidates', { body });
  if (error) throw new Error(await errorMessage(error));
  if (data?.error) throw new Error(data.error);
  return data;
}

export default function CandidatesPage() {
  const { session } = useAuth();
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [marks, setMarks] = useState<Mark[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [creds, setCreds] = useState<Credentials | null>(null);
  const [editExpiry, setEditExpiry] = useState<Candidate | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Candidate | null>(null);
  const [confirmReset, setConfirmReset] = useState<Candidate | null>(null);
  const [confirmReopen, setConfirmReopen] = useState<Candidate | null>(null);
  const [extendOnReopen, setExtendOnReopen] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [scoring, setScoring] = useState<string | null>(null); // progress text while bulk auto-scoring
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    // Paged: PostgREST silently truncates at 1000 rows, which is ~76 candidates' marks, and a truncated
    // marks list would show wrong totals and a wrong ranking without any error.
    const [c, m, q] = await Promise.all([
      fetchAllRows((from, to) => supabase.from('candidates').select('*').order('created_at', { ascending: false }).order('id').range(from, to)),
      fetchAllRows((from, to) => supabase.from('marks').select('candidate_id,question_id,auto_score,final_score').order('candidate_id').order('question_id').range(from, to)),
      supabase.from('questions').select('*').order('sort_order'),
    ]);
    const err = c.error ?? m.error ?? q.error;
    if (err) setError(await errorMessage(err));
    setCandidates((c.data ?? []) as Candidate[]);
    setMarks((m.data ?? []) as Mark[]);
    setQuestions((q.data ?? []) as Question[]);
  }, []);

  useEffect(() => { void load(); }, [load]);

  // The table can be long; make sure a failed row action is not reported out of sight above the fold.
  useEffect(() => { if (error) window.scrollTo({ top: 0, behavior: 'smooth' }); }, [error]);

  const marksByCandidate = useMemo(() => {
    const map = new Map<string, Record<string, Mark>>();
    for (const m of marks) {
      const rec = map.get(m.candidate_id) ?? {};
      rec[m.question_id] = m;
      map.set(m.candidate_id, rec);
    }
    return map;
  }, [marks]);

  const scoreOf = (id: string) => {
    const rec = marksByCandidate.get(id);
    return rec ? sectionTotals(questions, rec).total : null;
  };

  const maxTotal = useMemo(() => questions.reduce((n, q) => n + Number(q.max_score), 0), [questions]);

  // Marks are only written when a review page is opened, so candidates nobody has opened show "not marked"
  // and are left out of the ranking. This scores every submitted candidate with the same code the review page uses.
  const autoScoreSubmitted = async () => {
    const targets = (candidates ?? []).filter((c) => c.status === 'submitted');
    if (!targets.length) { setNotice('No submitted candidates to score.'); return; }
    setError(null);
    setNotice(null);
    try {
      setScoring('Loading answer key…');
      const { data: keyRows, error: keyErr } = await supabase.from('answer_key').select('question_id,rubric');
      if (keyErr) throw keyErr;
      const keys = Object.fromEntries((keyRows as AnswerKey[]).map((k) => [k.question_id, k]));
      let updated = 0;
      const failed: string[] = [];
      for (const [i, c] of targets.entries()) {
        setScoring(`Scoring ${i + 1} of ${targets.length}…`);
        // One candidate at a time: diagram scenes can be large.
        const [a, m] = await Promise.all([
          supabase.from('answers').select('question_id,rich_text_json,code,diagram_scene').eq('candidate_id', c.id),
          supabase.from('marks').select('*').eq('candidate_id', c.id),
        ]);
        if (a.error || m.error) { failed.push(c.email); continue; }
        const answers = Object.fromEntries((a.data ?? []).map((x) => [x.question_id as string, x]));
        const stored = Object.fromEntries(((m.data ?? []) as Mark[]).map((x) => [x.question_id, x]));
        const { changed } = computeAutoMarks(c.id, questions, keys, answers, stored);
        if (!changed.length) continue;
        const { error: upErr } = await supabase.from('marks').upsert(changed, { onConflict: 'candidate_id,question_id' });
        if (upErr) failed.push(c.email); else updated++;
      }
      await load();
      setNotice(`Auto-scored ${targets.length - failed.length} submitted candidate${targets.length - failed.length === 1 ? '' : 's'} (${updated} updated).`);
      if (failed.length) setError(`Could not score: ${failed.join(', ')}`);
    } catch (e) {
      setError(await errorMessage(e));
    }
    setScoring(null);
  };

  const act = async (c: Candidate, fn: () => Promise<void>) => {
    setBusyId(c.id);
    setError(null);
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    setBusyId(null);
  };

  const resetPassword = (c: Candidate) => act(c, async () => {
    const extend = isExpired(c.access_expires_at) ? new Date(Date.now() + DEFAULT_ACCESS_DAYS * 86400_000).toISOString() : undefined;
    const data = await invoke({ action: 'reset_password', candidate_id: c.id, access_expires_at: extend });
    setCreds({ candidate: data.candidate, password: data.password, isNew: false });
    await load();
  });

  const toggleActive = (c: Candidate) => act(c, async () => {
    const { error } = await supabase.from('candidates').update({ is_active: !c.is_active }).eq('id', c.id);
    if (error) throw error;
    await load();
  });

  const reopen = (c: Candidate, extend: boolean) => act(c, async () => {
    const patch: Record<string, unknown> = { status: 'in_progress', submitted_at: null };
    if (extend) patch.access_expires_at = new Date(Date.now() + DEFAULT_ACCESS_DAYS * 86400_000).toISOString();
    const { error } = await supabase.from('candidates').update(patch).eq('id', c.id);
    if (error) throw error;
    await load();
  });

  const exportSummary = async (kind: 'docx' | 'csv') => {
    if (!candidates) return;
    const rows = candidates.map((c) => ({ candidate: c, marks: marksByCandidate.get(c.id) ?? {} }));
    const stamp = new Date().toISOString().slice(0, 10);
    if (kind === 'docx') {
      saveAs(await buildSummaryReport(rows, questions, session?.user.email ?? 'admin'), `WellnessTrack_Candidate_Summary_${stamp}.docx`);
      return;
    }
    const sections = [...new Set(questions.map((q) => q.section))];
    const lines = [
      ['name', 'email', 'status', 'active_time', 'active_seconds', 'started_at', 'submitted_at', ...sections.map((s) => `section_${s}`), 'total'].join(','),
      ...rows.map(({ candidate: c, marks: m }) => {
        // No marks rows = not scored yet: leave the score cells blank rather than exporting a misleading 0.
        const t = Object.keys(m).length ? sectionTotals(questions, m) : null;
        return [c.full_name, c.email, c.status, formatDuration(c.active_seconds), c.active_seconds, c.started_at, c.submitted_at,
          ...sections.map((s) => (t ? t.sections.get(s)?.score ?? 0 : '')), t ? t.total : ''].map(csvCell).join(',');
      }),
    ];
    saveAs(new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' }), `WellnessTrack_Candidate_Summary_${stamp}.csv`);
  };

  const visible = (candidates ?? []).filter((c) =>
    !filter || `${c.full_name ?? ''} ${c.email}`.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div className="min-h-screen">
      <AdminHeader />
      <main className="mx-auto max-w-[1400px] space-y-5 px-4 py-6">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-bold">Candidates</h1>
          <input className={`${inputClass} max-w-xs`} placeholder="Search name or email…" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Search candidates" />
          <div className="ml-auto flex flex-wrap gap-2">
            <Button variant="secondary" onClick={autoScoreSubmitted} disabled={!candidates?.length || scoring !== null}>
              {scoring ?? 'Auto-score submitted'}
            </Button>
            <Button variant="secondary" onClick={() => exportSummary('csv')} disabled={!candidates?.length}>⬇ Summary CSV</Button>
            <Button variant="secondary" onClick={() => exportSummary('docx')} disabled={!candidates?.length}>⬇ Summary Word</Button>
            <Button onClick={() => setShowAdd(true)}>+ Add candidate</Button>
          </div>
        </div>

        {error && <Alert>{error}</Alert>}
        {notice && <Alert kind="info">{notice}</Alert>}

        {!candidates ? <Spinner /> : (
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-surface shadow-sm">
            <table className="w-full min-w-[1100px] text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Candidate</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Active time</th>
                  <th className="px-4 py-3">Submitted</th>
                  <th className="px-4 py-3">Access until</th>
                  <th className="px-4 py-3">Score</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {visible.length === 0 && (
                  <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-500">
                    {error && candidates.length === 0
                      ? <>Could not load candidates. <button className="underline" onClick={() => void load()}>Try again</button></>
                      : filter ? 'No candidates match your search.' : 'No candidates yet. Click “Add candidate” to issue access.'}
                  </td></tr>
                )}
                {visible.map((c) => {
                  const expired = isExpired(c.access_expires_at);
                  const score = scoreOf(c.id);
                  const busy = busyId === c.id;
                  return (
                    <tr key={c.id} className="border-t border-slate-100 align-top">
                      <td className="px-4 py-3">
                        <div className="font-medium">{c.full_name || '—'}</div>
                        <div className="text-slate-500">{c.email}</div>
                      </td>
                      <td className="space-x-1 px-4 py-3">
                        <StatusBadge status={c.status} />
                        {!c.is_active && <StatusBadge status="inactive" />}
                        {expired && c.status !== 'submitted' && <StatusBadge status="expired" />}
                      </td>
                      <td className="px-4 py-3 font-mono">{formatDuration(c.active_seconds)}</td>
                      <td className="px-4 py-3">{formatDateTime(c.submitted_at)}</td>
                      <td className={`px-4 py-3 ${expired ? 'text-rose-600 dark:text-rose-400' : ''}`}>
                        <button className="underline decoration-dotted hover:text-indigo-700 dark:hover:text-indigo-300" onClick={() => setEditExpiry(c)}>
                          {formatDateTime(c.access_expires_at)}
                        </button>
                      </td>
                      <td className="px-4 py-3 font-semibold">{score == null ? <span className="font-normal text-slate-500">not marked</span> : `${score} / ${maxTotal}`}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap justify-end gap-1">
                          <Link to={`/admin/candidates/${c.id}`} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700">
                            {c.status === 'submitted' ? 'Mark & export' : 'View'}
                          </Link>
                          <Button variant="secondary" className="!px-2.5 !py-1.5 !text-xs" disabled={busy} onClick={() => setConfirmReset(c)}>New password</Button>
                          <Button variant="secondary" className="!px-2.5 !py-1.5 !text-xs" disabled={busy} onClick={() => toggleActive(c)}>
                            {c.is_active ? 'Disable' : 'Enable'}
                          </Button>
                          {c.status === 'submitted' && (
                            <Button variant="secondary" className="!px-2.5 !py-1.5 !text-xs" disabled={busy} onClick={() => { setExtendOnReopen(true); setConfirmReopen(c); }}>Reopen</Button>
                          )}
                          <Button variant="ghost" className="!px-2.5 !py-1.5 !text-xs text-rose-700 dark:text-rose-300" disabled={busy} onClick={() => setConfirmDelete(c)}>Delete</Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-slate-500">
          “New password” issues a fresh password (the old one stops working for new sign-ins) and, if access had expired, extends it by {DEFAULT_ACCESS_DAYS} days.
          It does not re-enable a disabled candidate and does not sign out a candidate who is already signed in.
          “Disable” blocks access immediately, even for a candidate who is already signed in; “Enable” restores it.
        </p>
      </main>

      <AddCandidateModal
        open={showAdd}
        onClose={() => setShowAdd(false)}
        onCreated={async (cr) => { setShowAdd(false); setCreds(cr); await load(); }}
      />
      <CredentialsModal creds={creds} onClose={() => setCreds(null)} />
      <ExpiryModal candidate={editExpiry} onClose={() => setEditExpiry(null)} onSaved={async () => { setEditExpiry(null); await load(); }} />
      <Modal
        open={!!confirmReset}
        title="Issue a new password?"
        onClose={() => setConfirmReset(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmReset(null)}>Cancel</Button>
            <Button onClick={() => { const c = confirmReset!; setConfirmReset(null); void resetPassword(c); }}>Issue new password</Button>
          </>
        }
      >
        <p className="text-sm text-slate-600">
          The current password for <strong>{confirmReset?.email}</strong> stops working for new sign-ins straight away, so they
          cannot sign back in until you send them the new one. A candidate who is already signed in is not affected.
        </p>
      </Modal>
      <Modal
        open={!!confirmReopen}
        title="Reopen this submission?"
        onClose={() => setConfirmReopen(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmReopen(null)}>Cancel</Button>
            <Button onClick={() => { const c = confirmReopen!; setConfirmReopen(null); void reopen(c, extendOnReopen && isExpired(c.access_expires_at)); }}>Reopen</Button>
          </>
        }
      >
        <div className="space-y-3 text-sm text-slate-600">
          <p>
            <strong>{confirmReopen?.email}</strong> will be able to edit their answers and submit again. Their submitted time is cleared;
            marks and comments you already entered are kept.
          </p>
          {confirmReopen && isExpired(confirmReopen.access_expires_at) && (
            <label className="flex items-start gap-2">
              <input type="checkbox" className="mt-0.5" checked={extendOnReopen} onChange={(e) => setExtendOnReopen(e.target.checked)} />
              <span>Their access has expired, so they could not sign in. Also extend access by {DEFAULT_ACCESS_DAYS} days from now.</span>
            </label>
          )}
          {confirmReopen && !confirmReopen.is_active && (
            <p className="text-amber-800 dark:text-amber-300">This candidate is currently disabled. Click “Enable” as well, or they still cannot sign in.</p>
          )}
        </div>
      </Modal>
      <Modal
        open={!!confirmDelete}
        title="Delete candidate?"
        onClose={() => setConfirmDelete(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmDelete(null)}>Cancel</Button>
            <Button variant="danger" onClick={() => {
              const c = confirmDelete!;
              setConfirmDelete(null);
              void act(c, async () => { await invoke({ action: 'delete', candidate_id: c.id }); await load(); });
            }}>Delete permanently</Button>
          </>
        }
      >
        <p className="text-sm text-slate-600">
          This permanently deletes <strong>{confirmDelete?.email}</strong>, their answers and marks. Export their report first if you need it.
        </p>
      </Modal>
    </div>
  );
}

function AddCandidateModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (c: Credentials) => void }) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [expiry, setExpiry] = useState(defaultExpiry);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) { setEmail(''); setName(''); setExpiry(defaultExpiry()); setError(null); }
  }, [open]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const data = await invoke({ action: 'create', email, full_name: name, access_expires_at: new Date(expiry).toISOString() });
      onCreated({ candidate: data.candidate, password: data.password, isNew: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setBusy(false);
  };

  return (
    <Modal open={open} title="Add candidate" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className="mb-1 block text-sm font-medium" htmlFor="c-email">Email</label>
          <input id="c-email" type="email" required className={inputClass} value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium" htmlFor="c-name">Full name</label>
          <input id="c-name" className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium" htmlFor="c-exp">Access expires</label>
          <input id="c-exp" type="datetime-local" required className={inputClass} value={expiry} onChange={(e) => setExpiry(e.target.value)} />
        </div>
        {error && <Alert>{error}</Alert>}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create & generate password'}</Button>
        </div>
      </form>
    </Modal>
  );
}

function CredentialsModal({ creds, onClose }: { creds: Credentials | null; onClose: () => void }) {
  const [copied, setCopied] = useState<string | null>(null);
  // Built once per issued password: the text depends on the clock, so re-rendering must not change what gets copied.
  const email = useMemo(() => {
    if (!creds) return null;
    const { candidate: c, password, isNew } = creds;
    return {
      ...buildInvitationEmail({
        fullName: c.full_name, email: c.email, password, expiresAtIso: c.access_expires_at, portalUrl: portalUrl(), isNew,
      }),
      expired: isExpired(c.access_expires_at),
    };
  }, [creds]);
  if (!creds || !email) return null;
  const { candidate: c, password } = creds;
  const { subject, body, expired } = email;

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
    } catch {
      setCopied('failed'); // clipboard blocked (permissions / insecure context): the text is selectable on screen
    }
    window.setTimeout(() => setCopied(null), 2500);
  };

  return (
    <Modal open title={creds.isNew ? 'Candidate created' : 'New password issued'} onClose={onClose} wide dismissible={false}
      footer={<Button onClick={onClose}>Done</Button>}>
      <div className="space-y-4">
        <Alert kind="warning">This password is shown only once. Copy it now — you can always issue a new one later.</Alert>
        {!c.is_active && (
          <Alert kind="warning">This candidate is currently <strong>disabled</strong> and cannot sign in. Click “Enable” on the candidates page before sending these details.</Alert>
        )}
        {expired && (
          <Alert kind="warning">This candidate’s access has <strong>already expired</strong>, so the dates in the email below are in the past. Set a new expiry on the candidates page, then issue a new password before sending.</Alert>
        )}
        {copied === 'failed' && <Alert>Could not access the clipboard. Select the text on screen and copy it manually.</Alert>}
        <div className="grid grid-cols-[110px_1fr_auto] items-center gap-2 text-sm">
          <span className="text-slate-500">Email</span><span className="font-mono">{c.email}</span>
          <Button variant="ghost" className="!py-1 !text-xs" onClick={() => copy(c.email, 'email')}>{copied === 'email' ? 'Copied' : 'Copy'}</Button>
          <span className="text-slate-500">Password</span><span className="font-mono text-base font-semibold">{password}</span>
          <Button variant="ghost" className="!py-1 !text-xs" onClick={() => copy(password, 'pw')}>{copied === 'pw' ? 'Copied' : 'Copy'}</Button>
          <span className="text-slate-500">Expires</span><span>{formatDateTimeSgt(c.access_expires_at)}</span><span />
        </div>
        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-sm font-medium">Invitation email: subject</span>
            <Button variant="secondary" className="!py-1 !text-xs" onClick={() => copy(subject, 'subject')}>{copied === 'subject' ? 'Copied ✓' : 'Copy subject'}</Button>
          </div>
          <input readOnly className={`${inputClass} font-mono text-xs`} value={subject} aria-label="Invitation email subject" />
        </div>
        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-sm font-medium">Invitation email: body</span>
            <Button variant="secondary" className="!py-1 !text-xs" onClick={() => copy(body, 'body')}>{copied === 'body' ? 'Copied ✓' : 'Copy body'}</Button>
          </div>
          <textarea readOnly className={`${inputClass} h-80 font-mono text-xs`} value={body} aria-label="Invitation email body" />
        </div>
      </div>
    </Modal>
  );
}

function ExpiryModal({ candidate, onClose, onSaved }: { candidate: Candidate | null; onClose: () => void; onSaved: () => void }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (candidate) { setValue(toLocalInput(candidate.access_expires_at)); setError(null); } }, [candidate]);
  if (!candidate) return null;
  const save = async () => {
    const when = new Date(value);
    if (!value || Number.isNaN(when.getTime())) { setError('Enter a valid date and time.'); return; }
    const { error } = await supabase.from('candidates').update({ access_expires_at: when.toISOString() }).eq('id', candidate.id);
    if (error) setError(await errorMessage(error));
    else onSaved();
  };
  return (
    <Modal open title={`Access expiry — ${candidate.email}`} onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save}>Save</Button></>}>
      <label className="mb-1 block text-sm font-medium" htmlFor="exp">Access expires</label>
      <input id="exp" type="datetime-local" className={inputClass} value={value} onChange={(e) => setValue(e.target.value)} />
      <div className="mt-2 flex gap-2">
        {[1, 3, 7].map((d) => (
          <Button key={d} variant="ghost" className="!py-1 !text-xs" onClick={() => setValue(toLocalInput(new Date(Date.now() + d * 86400_000)))}>
            +{d} day{d > 1 ? 's' : ''} from now
          </Button>
        ))}
      </div>
      {error && <div className="mt-3"><Alert>{error}</Alert></div>}
    </Modal>
  );
}
