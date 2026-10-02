import { useAuth } from '../../lib/auth';
import { formatDateTime, formatDuration } from '../../lib/format';
import { Button } from '../../components/ui';
import CandidateHeader from '../../components/CandidateHeader';

export default function SubmittedPage() {
  const { candidate, signOut } = useAuth();
  return (
    <div className="min-h-screen">
      <CandidateHeader right={<Button variant="ghost" onClick={() => signOut()}>Sign out</Button>} />
      <main className="mx-auto max-w-xl px-4 py-16">
        <div className="rounded-xl border border-emerald-200 bg-white p-8 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-3xl">✓</div>
          <h1 className="text-xl font-bold">Assessment submitted</h1>
          <p className="mt-2 text-slate-600">
            Thank you{candidate?.full_name ? `, ${candidate.full_name}` : ''}. Your answers have been submitted and locked.
            The team will review them and be in touch.
          </p>
          {candidate && (
            <dl className="mx-auto mt-6 max-w-xs space-y-1 text-sm">
              <div className="flex justify-between"><dt className="text-slate-500">Submitted</dt><dd>{formatDateTime(candidate.submitted_at)}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Active time</dt><dd className="font-mono">{formatDuration(candidate.active_seconds)}</dd></div>
            </dl>
          )}
          <Button variant="secondary" className="mt-6" onClick={() => signOut()}>Sign out</Button>
        </div>
      </main>
    </div>
  );
}
