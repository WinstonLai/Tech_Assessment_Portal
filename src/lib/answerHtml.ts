import { generateHTML, type JSONContent } from '@tiptap/react';
import { answerExtensions } from './tiptapExtensions';
import { sanitizeHtml } from './markdown';

/**
 * HTML for the reviewer, generated from the stored Tiptap document and then sanitised. The stored
 * `rich_text_html` column is not used: the browser writes it independently of `rich_text_json`, so a candidate
 * could make it differ from the document that is scored and exported. Returns null when the document is not
 * valid for the editor's schema (hand-crafted JSON); the caller then falls back to plain text.
 */
export function renderAnswerHtml(json: JSONContent | null | undefined): string | null {
  if (!json || typeof json !== 'object') return null;
  try {
    return sanitizeHtml(generateHTML(json, answerExtensions));
  } catch {
    return null;
  }
}
