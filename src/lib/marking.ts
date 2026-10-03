import type { Answer, AnswerKey, DiagramScene, Question, RubricHit, RubricItem, Mark } from './types';

// rich_text_plain is deliberately not read: the browser writes it independently of rich_text_json, so through the
// REST API a candidate could put hidden keywords in it that the reviewer never sees. The text is derived from the
// stored JSON instead, which is also what the review page and the Word export render.
type AnswerLike = Pick<Answer, 'rich_text_json' | 'code' | 'diagram_scene'> | null | undefined;

/**
 * Longest stretch of any one answer source that is matched against the rubric regexes. The database allows
 * far more (500k chars of text, 20 MB of diagram), and a pattern such as `a.*b` is quadratic on adversarial
 * input, so one candidate could freeze the admin's browser while their answer is scored. Real answers are a
 * few thousand characters.
 */
export const MAX_SCAN_CHARS = 20_000;

const END_OF_BLOCK = Symbol('end of block'); // not a string, so candidate JSON can never collide with it
const BLOCK_NODES = new Set([
  'paragraph', 'heading', 'blockquote', 'codeBlock', 'listItem', 'bulletList', 'orderedList',
  'table', 'tableRow', 'tableCell', 'tableHeader',
]);

/**
 * Plain text of a Tiptap document, at most `limit` chars. Iterative on purpose: the JSON is candidate-controlled,
 * and a deeply nested document would overflow the stack of a recursive walk.
 */
export function richTextToPlain(doc: unknown, limit = MAX_SCAN_CHARS): string {
  const out: string[] = [];
  let length = 0;
  const stack: unknown[] = [doc];
  while (stack.length && length < limit) {
    const item = stack.pop();
    if (item === END_OF_BLOCK) { out.push('\n'); length += 1; continue; }
    if (!item || typeof item !== 'object') continue; // bare strings are not text nodes; the editor would not render them
    const node = item as { type?: unknown; text?: unknown; content?: unknown };
    if (node.type === 'text') {
      if (typeof node.text === 'string') { out.push(node.text); length += node.text.length; }
      continue;
    }
    if (node.type === 'hardBreak') { out.push('\n'); length += 1; continue; }
    if (typeof node.type === 'string' && BLOCK_NODES.has(node.type)) stack.push(END_OF_BLOCK); // popped after the children
    if (Array.isArray(node.content)) {
      for (let i = node.content.length - 1; i >= 0; i--) stack.push(node.content[i]);
    }
  }
  return out.join('').slice(0, limit);
}

/** Pulls the visible text labels out of an Excalidraw scene (entity names, PK/FK lines, relationship labels). */
export function extractDiagramText(scene: DiagramScene | null | undefined, limit = MAX_SCAN_CHARS): string {
  const elements = scene?.elements;
  if (!Array.isArray(elements)) return '';
  const parts: string[] = [];
  let length = 0;
  for (const el of elements) {
    // Invisible (opacity 0) labels would let a candidate stuff keywords the reviewer cannot see.
    if (el?.type !== 'text' || el.isDeleted || el.opacity === 0) continue;
    const text = String(el.originalText ?? el.text ?? '');
    parts.push(text);
    length += text.length + 1;
    if (length >= limit) break;
  }
  return parts.join('\n').slice(0, limit);
}

export function answerSources(answer: AnswerLike, limit = MAX_SCAN_CHARS) {
  const text = richTextToPlain(answer?.rich_text_json, limit);
  const code = (answer?.code ?? '').slice(0, limit);
  const diagram = extractDiagramText(answer?.diagram_scene, limit);
  return { text, code, diagram, any: [text, code, diagram].join('\n') };
}

export function isAnswered(answer: AnswerLike): boolean {
  // Only emptiness matters here, so look at a short prefix; this runs for every question on each keystroke.
  const s = answerSources(answer, 2000);
  return Boolean(s.text.trim() || s.code.trim() || (answer?.diagram_scene?.elements?.length ?? 0) > 0);
}

