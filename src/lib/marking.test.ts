import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { extractDiagramText, scoreAnswer, sectionTotals } from './marking';
import type { Answer, Mark, Question, RubricItem } from './types';

const rubric: RubricItem[] = [
  { id: 'x-1', label: 'window', points: 2, match: 'any', source: 'code', patterns: ['row_number', String.raw`\brank\s*\(`] },
  { id: 'x-2', label: 'partition+order', points: 3, match: 'all', source: 'code', patterns: ['partition by user_id', 'desc'] },
  { id: 'x-3', label: 'explains', points: 1, match: 'any', source: 'text', patterns: ['latest'] },
];

const ans = (p: Partial<Answer>) => ({ rich_text_plain: null, code: null, diagram_scene: null, ...p }) as Answer;

describe('scoreAnswer', () => {
  it('scores zero for an empty / missing answer', () => {
    expect(scoreAnswer(undefined, rubric, 6).score).toBe(0);
    expect(scoreAnswer(ans({ code: '   ' }), rubric, 6).score).toBe(0);
  });

  it('awards any/all items case-insensitively', () => {
    const r = scoreAnswer(ans({ code: 'SELECT ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY ts DESC)', rich_text_plain: 'keep the LATEST' }), rubric, 6);
    expect(r.score).toBe(6);
    expect(r.hits.every((h) => h.matched)).toBe(true);
  });

  it("requires every pattern for 'all' items", () => {
    const r = scoreAnswer(ans({ code: 'row_number() over (partition by user_id)' }), rubric, 6);
    expect(r.hits.find((h) => h.id === 'x-2')!.matched).toBe(false);
    expect(r.score).toBe(2);
  });

  it('falls back to notes text when code box is empty', () => {
    expect(scoreAnswer(ans({ rich_text_plain: 'rank( ) ...' }), rubric, 6).score).toBe(2);
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
        ? ans({ code: q.model_answer_md, rich_text_plain: '' })
        : ans({ rich_text_plain: q.model_answer_md });
      const r = scoreAnswer(a, q.rubric, q.max_score);
      const missed = r.hits.filter((h) => !h.matched).map((h) => h.label);
      expect(r.score / q.max_score, `missed: ${missed.join('; ')}`).toBeGreaterThanOrEqual(0.85);
    });
    it(`${q.id}: an off-topic answer scores <= 20%`, () => {
      const r = scoreAnswer(ans({ code: 'print("hello world")', rich_text_plain: 'I am not sure.' }), q.rubric, q.max_score);
      expect(r.score / q.max_score).toBeLessThanOrEqual(0.2);
    });
  }
});
