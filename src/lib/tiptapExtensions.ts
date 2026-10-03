import StarterKit from '@tiptap/starter-kit';
import { TableKit } from '@tiptap/extension-table';

/**
 * The node and mark types an answer can contain. The candidate's editor and the reviewer's read-only rendering
 * (`renderAnswerHtml`) must share this list: the reviewer then sees exactly what the editor could have produced,
 * and anything else in a hand-crafted document is dropped.
 */
export const answerExtensions = [
  StarterKit.configure({ heading: { levels: [2, 3] }, link: { openOnClick: false } }),
  TableKit.configure({ table: { resizable: false } }),
];
