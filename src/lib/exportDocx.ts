import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type ParagraphChild,
} from 'docx';
import { marked, type Token, type Tokens } from 'marked';
import type { JSONContent } from '@tiptap/react';
import type { Answer, AnswerKey, Candidate, Mark, Question } from './types';
import { effectiveScore, richTextToPlain, sectionTotals } from './marking';
import { formatDateTime, formatDuration } from './format';
import { safePngDataUrl } from './markdown';

const MONO = 'Consolas';
const CODE_SHADE = { type: ShadingType.CLEAR, color: 'auto', fill: 'F1F5F9' } as const;
const MAX_IMG_WIDTH = 620;

// ---------------------------------------------------------------- numbering (ordered lists restart per list)
let numberingInstance = 0;
const NUMBERING = {
  config: [
    {
      reference: 'ordered',
      levels: [0, 1, 2].map((level) => ({
        level,
        format: [LevelFormat.DECIMAL, LevelFormat.LOWER_LETTER, LevelFormat.LOWER_ROMAN][level],
        text: `%${level + 1}.`,
        alignment: AlignmentType.START,
        style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
      })),
    },
  ],
};

interface RunStyle { bold?: boolean; italics?: boolean; underline?: boolean; strike?: boolean; code?: boolean }

function run(text: string, s: RunStyle = {}): TextRun {
  return new TextRun({
    text,
    bold: s.bold,
    italics: s.italics,
    strike: s.strike,
    underline: s.underline ? {} : undefined,
    font: s.code ? MONO : undefined,
    shading: s.code ? CODE_SHADE : undefined,
  });
}

function codeBlock(code: string, label?: string): Paragraph[] {
  const out: Paragraph[] = [];
  if (label) out.push(new Paragraph({ children: [run(label, { bold: true })], spacing: { before: 120 } }));
  const lines = code.replace(/\t/g, '    ').split('\n');
  lines.forEach((line, i) =>
    out.push(new Paragraph({
      children: [new TextRun({ text: line || ' ', font: MONO, size: 18 })],
      shading: CODE_SHADE,
      spacing: { before: i === 0 ? 80 : 0, after: i === lines.length - 1 ? 120 : 0, line: 260 },
      border: i === 0 ? { top: { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' } } : i === lines.length - 1 ? { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' } } : undefined,
    })),
  );
  return out;
}

function simpleTable(rows: string[][], header = true, widths?: number[]): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    columnWidths: widths,
    rows: rows.map((cells, r) =>
      new TableRow({
        tableHeader: header && r === 0,
        children: cells.map((text) =>
          new TableCell({
            shading: header && r === 0 ? { type: ShadingType.CLEAR, color: 'auto', fill: 'E2E8F0' } : undefined,
            children: [new Paragraph({ children: [run(text, { bold: header && r === 0 })] })],
          }),
        ),
      }),
    ),
  });
}

// ---------------------------------------------------------------- markdown -> docx
function inlineMd(tokens: Token[] | undefined, s: RunStyle = {}): ParagraphChild[] {
  if (!tokens) return [];
  const out: ParagraphChild[] = [];
  for (const t of tokens) {
    switch (t.type) {
      case 'strong': out.push(...inlineMd((t as Tokens.Strong).tokens, { ...s, bold: true })); break;
      case 'em': out.push(...inlineMd((t as Tokens.Em).tokens, { ...s, italics: true })); break;
      case 'del': out.push(...inlineMd((t as Tokens.Del).tokens, { ...s, strike: true })); break;
      case 'codespan': out.push(run(decode((t as Tokens.Codespan).text), { ...s, code: true })); break;
      case 'link': out.push(...inlineMd((t as Tokens.Link).tokens, { ...s, underline: true })); break;
      case 'br': out.push(new TextRun({ text: '', break: 1 })); break;
      case 'text': {
        const tt = t as Tokens.Text;
        if (tt.tokens?.length) out.push(...inlineMd(tt.tokens, s));
        else out.push(run(decode(tt.text), s));
        break;
      }
      default: out.push(run(decode((t as { raw?: string }).raw ?? ''), s));
    }
  }
  return out;
}

