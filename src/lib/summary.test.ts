import { describe, expect, it } from 'vitest';
import { buildSummaryCsv, rankSummary, type SummaryRow } from './summary';
import type { Candidate, Mark, Question } from './types';

const QUESTIONS = [
  { id: 'A1', section: 'A', section_title: 'Section A: One', sort_order: 1, title: 'a', prompt_md: '', answer_type: 'rich_text', max_score: 10 },
  { id: 'B1', section: 'B', section_title: 'Section B: Two', sort_order: 2, title: 'b', prompt_md: '', answer_type: 'rich_text', max_score: 10 },
] as Question[];

const mark = (question_id: string, auto_score: number, final_score: number | null = null): Mark => ({
  candidate_id: 'x', question_id, auto_score, rubric_hits: null, final_score, reviewer_comment: null, reviewed_by: null, reviewed_at: null,
});

const row = (email: string, over: Partial<Candidate>, marks: Mark[]): SummaryRow => ({
  candidate: {
    id: email, email, full_name: email.split('@')[0], access_expires_at: '2026-10-10T00:00:00Z', is_active: true, status: 'submitted',
    started_at: '2026-10-03T08:00:00Z', submitted_at: '2026-10-03T09:30:00Z', active_seconds: 3725,
    last_heartbeat_at: null, password_issued_at: null, created_at: '2026-10-01T00:00:00Z', ...over,
  } as Candidate,
  marks: Object.fromEntries(marks.map((m) => [m.question_id, m])),
});

describe('rankSummary', () => {
  it('ranks submitted, marked candidates by total, best first', () => {
    const out = rankSummary([
      row('low@x.com', {}, [mark('A1', 2)]),
      row('high@x.com', {}, [mark('A1', 9), mark('B1', 8)]),
    ], QUESTIONS);
    expect(out.map((r) => [r.candidate.email, r.rank])).toEqual([['high@x.com', 1], ['low@x.com', 2]]);
  });

  it('gives tied totals the same rank and skips the next one (1, 1, 3)', () => {
    const out = rankSummary([
      row('c@x.com', {}, [mark('A1', 4)]),
      row('a@x.com', {}, [mark('A1', 8)]),
      row('b@x.com', {}, [mark('A1', 8)]),
    ], QUESTIONS);
    expect(out.map((r) => [r.candidate.email, r.rank])).toEqual([['a@x.com', 1], ['b@x.com', 1], ['c@x.com', 3]]);
  });

  it('uses the reviewer override, not the auto score, for the total', () => {
    const out = rankSummary([
      row('auto@x.com', {}, [mark('A1', 9)]),
      row('adjusted@x.com', {}, [mark('A1', 1, 10)]),
    ], QUESTIONS);
    expect(out[0].candidate.email).toBe('adjusted@x.com');
  });

  it('does not rank in-progress candidates, even with a higher score', () => {
    const out = rankSummary([
      row('partial@x.com', { status: 'in_progress', submitted_at: null }, [mark('A1', 10), mark('B1', 10)]),
      row('done@x.com', {}, [mark('A1', 1)]),
    ], QUESTIONS);
    expect(out.map((r) => [r.candidate.email, r.rank])).toEqual([['done@x.com', 1], ['partial@x.com', null]]);
  });

  it('lists unmarked candidates after the ranked ones, submitted before in-progress before not-started', () => {
    const out = rankSummary([
      row('new@x.com', { status: 'not_started', started_at: null, submitted_at: null }, []),
      row('busy@x.com', { status: 'in_progress', submitted_at: null }, []),
      row('unscored@x.com', {}, []),
      row('scored@x.com', {}, [mark('A1', 3)]),
    ], QUESTIONS);
    expect(out.map((r) => r.candidate.email)).toEqual(['scored@x.com', 'unscored@x.com', 'busy@x.com', 'new@x.com']);
    expect(out.slice(1).every((r) => r.rank === null && !r.marked)).toBe(true);
  });

  it('reports elapsed time only for submitted candidates', () => {
    const [submitted, busy] = rankSummary([
      row('done@x.com', {}, [mark('A1', 1)]),
      row('busy@x.com', { status: 'in_progress', submitted_at: null }, []),
    ], QUESTIONS);
    expect(submitted.elapsed).toBe(5400);
    expect(busy.elapsed).toBeNull();
  });
});

describe('buildSummaryCsv', () => {
  const rows = [
    row('bob@x.com', { full_name: 'Bob' }, [mark('A1', 5)]),
    row('alice@x.com', { full_name: 'Alice' }, [mark('A1', 9), mark('B1', 8)]),
    row('carl@x.com', { full_name: 'Carl' }, []),
  ];

  it('starts with a UTF-8 byte order mark so Excel reads non-ASCII names correctly', () => {
    expect(buildSummaryCsv(rows, QUESTIONS).charCodeAt(0)).toBe(0xfeff);
  });

  it('has a header row with rank and elapsed columns and one column per section', () => {
    const header = buildSummaryCsv(rows, QUESTIONS).slice(1).split('\n')[0];
    expect(header).toBe('rank,name,email,status,active_time,active_seconds,elapsed,elapsed_seconds,started_at,submitted_at,section_A,section_B,total');
  });

  it('lists candidates in rank order with the rank, elapsed time and totals', () => {
    const lines = buildSummaryCsv(rows, QUESTIONS).slice(1).split('\n');
    expect(lines[1]).toBe('"1","Alice","alice@x.com","submitted","01:02:05","3725","01:30:00","5400","2026-10-03T08:00:00Z","2026-10-03T09:30:00Z","9","8","17"');
    expect(lines[2].startsWith('"2","Bob"')).toBe(true);
  });

  it('leaves score and rank cells blank for an unmarked candidate instead of writing 0', () => {
    const carl = buildSummaryCsv(rows, QUESTIONS).slice(1).split('\n')[3];
    expect(carl).toBe('"","Carl","carl@x.com","submitted","01:02:05","3725","01:30:00","5400","2026-10-03T08:00:00Z","2026-10-03T09:30:00Z","","",""');
  });

  it('still escapes spreadsheet formulas in names', () => {
    const csv = buildSummaryCsv([row('evil@x.com', { full_name: '=HYPERLINK("http://evil")' }, [])], QUESTIONS);
    expect(csv).toContain(`"'=HYPERLINK(""http://evil"")"`);
  });
});
