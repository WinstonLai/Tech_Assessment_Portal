import { useEditor, EditorContent, type Editor, type JSONContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { TableKit } from '@tiptap/extension-table';
import { Placeholder } from '@tiptap/extensions';

export interface RichTextValue {
  json: JSONContent;
  html: string;
  plain: string;
}

interface Props {
  initialContent: JSONContent | null;
  onChange?: (value: RichTextValue) => void;
  editable?: boolean;
  placeholder?: string;
  minHeight?: number;
}

export default function RichTextEditor({ initialContent, onChange, editable = true, placeholder, minHeight = 220 }: Props) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3] }, link: { openOnClick: false } }),
      TableKit.configure({ table: { resizable: false } }),
      Placeholder.configure({ placeholder: placeholder ?? 'Type your answer here…' }),
    ],
    content: initialContent ?? '',
    editable,
    shouldRerenderOnTransaction: true,
    onUpdate: ({ editor }) => {
      onChange?.({ json: editor.getJSON(), html: editor.getHTML(), plain: editor.getText({ blockSeparator: '\n' }) });
    },
  });

  return (
    <div className="rounded-lg border border-slate-300 bg-surface focus-within:border-indigo-500 focus-within:ring-2 focus-within:ring-indigo-100">
      {editable && editor && <Toolbar editor={editor} />}
      <EditorContent
        editor={editor}
        className="rich-text prose prose-slate max-w-none px-4 py-3"
        style={{ minHeight }}
      />
    </div>
  );
}

function Btn({ onClick, active, disabled, title, children }: {
  onClick: () => void; active?: boolean; disabled?: boolean; title: string; children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`min-w-8 rounded px-2 py-1 text-sm font-medium transition ${
        active ? 'bg-indigo-100 text-indigo-700 dark:text-indigo-300' : 'text-slate-700 hover:bg-slate-100'
      } disabled:cursor-not-allowed disabled:opacity-40`}
    >
      {children}
    </button>
  );
}

const Sep = () => <span className="mx-1 h-5 w-px bg-slate-200" />;

function Toolbar({ editor }: { editor: Editor }) {
  const c = () => editor.chain().focus();
  const inTable = editor.isActive('table');
  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b border-slate-200 bg-slate-50 px-2 py-1.5 rounded-t-lg">
      <Btn title="Bold (Ctrl+B)" active={editor.isActive('bold')} onClick={() => c().toggleBold().run()}><b>B</b></Btn>
      <Btn title="Italic (Ctrl+I)" active={editor.isActive('italic')} onClick={() => c().toggleItalic().run()}><i>I</i></Btn>
      <Btn title="Underline (Ctrl+U)" active={editor.isActive('underline')} onClick={() => c().toggleUnderline().run()}><u>U</u></Btn>
      <Btn title="Strikethrough" active={editor.isActive('strike')} onClick={() => c().toggleStrike().run()}><s>S</s></Btn>
      <Btn title="Inline code" active={editor.isActive('code')} onClick={() => c().toggleCode().run()}><code>{'<>'}</code></Btn>
      <Sep />
      <Btn title="Heading" active={editor.isActive('heading', { level: 2 })} onClick={() => c().toggleHeading({ level: 2 }).run()}>H2</Btn>
      <Btn title="Subheading" active={editor.isActive('heading', { level: 3 })} onClick={() => c().toggleHeading({ level: 3 }).run()}>H3</Btn>
      <Sep />
      <Btn title="Bullet list" active={editor.isActive('bulletList')} onClick={() => c().toggleBulletList().run()}>• List</Btn>
      <Btn title="Numbered list" active={editor.isActive('orderedList')} onClick={() => c().toggleOrderedList().run()}>1. List</Btn>
      <Btn title="Quote" active={editor.isActive('blockquote')} onClick={() => c().toggleBlockquote().run()}>❝</Btn>
      <Btn title="Code block" active={editor.isActive('codeBlock')} onClick={() => c().toggleCodeBlock().run()}>{'{ }'}</Btn>
      <Sep />
      <Btn title="Insert table" onClick={() => c().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}>⊞ Table</Btn>
      {inTable && (
        <>
          <Btn title="Add row below" onClick={() => c().addRowAfter().run()}>+Row</Btn>
          <Btn title="Add column right" onClick={() => c().addColumnAfter().run()}>+Col</Btn>
          <Btn title="Delete row" onClick={() => c().deleteRow().run()}>−Row</Btn>
          <Btn title="Delete column" onClick={() => c().deleteColumn().run()}>−Col</Btn>
          <Btn title="Delete table" onClick={() => c().deleteTable().run()}>✕ Table</Btn>
        </>
      )}
      <Sep />
      <Btn title="Undo (Ctrl+Z)" disabled={!editor.can().undo()} onClick={() => c().undo().run()}>↶</Btn>
      <Btn title="Redo (Ctrl+Shift+Z)" disabled={!editor.can().redo()} onClick={() => c().redo().run()}>↷</Btn>
    </div>
  );
}
