import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage, supabase } from './supabase';
import type { AnswerPatch } from './types';
import { safeStorage } from './safeStorage';
import { friendlySaveError, isPermanentSaveError, splitPatch } from './saveErrors';

export type SaveStatus = 'idle' | 'unsaved' | 'saving' | 'saved' | 'error';

const DEBOUNCE_MS = 1500;
const RETRY_MS = 5000;
const storageKey = (uid: string) => `wt-pending-answers-${uid}`;

type Pending = Record<string, AnswerPatch>;

/** An answer the server rejected for a reason retrying cannot fix (e.g. too large). */
export interface BlockedSave { questionId: string; message: string }

function readPending(uid: string): Pending {
  try {
    return JSON.parse(safeStorage.get(storageKey(uid)) ?? '{}') as Pending;
  } catch {
    return {}; // corrupt JSON
  }
}

function writePending(uid: string, p: Pending) {
  // Storage full / blocked: the server save still works, so this stays best-effort.
  if (Object.keys(p).length) safeStorage.set(storageKey(uid), JSON.stringify(p));
  else safeStorage.remove(storageKey(uid));
}

/**
 * Debounced per-question autosave. Unsaved patches are mirrored to localStorage so nothing is
 * lost if the network drops or the tab closes; they are re-applied on the next load.
 */
export function useAutosave(candidateId: string) {
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [lastError, setLastError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [blocked, setBlocked] = useState<BlockedSave[]>([]);
  const pending = useRef<Pending>({});
  const loaded = useRef(false);
  if (!loaded.current) { // once, not on every render (the stored JSON can be megabytes)
    loaded.current = true;
    pending.current = readPending(candidateId);
  }
  const blockedRef = useRef<Record<string, BlockedSave>>({});
  const timer = useRef<number | undefined>(undefined);
  const saving = useRef<Promise<void> | null>(null);

  const syncBlocked = () => setBlocked(Object.values(blockedRef.current));

  const doSave = useCallback(async () => {
    const batch = pending.current;
    if (!Object.keys(batch).length) return;
    pending.current = {};
    setStatus('saving');
    const failed: Pending = {}; // transient failures: retried
    let firstError: string | null = null;
    for (const [questionId, patch] of Object.entries(batch)) {
      // One row per request: a bulk upsert would null out columns absent from other rows. Diagram and
      // text/code fields are separate requests so one oversized diagram cannot block the question's text.
      for (const part of splitPatch(patch)) {
        const { error } = await supabase.from('answers').upsert(
          { candidate_id: candidateId, question_id: questionId, ...part.patch, updated_at: new Date().toISOString() },
          { onConflict: 'candidate_id,question_id' },
        );
        const key = `${questionId}:${part.group}`;
        if (!error) {
          delete blockedRef.current[key];
          continue;
        }
        const message = await errorMessage(error);
        firstError ??= message;
        if (isPermanentSaveError(error)) {
          // Retrying cannot help (too large, or no longer allowed to write). Report it instead of looping;
          // the next edit to this field is queued afresh and tried again.
          blockedRef.current[key] = { questionId, message: friendlySaveError(message) };
        } else {
          failed[questionId] = { ...failed[questionId], ...part.patch };
        }
      }
    }
    syncBlocked();
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
      const hasBlocked = Object.keys(blockedRef.current).length > 0;
      setLastError(hasBlocked ? firstError : null);
      if (!hasBlocked) setSavedAt(new Date());
      setStatus(hasBlocked ? 'error' : Object.keys(pending.current).length ? 'unsaved' : 'saved');
    }
  }, [candidateId]);

  /** Resolves true only when everything is stored: nothing pending and nothing rejected. */
  const flush = useCallback(async (): Promise<boolean> => {
    window.clearTimeout(timer.current);
    while (saving.current) await saving.current;
    if (Object.keys(pending.current).length) {
      saving.current = doSave().finally(() => (saving.current = null));
      await saving.current;
    }
    return Object.keys(pending.current).length === 0 && Object.keys(blockedRef.current).length === 0;
  }, [doSave]);

  const queue = useCallback((questionId: string, patch: AnswerPatch) => {
    // A new edit supersedes a rejected one for the same fields; it is retried with this patch.
    for (const part of splitPatch(patch)) delete blockedRef.current[`${questionId}:${part.group}`];
    syncBlocked();
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

  return { status, lastError, savedAt, blocked, queue, flush, takeRecovered };
}
