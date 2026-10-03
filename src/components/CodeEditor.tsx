import CodeMirror from '@uiw/react-codemirror';
import { sql } from '@codemirror/lang-sql';
import { python } from '@codemirror/lang-python';
import { EditorView } from '@codemirror/view';
import { useMemo } from 'react';
import type { CodeLanguage } from '../lib/types';
import { useTheme } from '../lib/theme';

interface Props {
  value: string;
  language: CodeLanguage;
  onChange?: (value: string) => void;
  onLanguageChange?: (lang: CodeLanguage) => void;
  readOnly?: boolean;
  minHeight?: string;
}

const LANGS: { id: CodeLanguage; label: string }[] = [
  { id: 'sql', label: 'SQL' },
  { id: 'pyspark', label: 'PySpark' },
];

export default function CodeEditor({ value, language, onChange, onLanguageChange, readOnly = false, minHeight = '320px' }: Props) {
  const { theme } = useTheme();
  const extensions = useMemo(
    () => [language === 'sql' ? sql() : python(), EditorView.lineWrapping],
    [language],
  );

  return (
    <div className="overflow-hidden rounded-lg border border-slate-300 bg-surface focus-within:border-indigo-500 focus-within:ring-2 focus-within:ring-indigo-100">
      <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-3 py-1.5">
        <div className="flex items-center gap-1" role="radiogroup" aria-label="Code language">
          {readOnly ? (
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {LANGS.find((l) => l.id === language)?.label}
            </span>
          ) : (
            LANGS.map((l) => (
              <button
                key={l.id}
                type="button"
                role="radio"
                aria-checked={language === l.id}
                onClick={() => onLanguageChange?.(l.id)}
                className={`rounded px-2.5 py-1 text-xs font-semibold transition ${
                  language === l.id ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-200'
                }`}
              >
                {l.label}
              </button>
            ))
          )}
        </div>
        {!readOnly && <span className="text-xs text-slate-500">Syntax highlighting only — code is not executed</span>}
      </div>
      <CodeMirror
        value={value}
        minHeight={minHeight}
        extensions={extensions}
        theme={theme}
        editable={!readOnly}
        readOnly={readOnly}
        onChange={onChange}
        basicSetup={{ lineNumbers: true, foldGutter: true, highlightActiveLine: !readOnly, autocompletion: !readOnly, tabSize: 4 }}
        placeholder={readOnly ? '' : language === 'sql' ? '-- Write your SQL here' : '# Write your PySpark code here'}
        className="text-sm"
      />
    </div>
  );
}
