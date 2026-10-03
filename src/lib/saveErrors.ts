import type { AnswerPatch } from './types';

/**
 * Errors that retrying cannot fix: integrity (class 23, e.g. CHECK size limits), data exception (class 22)
 * and insufficient privilege (42501, e.g. RLS after expiry or submission). Network failures, 5xx and token
 * refreshes carry no such code and stay retryable.
 */
export function isPermanentSaveError(err: { code?: string } | null | undefined): boolean {
  const code = err?.code ?? '';
  return /^(23|22)/.test(code) || code === '42501';
}

/** Turns a database rejection into something a candidate can act on. */
export function friendlySaveError(message: string): string {
  if (/answers_size_limits|answers_diagram_png_format/.test(message)) {
    return 'this answer is too large to save (for example big pasted images). Remove or shrink them.';
  }
  if (/row-level security|42501/.test(message)) {
    return 'your access to this assessment has ended or it was already submitted.';
  }
  return message;
}

const DIAGRAM_KEYS = new Set(['diagram_scene', 'diagram_png']);

export type PatchGroup = 'diagram' | 'content';

/**
 * Splits a patch so the (large) diagram fields are saved separately from text/code. One oversized
 * diagram then cannot stop the same question's text from being stored.
 */
export function splitPatch(patch: AnswerPatch): { group: PatchGroup; patch: AnswerPatch }[] {
  const diagram: Record<string, unknown> = {};
  const content: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) (DIAGRAM_KEYS.has(k) ? diagram : content)[k] = v;
  const out: { group: PatchGroup; patch: AnswerPatch }[] = [];
  if (Object.keys(content).length) out.push({ group: 'content', patch: content as AnswerPatch });
  if (Object.keys(diagram).length) out.push({ group: 'diagram', patch: diagram as AnswerPatch });
  return out;
}
