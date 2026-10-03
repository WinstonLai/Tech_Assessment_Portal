import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from './supabase';
import type { Candidate } from './types';

export const IDLE_LIMIT_MS = 5 * 60 * 1000; // pause after 5 min without keyboard/mouse activity
const HEARTBEAT_MS = 30 * 1000;             // server accepts gaps up to 90 s
const TICK_MS = 1000;
const RETRY_AFTER_FAILURE_MS = 5 * 1000;   // activity events must not hammer a failing heartbeat endpoint

const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart', 'pointerdown', 'scroll'] as const;

/**
 * Tracks *active* time. The server is authoritative (heartbeat / pause_timer RPCs); the
 * client only decides whether the candidate is currently active (tab visible + recent input).
 */
export function useActiveTimer(opts: {
  enabled: boolean;
  initialSeconds: number;
  onCandidate?: (c: Candidate) => void;
  onExpired?: () => void;
}) {
  const { enabled, initialSeconds } = opts;
  const [serverSeconds, setServerSeconds] = useState(initialSeconds);
  const [syncedAt, setSyncedAt] = useState(() => Date.now());
  const [running, setRunning] = useState(false);
  const [, force] = useState(0);

  const runningRef = useRef(false);
  const lastActivity = useRef(Date.now());
  const lastBeat = useRef(0);
  const lastFailure = useRef(0);
  const inFlight = useRef(false);
  const cbRef = useRef(opts);
  cbRef.current = opts;

  const apply = useCallback((c: Candidate) => {
    setServerSeconds(c.active_seconds);
    setSyncedAt(Date.now());
    cbRef.current.onCandidate?.(c);
  }, []);

  const call = useCallback(async (fn: 'heartbeat' | 'pause_timer') => {
    const { data, error } = await supabase.rpc(fn);
    if (error) {
      if (/ACCESS_EXPIRED/.test(error.message)) cbRef.current.onExpired?.();
      return null;
    }
    const c = (Array.isArray(data) ? data[0] : data) as Candidate | null;
    if (c) apply(c);
    return c;
  }, [apply]);

  const beat = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      lastBeat.current = Date.now();
      const c = await call('heartbeat');
      if (!c) lastFailure.current = Date.now();
      runningRef.current = Boolean(c);
      setRunning(Boolean(c));
    } finally {
      inFlight.current = false;
    }
  }, [call]);

  const pause = useCallback(async () => {
    if (!runningRef.current) return;
    runningRef.current = false;
    setRunning(false);
    await call('pause_timer');
  }, [call]);

  useEffect(() => {
    if (!enabled) return;
    const onActivity = () => {
      lastActivity.current = Date.now();
      // While not running, every input event would otherwise start a heartbeat as soon as the previous one
      // failed (offline, 5xx, rate limit). After a failure wait before trying again.
      if (!runningRef.current && document.visibilityState === 'visible' && Date.now() - lastFailure.current >= RETRY_AFTER_FAILURE_MS) {
        void beat();
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') void pause();
      else onActivity();
    };
    const onPageHide = () => void pause();

    ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, onActivity, { capture: true, passive: true }));
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);

    // initial start
    if (document.visibilityState === 'visible') void beat();

    const interval = window.setInterval(() => {
      const now = Date.now();
      const shouldRun = document.visibilityState === 'visible' && now - lastActivity.current < IDLE_LIMIT_MS;
      if (runningRef.current && !shouldRun) void pause();
      else if (runningRef.current && now - lastBeat.current >= HEARTBEAT_MS) void beat();
      force((n) => n + 1);
    }, TICK_MS);

    return () => {
      ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, onActivity, { capture: true }));
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      window.clearInterval(interval);
      void pause();
    };
  }, [enabled, beat, pause]);

  const seconds = serverSeconds + (running ? Math.floor((Date.now() - syncedAt) / 1000) : 0);
  return { seconds, running, pause };
}
