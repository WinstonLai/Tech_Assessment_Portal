import { useEffect, useRef, type ReactNode } from 'react';
import { renderMarkdown } from '../lib/markdown';
import { useTheme } from '../lib/theme';

export function Markdown({ md, className = '' }: { md: string; className?: string }) {
  return (
    <div
      className={`prose prose-slate max-w-none prose-code:before:content-none prose-code:after:content-none prose-code:rounded prose-code:bg-slate-100 prose-code:px-1 prose-code:py-0.5 prose-code:font-normal prose-pre:bg-slate-900 ${className}`}
      dangerouslySetInnerHTML={{ __html: renderMarkdown(md) }}
    />
  );
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-slate-500" role="status">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-indigo-600" />
      {label}
    </div>
  );
}

export function FullPageSpinner() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <Spinner />
    </div>
  );
}

/**
 * `dismissible={false}` disables closing by Escape or a click on the backdrop, for dialogs that show
 * something once (e.g. a generated password) and must only close through an explicit button.
 */
export function Modal({ open, title, onClose, children, footer, wide, dismissible = true }: {
  open: boolean; title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean; dismissible?: boolean;
}) {
  useEffect(() => {
    if (!open || !dismissible) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, dismissible, onClose]);
  // Keyboard users: move focus into the dialog, keep Tab inside it while it is open, and put focus back on the
  // control that opened it afterwards. (aria-modal alone does not stop Tab from reaching the page behind.)
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const root = dialogRef.current;
    const focusable = () => (root
      ? Array.from(root.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])'))
      : []);
    (focusable()[0] ?? root)?.focus();
    const onTab = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !root) return;
      const items = focusable();
      if (!items.length) { e.preventDefault(); root.focus(); return; }
      const first = items[0];
      const last = items[items.length - 1];
      const outside = !root.contains(document.activeElement);
      if (e.shiftKey && (outside || document.activeElement === first)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (outside || document.activeElement === last)) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onTab);
    return () => {
      document.removeEventListener('keydown', onTab);
      if (previous?.isConnected) previous.focus();
    };
  }, [open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onMouseDown={dismissible ? onClose : undefined}>
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`flex max-h-full w-full flex-col ${wide ? 'max-w-2xl' : 'max-w-md'} rounded-xl bg-surface shadow-xl outline-none`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 border-b border-slate-200 px-5 py-3">
          <h2 className="text-base font-semibold">{title}</h2>
        </div>
        {/* Only the body scrolls, so a tall dialog on a short window keeps its title and footer buttons on screen. */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex shrink-0 justify-end gap-2 border-t border-slate-200 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

type BtnVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
const variants: Record<BtnVariant, string> = {
  primary: 'bg-indigo-600 text-white hover:bg-indigo-700 disabled:bg-indigo-300',
  secondary: 'border border-slate-300 bg-surface text-slate-800 hover:bg-slate-50 disabled:text-slate-400',
  danger: 'bg-rose-600 text-white hover:bg-rose-700 disabled:bg-rose-300',
  ghost: 'text-slate-700 hover:bg-slate-100 disabled:text-slate-400',
};

export function Button({ variant = 'primary', className = '', ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant }) {
  return (
    <button
      type="button"
      {...props}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold transition disabled:cursor-not-allowed ${variants[variant]} ${className}`}
    />
  );
}

export function Alert({ kind = 'error', children }: { kind?: 'error' | 'info' | 'success' | 'warning'; children: ReactNode }) {
  const styles = {
    error: 'border-rose-200 bg-rose-50 text-rose-800',
    info: 'border-sky-200 bg-sky-50 text-sky-800',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    warning: 'border-amber-200 bg-amber-50 text-amber-900',
  }[kind];
  return <div role={kind === 'error' ? 'alert' : 'status'} className={`rounded-lg border px-4 py-3 text-sm ${styles}`}>{children}</div>;
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    not_started: 'bg-slate-100 text-slate-700',
    in_progress: 'bg-amber-100 text-amber-800',
    submitted: 'bg-emerald-100 text-emerald-800',
    expired: 'bg-rose-100 text-rose-700 dark:text-rose-300',
    inactive: 'bg-slate-200 text-slate-600',
  };
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${map[status] ?? map.not_started}`}>
      {status.replace('_', ' ')}
    </span>
  );
}

export const inputClass =
  'w-full rounded-lg border border-slate-300 bg-surface px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100';

/** Light/dark switch. `onDark` styles it for the login page, whose backdrop is dark in both themes. */
export function ThemeToggle({ onDark = false, className = '' }: { onDark?: boolean; className?: string }) {
  const { theme, toggle } = useTheme();
  const label = theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
  return (
    <button
      type="button"
      onClick={toggle}
      title={label}
      aria-label={label}
      className={`inline-flex h-9 w-9 items-center justify-center rounded-lg transition ${
        onDark ? 'text-white/80 hover:bg-white/10' : 'text-slate-600 hover:bg-slate-100'
      } ${className}`}
    >
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {theme === 'dark' ? (
          <>
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
          </>
        ) : (
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
        )}
      </svg>
    </button>
  );
}
