import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { computeAutoMarks, extractDiagramText, isAnswered, MAX_SCAN_CHARS, richTextToPlain, scoreAnswer, sectionTotals } from './marking';
import type { Answer, Mark, Question, RubricItem } from './types';

const rubric: RubricItem[] = [
  { id: 'x-1', label: 'window', points: 2, match: 'any', source: 'code', patterns: ['row_number', String.raw`\brank\s*\(`] },
  { id: 'x-2', label: 'partition+order', points: 3, match: 'all', source: 'code', patterns: ['partition by user_id', 'desc'] },
  { id: 'x-3', label: 'explains', points: 1, match: 'any', source: 'text', patterns: ['latest'] },
];

/** A Tiptap document with one paragraph per line, as the rich-text editor stores it. */
const doc = (text: string) => ({
  type: 'doc',
  content: text.split('\n').map((line) => ({ type: 'paragraph', ...(line ? { content: [{ type: 'text', text: line }] } : {}) })),
});

const ans = (p: Partial<Answer> & { text?: string }) => {
  const { text, ...rest } = p;
  return { rich_text_json: text === undefined ? null : doc(text), code: null, diagram_scene: null, ...rest } as Answer;
};

describe('scoreAnswer', () => {
  it('scores zero for an empty / missing answer', () => {
    expect(scoreAnswer(undefined, rubric, 6).score).toBe(0);
    expect(scoreAnswer(ans({ code: '   ' }), rubric, 6).score).toBe(0);
  });

  it('awards any/all items case-insensitively', () => {
    const r = scoreAnswer(ans({ code: 'SELECT ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY ts DESC)', text: 'keep the LATEST' }), rubric, 6);
    expect(r.score).toBe(6);
    expect(r.hits.every((h) => h.matched)).toBe(true);
  });

  it("requires every pattern for 'all' items", () => {
    const r = scoreAnswer(ans({ code: 'row_number() over (partition by user_id)' }), rubric, 6);
    expect(r.hits.find((h) => h.id === 'x-2')!.matched).toBe(false);
    expect(r.score).toBe(2);
  });

  it('falls back to notes text when code box is empty', () => {
    expect(scoreAnswer(ans({ text: 'rank( ) ...' }), rubric, 6).score).toBe(2);
  });

  it('reads text labels from diagrams and ignores deleted elements', () => {
    const scene = { elements: [
      { type: 'text', text: 'users\nPK user_id', isDeleted: false },
      { type: 'text', text: 'ghost', isDeleted: true },
      { type: 'rectangle' },
    ] };
    expect(extractDiagramText(scene)).toBe('users\nPK user_id');
  });

  it('caps at max score and ignores invalid regexes', () => {
    const bad: RubricItem[] = [{ id: 'b', label: 'b', points: 10, match: 'any', source: 'any', patterns: ['(', 'ok'] }];
    expect(scoreAnswer(ans({ code: 'ok' }), bad, 4).score).toBe(4);
  });
});

describe('untrusted answer content', () => {
  it('ignores the client-written rich_text_plain: scoring uses the stored document', () => {
    // Hidden keywords in rich_text_plain must not score; the reviewer only ever sees the document.
    const stuffed = { ...ans({ text: 'I am not sure.' }), rich_text_plain: 'latest row_number partition by user_id desc' } as Answer;
    expect(scoreAnswer(stuffed, rubric, 6).score).toBe(0);
  });

  it('extracts text from nested lists, tables and hard breaks with line separation', () => {
    const json = { type: 'doc', content: [
      { type: 'bulletList', content: [
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }] }] },
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'two' }, { type: 'hardBreak' }, { type: 'text', text: 'three' }] }] },
      ] },
      { type: 'table', content: [{ type: 'tableRow', content: [
        { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a' }] }] },
        { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'b' }] }] },
      ] }] },
    ] };
    expect(richTextToPlain(json).split('\n').filter(Boolean)).toEqual(['one', 'two', 'three', 'a', 'b']);
  });

  it('survives malformed and absurdly deep documents without throwing', () => {
    expect(richTextToPlain(null)).toBe('');
    expect(richTextToPlain('x')).toBe('');
    // Bare strings in `content` are not text nodes, so they cannot smuggle in text the editor would never show.
    expect(richTextToPlain({ type: 'doc', content: ['hidden', { type: 'paragraph', content: ['hidden'] }] })).toBe('\n');
    expect(richTextToPlain({ type: 'doc', content: 'nope' })).toBe('');
    let deep: Record<string, unknown> = { type: 'text', text: 'bottom' };
    for (let i = 0; i < 200_000; i++) deep = { type: 'blockquote', content: [deep] }; // would overflow a recursive walk
    expect(() => richTextToPlain(deep)).not.toThrow();
  });

  it('stops reading a document at the scan limit', () => {
    const long = doc('x'.repeat(MAX_SCAN_CHARS * 5));
    expect(richTextToPlain(long).length).toBe(MAX_SCAN_CHARS);
  });

  it('ignores invisible (opacity 0) diagram labels and non-array element lists', () => {
    const scene = { elements: [
      { type: 'text', text: 'visible', opacity: 100 },
      { type: 'text', text: 'hidden keywords', opacity: 0 },
    ] };
    expect(extractDiagramText(scene)).toBe('visible');
    expect(extractDiagramText({ elements: 'nope' } as never)).toBe('');
  });

  it('scores adversarial input quickly (quadratic patterns cannot freeze the reviewer)', () => {
    const slow: RubricItem[] = [{ id: 's', label: 's', points: 1, match: 'any', source: 'any', patterns: ['pk.*neverpresent'] }];
    const evil = ans({ text: 'pk '.repeat(150_000), code: 'pk '.repeat(100_000) });
    const t0 = Date.now();
    expect(scoreAnswer(evil, slow, 1).score).toBe(0);
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  it('isAnswered reads the document, not rich_text_plain', () => {
    expect(isAnswered(ans({ text: 'hello' }))).toBe(true);
    expect(isAnswered(ans({ text: '   ' }))).toBe(false);
    expect(isAnswered({ ...ans({}), rich_text_plain: 'hidden' } as Answer)).toBe(false);
  });
});