function safeRegex(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern, 'i');
  } catch {
    return null;
  }
}

/**
 * Keyword-heuristic score. Each rubric item is awarded in full when its patterns match
 * ('any' = at least one, 'all' = every pattern) in the chosen source. Code questions fall back to
 * the notes text so a candidate who pasted code into the notes box is not penalised.
 */
export function scoreAnswer(answer: AnswerLike, rubric: RubricItem[], maxScore: number): { score: number; hits: RubricHit[] } {
  const sources = answerSources(answer);
  const hits = rubric.map((item) => {
    let haystack = sources[item.source] ?? sources.any;
    if (item.source === 'code' && !sources.code.trim()) haystack = sources.text;
    if (item.source === 'text') haystack = `${sources.text}\n${sources.diagram}`;
    const regexes = item.patterns.map(safeRegex).filter((r): r is RegExp => r !== null);
    const matched = haystack.trim().length > 0 && regexes.length > 0 &&
      (item.match === 'all' ? regexes.every((r) => r.test(haystack)) : regexes.some((r) => r.test(haystack)));
    return { id: item.id, label: item.label, points: item.points, matched };
  });
  const raw = hits.reduce((sum, h) => sum + (h.matched ? h.points : 0), 0);
  return { score: Math.min(maxScore, Math.round(raw * 10) / 10), hits };
}

export type AutoMarkRow = Pick<Mark, 'candidate_id' | 'question_id' | 'auto_score' | 'rubric_hits'>;

/**
 * Recomputes keyword auto-scores for one candidate. Returns only the rows whose score or hits changed
 * (to upsert; reviewer overrides and comments are not part of the row, so they are untouched) plus the
 * updated marks map. Questions without an answer-key entry are skipped.
 */
export function computeAutoMarks(
  candidateId: string,
  questions: Pick<Question, 'id' | 'max_score'>[],
  keys: Record<string, Pick<AnswerKey, 'rubric'> | undefined>,
  answers: Record<string, AnswerLike>,
  marks: Record<string, Mark | undefined>,
): { changed: AutoMarkRow[]; marks: Record<string, Mark> } {
  const next = { ...marks } as Record<string, Mark>;
  const changed: AutoMarkRow[] = [];
  for (const q of questions) {
    const key = keys[q.id];
    if (!key) continue;
    const { score, hits } = scoreAnswer(answers[q.id], key.rubric, Number(q.max_score));
    const prev = marks[q.id];
    if (!prev || Number(prev.auto_score) !== score || JSON.stringify(prev.rubric_hits) !== JSON.stringify(hits)) {
      changed.push({ candidate_id: candidateId, question_id: q.id, auto_score: score, rubric_hits: hits });
      next[q.id] = {
        ...(prev ?? { final_score: null, reviewer_comment: null, reviewed_by: null, reviewed_at: null }),
        candidate_id: candidateId, question_id: q.id, auto_score: score, rubric_hits: hits,
      };
    }
  }
  return { changed, marks: next };
}

/** Effective score for a question: reviewer override if present, else auto score. */
export function effectiveScore(mark: Pick<Mark, 'final_score' | 'auto_score'> | undefined): number {
  if (!mark) return 0;
  return Number(mark.final_score ?? mark.auto_score ?? 0);
}

export function sectionTotals(questions: Question[], marks: Record<string, Mark | undefined>) {
  const bySection = new Map<string, { title: string; score: number; max: number }>();
  for (const q of questions) {
    const cur = bySection.get(q.section) ?? { title: q.section_title, score: 0, max: 0 };
    cur.score += effectiveScore(marks[q.id]);
    cur.max += Number(q.max_score);
    bySection.set(q.section, cur);
  }
  const total = [...bySection.values()].reduce((s, v) => s + v.score, 0);
  const max = [...bySection.values()].reduce((s, v) => s + v.max, 0);
  return { sections: bySection, total: Math.round(total * 10) / 10, max };
}
