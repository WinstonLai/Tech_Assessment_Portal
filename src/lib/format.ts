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

const SGT = 'Asia/Singapore';

/** Newer ICU builds put a narrow no-break space before AM/PM; emails want a plain space. */
const plainSpaces = (s: string) => s.replace(/[\u00a0\u202f]/g, ' ');

/** Like formatDateTime but always in Singapore time and labelled, e.g. "Oct 08, 2026, 05:32 PM SGT". */
export function formatDateTimeSgt(iso: string): string {
  if (Number.isNaN(Date.parse(iso))) return '—';
  const text = new Date(iso).toLocaleString('en-US', {
    timeZone: SGT, year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
  return `${plainSpaces(text)} SGT`;
}

function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`;
}

/** Singapore-time deadline for emails, e.g. "Thursday, 8th October 2026, 05:32 PM". */
export function formatDeadlineSgt(iso: string): string {
  if (Number.isNaN(Date.parse(iso))) return '—';
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: SGT, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: true,
    }).formatToParts(new Date(iso)).map((p) => [p.type, p.value]),
  );
  return `${parts.weekday}, ${ordinal(Number(parts.day))} ${parts.month} ${parts.year}, ${parts.hour}:${parts.minute} ${parts.dayPeriod}`;
}

/** Whole days from now until `expiresAtIso`, to the nearest day, never below 1. */
export function accessDays(expiresAtIso: string, now = Date.now()): number {
  return Math.max(1, Math.round((new Date(expiresAtIso).getTime() - now) / 86400_000));
}

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

/** 1 -> "one day", 3 -> "three days", 14 -> "14 days". */
export function daysPhrase(n: number): string {
  return `${n <= 10 ? NUMBER_WORDS[n] : n} ${n === 1 ? 'day' : 'days'}`;
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