describe('computeAutoMarks', () => {
  const qs = [{ id: 'A1', max_score: 6 }, { id: 'A2', max_score: 4 }, { id: 'A3', max_score: 2 }];
  const keys = { A1: { rubric }, A2: { rubric } }; // A3 has no answer key
  const answers = { A1: ans({ code: 'row_number() over (partition by user_id order by ts desc)', text: 'latest' }) };

  it('creates marks for every keyed question, including unanswered ones, and skips keyless ones', () => {
    const { changed, marks } = computeAutoMarks('c1', qs, keys, answers, {});
    expect(changed.map((r) => [r.question_id, r.auto_score])).toEqual([['A1', 6], ['A2', 0]]);
    expect(Object.keys(marks)).toEqual(['A1', 'A2']);
    expect(marks.A1).toMatchObject({ candidate_id: 'c1', final_score: null, reviewer_comment: null });
  });

  it('returns nothing when scores and hits are unchanged, and keeps reviewer overrides', () => {
    const first = computeAutoMarks('c1', qs, keys, answers, {});
    const reviewed = { ...first.marks, A1: { ...first.marks.A1, final_score: 3, reviewer_comment: 'ok' } };
    const again = computeAutoMarks('c1', qs, keys, answers, reviewed);
    expect(again.changed).toEqual([]);
    expect(again.marks.A1).toMatchObject({ final_score: 3, reviewer_comment: 'ok' });
  });

  it('re-scores when the answer changes but leaves the override in place', () => {
    const first = computeAutoMarks('c1', qs, keys, answers, {});
    const reviewed = { ...first.marks, A1: { ...first.marks.A1, final_score: 3 } };
    const { changed, marks } = computeAutoMarks('c1', qs, keys, { A1: ans({ code: 'select 1' }) }, reviewed);
    expect(changed.map((r) => r.question_id)).toContain('A1');
    expect(marks.A1.auto_score).toBe(0);
    expect(marks.A1.final_score).toBe(3);
  });
});

describe('sectionTotals', () => {
  it('uses reviewer override over auto score', () => {
    const qs = [
      { id: 'A1', section: 'A', section_title: 'A', max_score: 10 },
      { id: 'B1', section: 'B', section_title: 'B', max_score: 6 },
    ] as Question[];
    const marks = { A1: { auto_score: 4, final_score: 7 }, B1: { auto_score: 5, final_score: null } } as unknown as Record<string, Mark>;
    const t = sectionTotals(qs, marks);
    expect(t.total).toBe(12);
    expect(t.max).toBe(16);
  });
});

// Uses the confidential answer key when present locally (private/ is gitignored).
const KEY = 'private/answer_key.generated.json';
describe.skipIf(!existsSync(KEY))('real answer key', () => {
  const key = existsSync(KEY) ? JSON.parse(readFileSync(KEY, 'utf8')) : [];
  for (const q of key as { id: string; max_score: number; answer_type: string; model_answer_md: string; rubric: RubricItem[] }[]) {
    it(`${q.id}: model answer scores >= 85%`, () => {
      const a = q.answer_type === 'code'
        ? ans({ code: q.model_answer_md, text: '' })
        : ans({ text: q.model_answer_md });
      const r = scoreAnswer(a, q.rubric, q.max_score);
      const missed = r.hits.filter((h) => !h.matched).map((h) => h.label);
      expect(r.score / q.max_score, `missed: ${missed.join('; ')}`).toBeGreaterThanOrEqual(0.85);
    });
    it(`${q.id}: an off-topic answer scores <= 20%`, () => {
      const r = scoreAnswer(ans({ code: 'print("hello world")', text: 'I am not sure.' }), q.rubric, q.max_score);
      expect(r.score / q.max_score).toBeLessThanOrEqual(0.2);
    });
  }
});
