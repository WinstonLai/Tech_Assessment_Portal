import JSZip from 'jszip';
import { Table } from 'docx';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildCandidateReport, buildSummaryReport, markdownToDocx, type ReportInput } from './exportDocx';
import type { Answer, AnswerKey, Candidate, Mark, Question } from './types';

// ---------------------------------------------------------------- helpers
/** Unzips a generated .docx and returns the document XML, its plain text (one line per paragraph) and the zip. */
async function read(blob: Blob) {
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const xml = await zip.file('word/document.xml')!.async('string');
  const text = xml
    .replace(/<\/w:p>/g, '\n')
    .replace(/<w:br\/>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  return { xml, text, zip };
}

const candidate = (over: Partial<Candidate> = {}) => ({
  id: 'c1', email: 'ann@example.com', full_name: 'Ann Tan', status: 'submitted', is_active: true,
  access_expires_at: '2026-10-10T00:00:00Z', started_at: '2026-10-03T08:00:00Z', submitted_at: '2026-10-03T09:30:00Z',
  active_seconds: 3725, last_heartbeat_at: null, password_issued_at: null, created_at: '2026-10-01T00:00:00Z', ...over,
}) as Candidate;

const q = (id: string, section: string, section_title: string, title: string, max_score: number, answer_type: Question['answer_type'], prompt_md = 'Prompt'): Question =>
  ({ id, section, section_title, sort_order: 1, title, prompt_md, answer_type, max_score });

const QUESTIONS: Question[] = [
  q('A1', 'A', 'Section A: Data modelling', 'ERD', 10, 'diagram_plus_text', 'Draw an **ERD** where `a < b` & "x" holds when x < 5 and y > 3 isn\'t null.'),
  q('B1', 'B', 'Section B: SQL', 'Window functions', 6, 'code', 'Write a query:\n\n- first\n- second'),
  q('B2', 'B', 'Section B: SQL', 'Explain joins', 4, 'rich_text'),
];

const mark = (question_id: string, over: Partial<Mark> = {}): Mark => ({
  candidate_id: 'c1', question_id, auto_score: null, rubric_hits: null, final_score: null,
  reviewer_comment: null, reviewed_by: null, reviewed_at: null, ...over,
});

const doc = (...children: unknown[]) => ({ type: 'doc', content: children });
const para = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const li = (text: string) => ({ type: 'listItem', content: [para(text)] });

function input(over: Partial<ReportInput> = {}): ReportInput {
  const a1Json = doc(
    para('Users own many orders.'),
    { type: 'bulletList', content: [li('users PK id'), li('orders FK user_id')] },
    { type: 'codeBlock', content: [{ type: 'text', text: 'CREATE TABLE users (id int);' }] },
  );
  return {
    candidate: candidate(),
    questions: QUESTIONS,
    answers: {
      A1: { rich_text_json: a1Json, rich_text_plain: 'Users own many orders.', code: null, code_language: 'sql', diagram_png: null } as unknown as Answer,
      B1: { rich_text_json: null, rich_text_plain: null, code: 'SELECT 1', code_language: 'pyspark', diagram_png: null } as unknown as Answer,
      // B2 unanswered
    },
    marks: {
      A1: mark('A1', { auto_score: 4, final_score: 7, reviewer_comment: 'Good keys, missing cardinality' }),
      B1: mark('B1', {
        auto_score: 6,
        rubric_hits: [{ id: 'B1-1', label: 'Uses window function', points: 2, matched: true }, { id: 'B1-2', label: 'Partitions by user', points: 4, matched: false }],
      }),
    },
    keys: {
      A1: { question_id: 'A1', model_answer_md: 'Model: users 1:N orders', rubric: [] } as AnswerKey,
      B1: { question_id: 'B1', model_answer_md: 'Model: row_number()', rubric: [] } as AnswerKey,
    },
    includeModelAnswers: false,
    includeRubric: false,
    reviewer: 'reviewer@example.com',
    ...over,
  };
}

afterEach(() => vi.unstubAllGlobals());

// ---------------------------------------------------------------- candidate report
describe('buildCandidateReport', () => {
  it('summarises the candidate, totals and per-section scores using reviewer overrides', async () => {
    const { text } = await read(await buildCandidateReport(input()));
    expect(text).toContain('WellnessTrack Tech Assessment — Candidate Report');
    expect(text).toMatch(/Candidate\s*Ann Tan/);
    expect(text).toMatch(/Email\s*ann@example\.com/);
    expect(text).toMatch(/Active time\s*01:02:05/);
    // A1 final 7 (not auto 4) + B1 auto 6 + B2 unmarked 0 = 13 of 20
    expect(text).toMatch(/Total score\s*13 \/ 20/);
    expect(text).toMatch(/Section A: Data modelling\s*7\s*10/);
    expect(text).toMatch(/Section B: SQL\s*6\s*10/);
    expect(text).toMatch(/Reviewed by\s*reviewer@example\.com/);
  });

  it('shows per-question scores and says when the reviewer adjusted the auto score', async () => {
    const { text } = await read(await buildCandidateReport(input()));
    expect(text).toContain('A1. ERD — 7 / 10');
    expect(text).toContain('B1. Window functions — 6 / 6');
    expect(text).toContain('B2. Explain joins — 0 / 4');
    expect(text).toContain('(auto: 4, adjusted by reviewer)');
    expect(text).toMatch(/6 \/ 6\s*\(auto\)/);
    expect(text).toContain('Good keys, missing cardinality');
  });

  it('marks unanswered questions', async () => {
    const { text } = await read(await buildCandidateReport(input()));
    expect(text.match(/\(No answer provided\)/g)).toHaveLength(1); // B2 only
  });

  it('renders code answers in a labelled monospace block', async () => {
    const { xml, text } = await read(await buildCandidateReport(input()));
    expect(text).toContain('PySpark');
    expect(text).toContain('SELECT 1');
    expect(xml).toContain('w:ascii="Consolas"');
  });

  it('decodes markdown entities in the question prompt', async () => {
    const { text } = await read(await buildCandidateReport(input()));
    expect(text).toContain('a < b');
    expect(text).toContain('& "x" holds');
    expect(text).toContain("when x < 5 and y > 3 isn't null.");
    expect(text).not.toMatch(/&lt;|&gt;|&amp;|&quot;|&#39;/);
  });

  it('renders literal HTML entities in a prompt the way the browser does', async () => {
    // marked keeps entities typed in the source as-is, and the browser shows them decoded.
    const questions = [q('A1', 'A', 'Section A', 'Entities', 10, 'rich_text', 'AT&amp;T has 1 &lt; 2 &gt; 0, &quot;ok&quot; and it&#39;s fine')];
    const { text } = await read(await buildCandidateReport(input({ questions, answers: {}, marks: {}, keys: {} })));
    expect(text).toContain(`AT&T has 1 < 2 > 0, "ok" and it's fine`);
    expect(text).not.toMatch(/&amp;|&lt;|&gt;|&quot;|&#39;/);
  });

  it('converts rich-text answers: paragraphs, bullet lists and code blocks', async () => {
    const { text, xml } = await read(await buildCandidateReport(input()));
    expect(text).toContain('Users own many orders.');
    expect(text).toContain('users PK id');
    expect(text).toContain('orders FK user_id');
    expect(text).toContain('CREATE TABLE users (id int);');
    expect(xml).toContain('<w:numPr>'); // list items carry list numbering
  });

  it('converts Tiptap tables into Word tables with their cell text', async () => {
    const cell = (type: string, text: string) => ({ type, attrs: { colspan: 1, rowspan: 1 }, content: [para(text)] });
    const table = { type: 'table', content: [
      { type: 'tableRow', content: [cell('tableHeader', 'col_a'), cell('tableHeader', 'col_b')] },
      { type: 'tableRow', content: [cell('tableCell', 'v1'), cell('tableCell', 'v2')] },
    ] };
    const answers = { B2: { rich_text_json: doc(table), rich_text_plain: 'col_a col_b v1 v2', code: null, code_language: 'sql', diagram_png: null } as unknown as Answer };
    const { text, xml } = await read(await buildCandidateReport(input({ answers })));
    for (const t of ['col_a', 'col_b', 'v1', 'v2']) expect(text).toContain(t);
    expect(text).not.toContain('(No answer provided)\n(No answer provided)');
    // report tables: header, score summary, per-question table, plus this answer table
    expect((xml.match(/<w:tbl>/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });

  it('restarts numbering for each ordered list', async () => {
    const ordered = (...items: string[]) => ({ type: 'orderedList', content: items.map(li) });
    const answers = { B2: { rich_text_json: doc(ordered('one', 'two'), para('between'), ordered('uno', 'dos')), rich_text_plain: 'x', code: null, code_language: 'sql', diagram_png: null } as unknown as Answer };
    const { xml, zip } = await read(await buildCandidateReport(input({ questions: [QUESTIONS[2]], answers, marks: {}, keys: {} })));

    // The prompt has no list, so these four paragraphs are the items of the two ordered lists: each list
    // uses its own numbering instance...
    const ids = [...xml.matchAll(/<w:numId w:val="(\d+)"\/>/g)].map((m) => m[1]);
    expect(ids).toHaveLength(4);
    expect(ids[0]).toBe(ids[1]);
    expect(ids[2]).toBe(ids[3]);
    expect(ids[0]).not.toBe(ids[2]);

    // ...and each instance explicitly starts again at 1 (otherwise Word would continue 3., 4.).
    const numbering = await zip.file('word/numbering.xml')!.async('string');
    for (const id of new Set(ids)) {
      expect(numbering).toMatch(new RegExp(`<w:num w:numId="${id}">.*?<w:startOverride w:val="1"/>`));
    }
  });

  describe('optional sections', () => {
    it('includes keyword checks only when asked', async () => {
      const without = await read(await buildCandidateReport(input({ includeRubric: false })));
      expect(without.text).not.toContain('Keyword checks');

      const withIt = await read(await buildCandidateReport(input({ includeRubric: true })));
      expect(withIt.text).toContain('Keyword checks (auto-marking)');
      expect(withIt.text).toContain('✓ Uses window function (2)');
      expect(withIt.text).toContain('✗ Partitions by user (4)');
    });

    it('includes model answers only when asked', async () => {
      const without = await read(await buildCandidateReport(input({ includeModelAnswers: false })));
      expect(without.text).not.toContain('Model answer');
      expect(without.text).not.toContain('row_number()');

      const withIt = await read(await buildCandidateReport(input({ includeModelAnswers: true })));
      expect(withIt.text).toContain('Model answer');
      expect(withIt.text).toContain('Model: row_number()');
    });
  });

  describe('diagram images', () => {
    // 1x1 transparent PNG
    const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

    function stubImage(naturalWidth: number, naturalHeight: number) {
      const created: string[] = [];
      vi.stubGlobal('Image', class {
        naturalWidth = naturalWidth;
        naturalHeight = naturalHeight;
        set src(v: string) { created.push(v); }
        decode() { return Promise.resolve(); }
      });
      return created;
    }

    const onlyDiagram = (diagram_png: string) => input({
      questions: [QUESTIONS[0]], marks: {}, keys: {},
      answers: { A1: { rich_text_json: null, rich_text_plain: null, code: null, code_language: 'sql', diagram_png } as unknown as Answer },
    });

    it('never loads a remote or non-PNG diagram_png (candidate-controlled)', async () => {
      const created = stubImage(100, 50);
      for (const bad of ['https://evil.example/pixel.png', 'javascript:alert(1)', 'data:image/svg+xml;base64,PHN2Zz4=']) {
        const { text, zip } = await read(await buildCandidateReport(onlyDiagram(bad)));
        expect(text).toContain('(No answer provided)');
        expect(Object.keys(zip.files).some((f) => f.startsWith('word/media/'))).toBe(false);
      }
      expect(created).toEqual([]); // Image.src was never set, so nothing could be fetched
    });

    it('embeds an inline PNG and scales wide images to the page width', async () => {
      stubImage(1240, 1000); // wider than the 620 px maximum -> scaled by 0.5
      const { xml, zip } = await read(await buildCandidateReport(onlyDiagram(PNG)));
      expect(xml).toContain('<w:drawing>');
      expect(Object.keys(zip.files).some((f) => f.startsWith('word/media/'))).toBe(true);
      expect(xml).toContain(`cx="${620 * 9525}"`);
      expect(xml).toContain(`cy="${500 * 9525}"`);
    });

    it('keeps small images at their natural size', async () => {
      stubImage(300, 200);
      const { xml } = await read(await buildCandidateReport(onlyDiagram(PNG)));
      expect(xml).toContain(`cx="${300 * 9525}"`);
    });

    it('omits the image (instead of failing the export) when it cannot be decoded', async () => {
      vi.stubGlobal('Image', class { set src(_v: string) { /* noop */ } decode() { return Promise.reject(new Error('bad image')); } });
      const { text } = await read(await buildCandidateReport(onlyDiagram(PNG)));
      expect(text).toContain('(No answer provided)');
    });
  });
});

// ---------------------------------------------------------------- summary report
describe('buildSummaryReport', () => {
  const row = (email: string, name: string, marks: Record<string, Mark>) => ({
    candidate: candidate({ id: email, email, full_name: name, status: 'submitted' }),
    marks,
  });

  const rows = [
    row('bob@example.com', 'Bob', { A1: mark('A1', { auto_score: 5 }) }), // 5 / 20
    row('carl@example.com', 'Carl', {}), // not scored yet
    row('alice@example.com', 'Alice', { A1: mark('A1', { auto_score: 3, final_score: 10 }), B1: mark('B1', { auto_score: 6 }), B2: mark('B2', { auto_score: 4 }) }), // 20 / 20
  ];

  it('ranks marked candidates by total, best first, using reviewer overrides', async () => {
    const { text } = await read(await buildSummaryReport(rows, QUESTIONS, 'reviewer@example.com'));
    expect(text.indexOf('alice@example.com')).toBeGreaterThan(-1);
    expect(text.indexOf('alice@example.com')).toBeLessThan(text.indexOf('bob@example.com'));
    expect(text.indexOf('bob@example.com')).toBeLessThan(text.indexOf('carl@example.com'));
  });

  it('shows the real maximum in the total header and a rank only for marked candidates', async () => {
    const { text } = await read(await buildSummaryReport(rows, QUESTIONS, 'reviewer@example.com'));
    expect(text).toContain('Total /20');
    expect(text).toMatch(/\n1\nAlice/);
    expect(text).toMatch(/\n2\nBob/);
    expect(text).toMatch(/\n—\nCarl/);
  });

  it('labels unscored candidates "not marked" instead of showing 0', async () => {
    const { text } = await read(await buildSummaryReport(rows, QUESTIONS, 'reviewer@example.com'));
    // Carl: Sec A, Sec B and Total
    expect(text.match(/not marked/g)).toHaveLength(3);
  });

  it('lists a column per section and the generating reviewer', async () => {
    const { text } = await read(await buildSummaryReport(rows, QUESTIONS, 'reviewer@example.com'));
    expect(text).toContain('Sec A');
    expect(text).toContain('Sec B');
    expect(text).toContain('by reviewer@example.com');
  });

  it('produces a valid document for an empty candidate list', async () => {
    const { text } = await read(await buildSummaryReport([], QUESTIONS, 'reviewer@example.com'));
    expect(text).toContain('Candidate Summary');
  });
});

// ---------------------------------------------------------------- markdown conversion
describe('markdownToDocx', () => {
  it('emits one paragraph per heading and paragraph', () => {
    expect(markdownToDocx('# Title\n\nSome text')).toHaveLength(2);
  });

  it('converts a markdown table into a Word table', () => {
    const out = markdownToDocx('| a | b |\n|---|---|\n| 1 | 2 |');
    expect(out.some((b) => b instanceof Table)).toBe(true);
  });

  it('emits one monospace paragraph per line of a fenced code block', () => {
    expect(markdownToDocx('```sql\nselect 1\nfrom t\nwhere x\n```')).toHaveLength(3);
  });

  it('keeps list items as separate paragraphs', () => {
    expect(markdownToDocx('- one\n- two\n- three')).toHaveLength(3);
  });

  it('returns nothing for empty input', () => {
    expect(markdownToDocx('')).toEqual([]);
  });
});
