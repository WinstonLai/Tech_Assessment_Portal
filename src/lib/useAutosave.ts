import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage, supabase } from './supabase';
import type { AnswerPatch } from './types';

export type SaveStatus = 'idle' | 'unsaved' | 'saving' | 'saved' | 'error';

const DEBOUNCE_MS = 1500;
const RETRY_MS = 5000;
const storageKey = (uid: string) => `wt-pending-answers-${uid}`;

type Pending = Record<string, AnswerPatch>;

function readPending(uid: string): Pending {
  try {
    return JSON.parse(localStorage.getItem(storageKey(uid)) ?? '{}') as Pending;
  } catch {
    return {};
  }
}

function writePending(uid: string, p: Pending) {
  try {
    if (Object.keys(p).length) localStorage.setItem(storageKey(uid), JSON.stringify(p));
    else localStorage.removeItem(storageKey(uid));
  } catch {
    /* storage full / private mode: server save still works */
  }
}

/**
 * Debounced per-question autosave. Unsaved patches are mirrored to localStorage so nothing is
 * lost if the network drops or the tab closes; they are re-applied on the next load.
 */
export function useAutosave(candidateId: string) {
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [lastError, setLastError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const pending = useRef<Pending>(readPending(candidateId));
  const timer = useRef<number | undefined>(undefined);
  const saving = useRef<Promise<void> | null>(null);

  const doSave = useCallback(async () => {
    const batch = pending.current;
    if (!Object.keys(batch).length) return;
    pending.current = {};
    setStatus('saving');
    const failed: Pending = {};
    let firstError: string | null = null;
    for (const [questionId, patch] of Object.entries(batch)) {
      // One row per request: a bulk upsert would null out columns absent from other rows.
      const { error } = await supabase.from('answers').upsert(
        { candidate_id: candidateId, question_id: questionId, ...patch, updated_at: new Date().toISOString() },
        { onConflict: 'candidate_id,question_id' },
      );
      if (error) {
        failed[questionId] = patch;
        firstError ??= await errorMessage(error);
      }
    }
    if (Object.keys(failed).length) {
      // Keep newer edits on top of the failed ones.
      for (const [q, patch] of Object.entries(failed)) pending.current[q] = { ...patch, ...pending.current[q] };
      writePending(candidateId, pending.current);
      setStatus('error');
      setLastError(firstError);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void flush(), RETRY_MS);
    } else {
      writePending(candidateId, pending.current);
      setLastError(null);
      setSavedAt(new Date());
      setStatus(Object.keys(pending.current).length ? 'unsaved' : 'saved');
    }
  }, [candidateId]);

  const flush = useCallback(async (): Promise<boolean> => {
    window.clearTimeout(timer.current);
    while (saving.current) await saving.current;
    if (Object.keys(pending.current).length) {
      saving.current = doSave().finally(() => (saving.current = null));
      await saving.current;
    }
    return Object.keys(pending.current).length === 0;
  }, [doSave]);

  const queue = useCallback((questionId: string, patch: AnswerPatch) => {
    pending.current[questionId] = { ...pending.current[questionId], ...patch };
    writePending(candidateId, pending.current);
    setStatus('unsaved');
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void flush(), DEBOUNCE_MS);
  }, [candidateId, flush]);

  /** Patches left over from a previous session that never reached the server. */
  const takeRecovered = useCallback(() => ({ ...pending.current }), []);

  useEffect(() => {
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (Object.keys(pending.current).length) {
        void flush();
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      window.clearTimeout(timer.current);
    };
  }, [flush]);

  return { status, lastError, savedAt, queue, flush, takeRecovered };
}
