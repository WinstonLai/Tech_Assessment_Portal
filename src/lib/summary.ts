import { csvCell } from './csv';
import { elapsedSeconds, formatDuration } from './format';
import { sectionTotals } from './marking';
import type { Candidate, CandidateStatus, Mark, Question } from './types';

export interface SummaryRow {
  candidate: Candidate;
  marks: Record<string, Mark | undefined>;
}

export interface RankedRow extends SummaryRow {
  /** Has at least one marks row. No marks means "not marked", never 0. */
  marked: boolean;
  totals: ReturnType<typeof sectionTotals>;
  /** Competition rank (ties share a rank: 1, 1, 3). Null for anyone who is not ranked. */
  rank: number | null;
  /** Server-stamped wall-clock seconds from start to submission; null until the candidate has submitted. */
  elapsed: number | null;
}

const STATUS_ORDER: Record<CandidateStatus, number> = { submitted: 0, in_progress: 1, not_started: 2 };

/**
 * Orders the summary the same way in the Word report and the CSV. Only candidates who have submitted and have
 * marks are ranked: an in-progress candidate's score reflects partial answers, so it must not compete with
 * finished ones. Everyone else follows, with their status shown instead of a rank.
 */
export function rankSummary(rows: SummaryRow[], questions: Question[]): RankedRow[] {
  const entries = rows.map((r) => {
    const marked = Object.keys(r.marks).length > 0;
    const submitted = r.candidate.status === 'submitted';
    return {
      ...r,
      marked,
      totals: sectionTotals(questions, r.marks),
      rank: null as number | null,
      elapsed: submitted ? elapsedSeconds(r.candidate.started_at, r.candidate.submitted_at) : null,
    };
  });
  const isRanked = (e: RankedRow) => e.marked && e.candidate.status === 'submitted';
  const ranked = entries.filter(isRanked)
    .sort((a, b) => b.totals.total - a.totals.total || a.candidate.email.localeCompare(b.candidate.email));
  const rest = entries.filter((e) => !isRanked(e))
    .sort((a, b) => STATUS_ORDER[a.candidate.status] - STATUS_ORDER[b.candidate.status] || a.candidate.email.localeCompare(b.candidate.email));
  ranked.forEach((e, i) => {
    e.rank = i > 0 && e.totals.total === ranked[i - 1].totals.total ? ranked[i - 1].rank : i + 1;
  });
  return [...ranked, ...rest];
}

/** Excel reads a CSV as the local ANSI code page unless the file starts with a UTF-8 byte order mark. */
const BOM = '﻿';

/** The all-candidates CSV, ranked like the Word summary. Every data cell goes through `csvCell`. */
export function buildSummaryCsv(rows: SummaryRow[], questions: Question[]): string {
  const sections = [...new Set(questions.map((q) => q.section))];
  const lines = [
    ['rank', 'name', 'email', 'status', 'active_time', 'active_seconds', 'elapsed', 'elapsed_seconds', 'started_at', 'submitted_at',
      ...sections.map((s) => `section_${s}`), 'total'].join(','),
    ...rankSummary(rows, questions).map(({ candidate: c, marked, totals: t, rank, elapsed }) =>
      // No marks rows = not scored yet: leave the score cells blank rather than exporting a misleading 0.
      [rank ?? '', c.full_name, c.email, c.status, formatDuration(c.active_seconds), c.active_seconds,
        elapsed == null ? '' : formatDuration(elapsed), elapsed ?? '', c.started_at, c.submitted_at,
        ...sections.map((s) => (marked ? t.sections.get(s)?.score ?? 0 : '')), marked ? t.total : ''].map(csvCell).join(',')),
  ];
  return BOM + lines.join('\n');
}