function decode(s: string): string {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

function blocksMd(tokens: Token[], level = 0): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = [];
  for (const t of tokens) {
    switch (t.type) {
      case 'heading':
        out.push(new Paragraph({ heading: HeadingLevel.HEADING_4, children: inlineMd((t as Tokens.Heading).tokens) }));
        break;
      case 'paragraph':
        out.push(new Paragraph({ children: inlineMd((t as Tokens.Paragraph).tokens), spacing: { after: 100 } }));
        break;
      case 'code':
        out.push(...codeBlock((t as Tokens.Code).text));
        break;
      case 'blockquote':
        out.push(...blocksMd((t as Tokens.Blockquote).tokens, level));
        break;
      case 'list': {
        const list = t as Tokens.List;
        const inst = list.ordered ? ++numberingInstance : undefined;
        for (const item of list.items) {
          const [first, ...rest] = item.tokens;
          const firstInline = first && (first.type === 'text' || first.type === 'paragraph')
            ? inlineMd((first as Tokens.Text).tokens ?? [first])
            : [];
          out.push(new Paragraph({
            children: firstInline,
            bullet: list.ordered ? undefined : { level },
            numbering: list.ordered ? { reference: 'ordered', level, instance: inst } : undefined,
          }));
          const remaining = first && (first.type === 'text' || first.type === 'paragraph') ? rest : item.tokens;
          out.push(...blocksMd(remaining, level + 1));
        }
        break;
      }
      case 'table': {
        const tb = t as Tokens.Table;
        const text = (cell: Tokens.TableCell) => decode(cell.text);
        out.push(simpleTable([tb.header.map(text), ...tb.rows.map((r) => r.map(text))]));
        out.push(new Paragraph({ text: '' }));
        break;
      }
      case 'hr':
      case 'space':
        break;
      default:
        if ('text' in t && typeof t.text === 'string') out.push(new Paragraph({ children: [run(decode(t.text))] }));
    }
  }
  return out;
}

export function markdownToDocx(md: string): (Paragraph | Table)[] {
  return blocksMd(marked.lexer(md));
}

// ---------------------------------------------------------------- tiptap JSON -> docx
function inlineTiptap(nodes: JSONContent[] | undefined): ParagraphChild[] {
  if (!nodes) return [];
  const out: ParagraphChild[] = [];
  for (const n of nodes) {
    if (n.type === 'hardBreak') { out.push(new TextRun({ text: '', break: 1 })); continue; }
    if (n.type !== 'text') continue;
    const marks = new Set((n.marks ?? []).map((m) => m.type));
    out.push(run(n.text ?? '', {
      bold: marks.has('bold'), italics: marks.has('italic'), underline: marks.has('underline') || marks.has('link'),
      strike: marks.has('strike'), code: marks.has('code'),
    }));
  }
  return out;
}

function blocksTiptap(nodes: JSONContent[] | undefined, level = 0): (Paragraph | Table)[] {
  if (!nodes) return [];
  const out: (Paragraph | Table)[] = [];
  for (const n of nodes) {
    switch (n.type) {
      case 'paragraph':
        out.push(new Paragraph({ children: inlineTiptap(n.content), spacing: { after: 100 } }));
        break;
      case 'heading':
        out.push(new Paragraph({ heading: n.attrs?.level === 2 ? HeadingLevel.HEADING_4 : HeadingLevel.HEADING_5, children: inlineTiptap(n.content) }));
        break;
      case 'blockquote':
        out.push(...blocksTiptap(n.content, level));
        break;
      case 'codeBlock':
        out.push(...codeBlock((n.content ?? []).map((c) => c.text ?? '').join('')));
        break;
      case 'bulletList':
      case 'orderedList': {
        const ordered = n.type === 'orderedList';
        const inst = ordered ? ++numberingInstance : undefined;
        for (const li of n.content ?? []) {
          const [first, ...rest] = li.content ?? [];
          out.push(new Paragraph({
            children: first?.type === 'paragraph' ? inlineTiptap(first.content) : [],
            bullet: ordered ? undefined : { level },
            numbering: ordered ? { reference: 'ordered', level, instance: inst } : undefined,
          }));
          out.push(...blocksTiptap(first?.type === 'paragraph' ? rest : li.content, level + 1));
        }
        break;
      }
      case 'table': {
        const rows = (n.content ?? []).map((row) =>
          new TableRow({
            children: (row.content ?? []).map((cell) =>
              new TableCell({
                shading: cell.type === 'tableHeader' ? { type: ShadingType.CLEAR, color: 'auto', fill: 'E2E8F0' } : undefined,
                columnSpan: cell.attrs?.colspan ?? 1,
                rowSpan: cell.attrs?.rowspan ?? 1,
                children: (() => {
                  const b = blocksTiptap(cell.content).filter((x): x is Paragraph => x instanceof Paragraph);
                  return b.length ? b : [new Paragraph('')];
                })(),
              }),
            ),
          }),
        );
        if (rows.length) out.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows }), new Paragraph(''));
        break;
      }
      case 'horizontalRule':
        out.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'CBD5E1' } } }));
        break;
      default:
        if (n.content) out.push(...blocksTiptap(n.content, level));
    }
  }
  return out;
}

