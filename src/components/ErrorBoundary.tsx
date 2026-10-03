import { Component, type ErrorInfo, type ReactNode } from 'react';

interface State { error: Error | null }

/** Last line of defence: a render error shows a recovery screen instead of a blank page. */
export default class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled render error', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div role="alert" className="w-full max-w-md space-y-4 rounded-xl border border-slate-200 bg-surface p-6 shadow-sm">
          <h1 className="text-lg font-semibold">Something went wrong</h1>
          <p className="text-sm text-slate-600">
            The page hit an unexpected error. Answers that were already saved are safe, and any text not yet saved is kept
            in this browser and restored when you reload.
          </p>
          <p className="break-words rounded bg-slate-50 p-2 font-mono text-xs text-slate-500">{this.state.error.message}</p>
          <button
            type="button"
            className="rounded-lg bg-indigo-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
            onClick={() => window.location.reload()}
          >
            Reload page
          </button>
        </div>
      </div>
    );
  }
}
