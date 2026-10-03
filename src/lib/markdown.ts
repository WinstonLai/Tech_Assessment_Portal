import { marked } from 'marked';
import DOMPurify from 'dompurify';

marked.setOptions({ gfm: true, breaks: false });

export function renderMarkdown(md: string): string {
  return DOMPurify.sanitize(marked.parse(md, { async: false }) as string);
}

// Candidate-authored HTML is untrusted: a candidate can write any string into answers.rich_text_html
// through the REST API, and it is rendered in the admin's browser. Allow only what the Tiptap editor
// (StarterKit + TableKit) can produce, so injected <style>, remote <img>/<iframe>, forms, and inline
// styles (UI redressing, tracking pixels) are dropped.
const ANSWER_TAGS = [
  'p', 'br', 'hr', 'strong', 'b', 'em', 'i', 's', 'u', 'code', 'pre', 'blockquote',
  'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'a',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'colgroup', 'col',
];
// No `class`: with Tailwind on the page a candidate could use `fixed inset-0 z-50 bg-white` to cover the
// admin UI. Answer styling in index.css is by element selector, so nothing needs it.
const ANSWER_ATTRS = ['href', 'colspan', 'rowspan', 'colwidth'];

export function sanitizeHtml(html: string): string {
  const clean = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ANSWER_TAGS,
    ALLOWED_ATTR: ANSWER_ATTRS,
    ALLOW_DATA_ATTR: false,
    RETURN_DOM_FRAGMENT: true,
  }) as DocumentFragment;
  // Open candidate links in a new tab so clicking one cannot navigate the admin away from unsaved marks.
  clean.querySelectorAll('a[href]').forEach((a) => {
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener noreferrer nofollow');
  });
  const holder = document.createElement('div');
  holder.appendChild(clean);
  return holder.innerHTML;
}

const PNG_DATA_URL = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/;

/** Returns the value only if it is an inline PNG; anything else (e.g. a remote URL) is rejected. */
export function safePngDataUrl(value: string | null | undefined): string | null {
  return value && PNG_DATA_URL.test(value) ? value : null;
}