// ---------------------------------------------------------------- images
async function pngFromDataUrl(value: string): Promise<ImageRun | null> {
  const dataUrl = safePngDataUrl(value); // candidate-supplied: never let `new Image()` fetch a remote URL
  if (!dataUrl) return null;
  try {
    const img = new Image();
    img.src = dataUrl;
    await img.decode();
    const scale = Math.min(1, MAX_IMG_WIDTH / img.naturalWidth);
    const bin = atob(dataUrl.split(',')[1]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new ImageRun({
      type: 'png',
      data: bytes,
      transformation: { width: Math.round(img.naturalWidth * scale), height: Math.round(img.naturalHeight * scale) },
    });
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- reports
export interface ReportInput {
  candidate: Candidate;
  questions: Question[];
  answers: Record<string, Answer | undefined>;
  marks: Record<string, Mark | undefined>;
  keys: Record<string, AnswerKey | undefined>;
  includeModelAnswers: boolean;
  includeRubric: boolean;
  reviewer: string;
}

const h = (text: string, heading: (typeof HeadingLevel)[keyof typeof HeadingLevel]) => new Paragraph({ text, heading, spacing: { before: 240, after: 120 } });
const label = (text: string) => new Paragraph({ children: [run(text, { bold: true })], spacing: { before: 200, after: 80 } });
const muted = (text: string) => new Paragraph({ children: [new TextRun({ text, italics: true, color: '64748B' })] });

export async function buildCandidateReport(input: ReportInput): Promise<Blob> {
  const { candidate, questions, answers, marks, keys } = input;
  numberingInstance = 0;
  const totals = sectionTotals(questions, marks);
  const fmt = (n: number) => (Math.round(n * 10) / 10).toString();

  const body: (Paragraph | Table)[] = [
    new Paragraph({ text: 'WellnessTrack Tech Assessment — Candidate Report', heading: HeadingLevel.TITLE }),
    muted('HPB CDOO · Data Engineering Internship'),
    new Paragraph(''),
    simpleTable([
      ['Candidate', candidate.full_name || '—'],
      ['Email', candidate.email],
      ['Status', candidate.status.replace('_', ' ')],
      ['Started', formatDateTime(candidate.started_at)],
      ['Submitted', formatDateTime(candidate.submitted_at)],
      ['Active time', formatDuration(candidate.active_seconds)],
      ['Total score', `${fmt(totals.total)} / ${totals.max}`],
      ['Reviewed by', input.reviewer],
      ['Report generated', formatDateTime(new Date().toISOString())],
    ], false, [2600, 6400]),
    h('Score summary', HeadingLevel.HEADING_1),
    simpleTable([
      ['Section', 'Score', 'Max'],
      ...[...totals.sections.entries()].map(([, v]) => [v.title, fmt(v.score), String(v.max)]),
      ['Total', fmt(totals.total), String(totals.max)],
    ], true, [6000, 1500, 1500]),
    new Paragraph(''),
    simpleTable([
      ['Q', 'Title', 'Auto', 'Final', 'Max', 'Reviewer comment'],
      ...questions.map((q) => {
        const m = marks[q.id];
        return [q.id, q.title, m?.auto_score != null ? fmt(Number(m.auto_score)) : '—', fmt(effectiveScore(m)), String(q.max_score), m?.reviewer_comment ?? ''];
      }),
    ], true, [600, 2800, 800, 800, 700, 3300]),
  ];

  let lastSection = '';
  for (const q of questions) {
    const a = answers[q.id];
    const m = marks[q.id];
    if (q.section !== lastSection) {
      body.push(new Paragraph({ text: q.section_title, heading: HeadingLevel.HEADING_1, pageBreakBefore: true, spacing: { after: 120 } }));
      lastSection = q.section;
    }
    body.push(h(`${q.id}. ${q.title} — ${fmt(effectiveScore(m))} / ${q.max_score}`, HeadingLevel.HEADING_2));
    body.push(label('Question'), ...markdownToDocx(q.prompt_md));
    body.push(label('Candidate answer'));

    let any = false;
    if (a?.diagram_png) {
      const img = await pngFromDataUrl(a.diagram_png);
      if (img) { body.push(new Paragraph({ children: [img] })); any = true; }
    }
    if (a?.code?.trim()) {
      body.push(...codeBlock(a.code, a.code_language === 'pyspark' ? 'PySpark' : 'SQL'));
      any = true;
    }
    if (a?.rich_text_json && richTextToPlain(a.rich_text_json, 2000).trim()) {
      if (q.answer_type !== 'rich_text') body.push(label(q.answer_type === 'code' ? 'Notes' : 'Explanation'));
      body.push(...blocksTiptap(a.rich_text_json.content));
      any = true;
    }
    if (!any) body.push(muted('(No answer provided)'));

    if (input.includeRubric && m?.rubric_hits?.length) {
      body.push(label('Keyword checks (auto-marking)'));
      for (const hit of m.rubric_hits) {
        body.push(new Paragraph({
          bullet: { level: 0 },
          children: [run(`${hit.matched ? '✓' : '✗'} ${hit.label} (${hit.points})`, {})],
        }));
      }
    }
    body.push(label('Score'), new Paragraph({
      children: [run(`${fmt(effectiveScore(m))} / ${q.max_score}`, { bold: true }),
        run(m?.final_score != null && m.final_score !== m.auto_score ? `  (auto: ${fmt(Number(m.auto_score ?? 0))}, adjusted by reviewer)` : '  (auto)')],
    }));
    if (m?.reviewer_comment) body.push(label('Reviewer comment'), new Paragraph(m.reviewer_comment));
    if (input.includeModelAnswers && keys[q.id]) {
      body.push(label('Model answer'), ...markdownToDocx(keys[q.id]!.model_answer_md));
    }
  }

  const doc = new Document({
    creator: input.reviewer,
    title: `WellnessTrack assessment — ${candidate.full_name || candidate.email}`,
    numbering: NUMBERING,
    styles: { default: { document: { run: { font: 'Calibri', size: 22 } } } },
    sections: [{ properties: { page: { margin: { top: 1000, bottom: 1000, left: 1100, right: 1100 } } }, children: body }],
  });
  return Packer.toBlob(doc);
}

export interface SummaryRow {
  candidate: Candidate;
  marks: Record<string, Mark | undefined>;
}

export async function buildSummaryReport(rows: SummaryRow[], questions: Question[], reviewer: string): Promise<Blob> {
  const sections = [...new Set(questions.map((q) => q.section))];
  const fmt = (n: number) => (Math.round(n * 10) / 10).toString();
  // A candidate with no marks rows has not been auto-scored or reviewed yet: show that, not a misleading 0.
  const data = rows
    .map((r) => ({ r, marked: Object.keys(r.marks).length > 0, t: sectionTotals(questions, r.marks) }))
    .sort((a, b) => Number(b.marked) - Number(a.marked) || b.t.total - a.t.total);
  const max = sectionTotals(questions, {}).max;
  let rank = 0;
  const doc = new Document({
    creator: reviewer,
    title: 'WellnessTrack assessment — candidate summary',
    styles: { default: { document: { run: { font: 'Calibri', size: 20 } } } },
    sections: [{
      properties: { page: { size: { orientation: 'landscape' as never }, margin: { top: 900, bottom: 900, left: 900, right: 900 } } },
      children: [
        new Paragraph({ text: 'WellnessTrack Tech Assessment — Candidate Summary', heading: HeadingLevel.TITLE }),
        muted(`Generated ${formatDateTime(new Date().toISOString())} by ${reviewer}`),
        new Paragraph(''),
        simpleTable([
          ['#', 'Candidate', 'Email', 'Status', 'Active time', 'Submitted', ...sections.map((s) => `Sec ${s}`), `Total /${max}`],
          ...data.map(({ r, marked, t }) => [
            marked ? String(++rank) : '—', r.candidate.full_name ?? '', r.candidate.email, r.candidate.status.replace('_', ' '),
            formatDuration(r.candidate.active_seconds), formatDateTime(r.candidate.submitted_at),
            ...sections.map((s) => (marked ? fmt(t.sections.get(s)?.score ?? 0) : 'not marked')),
            marked ? fmt(t.total) : 'not marked',
          ]),
        ]),
      ],
    }],
  });
  return Packer.toBlob(doc);
}
