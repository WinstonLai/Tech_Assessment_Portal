import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DATA_BUCKET, DATA_OBJECT, errorMessage, supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { formatDateTime, formatDuration } from '../../lib/format';
import type { AssessmentInfo, Question } from '../../lib/types';
import { Alert, Button, Markdown, Spinner } from '../../components/ui';
import CandidateHeader from '../../components/CandidateHeader';

export default function WelcomePage() {
  const { candidate, signOut } = useAuth();
  const navigate = useNavigate();
  const [info, setInfo] = useState<AssessmentInfo | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    (async () => {
      const [i, q] = await Promise.all([
        supabase.from('assessment_info').select('title,intro_md').eq('id', 1).maybeSingle(),
        supabase.from('questions').select('*').order('sort_order'),
      ]);
      if (i.error || q.error) setError(await errorMessage(i.error ?? q.error));
      setInfo(i.data as AssessmentInfo | null);
      setQuestions((q.data ?? []) as Question[]);
    })();
  }, []);

  const download = async () => {
    setDownloading(true);
    const { data, error } = await supabase.storage.from(DATA_BUCKET).createSignedUrl(DATA_OBJECT, 600, { download: true });
    setDownloading(false);
    if (error || !data) {
      setError(`Could not prepare the download: ${await errorMessage(error)}`);
      return;
    }
    window.location.assign(data.signedUrl);
  };

  if (!candidate) return null;
  const started = candidate.status !== 'not_started';
  const sections = [...new Map(questions.map((q) => [q.section, q.section_title])).entries()];

  return (
    <div className="min-h-screen">
      <CandidateHeader right={<Button variant="ghost" onClick={() => signOut()}>Sign out</Button>} />
      <main className="mx-auto grid max-w-6xl gap-6 px-4 py-8 lg:grid-cols-[1fr_320px]">
        <section className="rounded-xl border border-slate-200 bg-surface p-6 shadow-sm">
          {error && <div className="mb-4"><Alert>{error}</Alert></div>}
          {!info ? <Spinner /> : (
            <>
              <h1 className="mb-4 text-2xl font-bold">{info.title}</h1>
              <Markdown md={info.intro_md} />
            </>
          )}
        </section>

        <aside className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-surface p-5 shadow-sm">
            <p className="text-sm text-slate-500">Signed in as</p>
            <p className="font-semibold">{candidate.full_name || candidate.email}</p>
            <p className="text-sm text-slate-600">{candidate.email}</p>
            <dl className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between"><dt className="text-slate-500">Access until</dt><dd className="font-medium">{formatDateTime(candidate.access_expires_at)}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Active time so far</dt><dd className="font-mono font-medium">{formatDuration(candidate.active_seconds)}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Questions</dt><dd className="font-medium">{questions.length} · {questions.reduce((n, q) => n + Number(q.max_score), 0)} marks</dd></div>
            </dl>
            <Button className="mt-5 w-full" onClick={() => navigate('/assessment')} disabled={!questions.length}>
              {started ? 'Resume assessment →' : 'Start assessment →'}
            </Button>
            <p className="mt-2 text-xs text-slate-500">The timer only runs while you are active on the assessment pages.</p>
          </div>

          <div className="rounded-xl border border-slate-200 bg-surface p-5 shadow-sm">
            <h2 className="font-semibold">Sample data</h2>
            <p className="mt-1 text-sm text-slate-600">
              Five CSV files: users, daily_activity, sleep_logs, nutrition_logs, mental_health.
            </p>
            <Button variant="secondary" className="mt-3 w-full" onClick={download} disabled={downloading}>
              {downloading ? 'Preparing…' : '⬇ Download sample data (.zip)'}
            </Button>
          </div>

          {sections.length > 0 && (
            <div className="rounded-xl border border-slate-200 bg-surface p-5 shadow-sm">
              <h2 className="mb-2 font-semibold">Sections</h2>
              <ul className="space-y-1.5 text-sm">
                {sections.map(([s, title]) => {
                  const qs = questions.filter((q) => q.section === s);
                  const marks = qs.reduce((n, q) => n + Number(q.max_score), 0);
                  return (
                    <li key={s} className="flex justify-between gap-2">
                      <span>{title.replace(/^Section \w+: /, `${s}. `)}</span>
                      <span className="shrink-0 text-slate-500">{marks} marks</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </aside>
      </main>
    </div>
  );
}
