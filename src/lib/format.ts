export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

/** ISO string -> value for <input type="datetime-local"> in local time. */
export function toLocalInput(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Wall-clock seconds from the server-stamped first activity to submission (or `now` while in progress).
 * Unlike active_seconds, which the browser reports, the candidate cannot shorten this. Null if never started.
 */
export function elapsedSeconds(startedAt: string | null, submittedAt: string | null, now = Date.now()): number | null {
  if (!startedAt) return null;
  const end = submittedAt ? new Date(submittedAt).getTime() : now;
  return Math.max(0, Math.floor((end - new Date(startedAt).getTime()) / 1000));
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function isExpired(iso: string): boolean {
  return Date.now() >= new Date(iso).getTime();
}
