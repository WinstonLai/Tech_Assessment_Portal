// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Candidate } from './types';

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('./supabase', () => ({ supabase: { rpc } }));

import { IDLE_LIMIT_MS, useActiveTimer } from './useActiveTimer';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const candidate = (active_seconds: number) => ({ id: 'c1', active_seconds, status: 'in_progress' }) as Candidate;
const ok = (active_seconds: number) => ({ data: candidate(active_seconds), error: null });
const fail = (message = 'network down') => ({ data: null, error: { message } });

/** rpc stub: heartbeat reports `heartbeat` seconds, pause_timer reports `pause` seconds. */
function serverReturns(heartbeat = 120, pause = heartbeat) {
  rpc.mockImplementation(async (fn: string) => ok(fn === 'pause_timer' ? pause : heartbeat));
}
const calls = () => rpc.mock.calls.map((c) => c[0] as string);

let visibility: 'visible' | 'hidden' = 'visible';
Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });

let root: Root | null = null;
let latest: ReturnType<typeof useActiveTimer>;

function mount(opts: Partial<Parameters<typeof useActiveTimer>[0]> = {}) {
  const props = { enabled: true, initialSeconds: 0, ...opts };
  function Probe() {
    latest = useActiveTimer(props);
    return null;
  }
  root = createRoot(document.createElement('div'));
  act(() => root!.render(createElement(Probe)));
}

function unmount() {
  act(() => root?.unmount());
  root = null;
}

async function advance(ms: number) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

async function setVisibility(v: 'visible' | 'hidden') {
  visibility = v;
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')); await vi.advanceTimersByTimeAsync(0); });
}

async function input(type = 'mousemove') {
  await act(async () => { window.dispatchEvent(new Event(type)); await vi.advanceTimersByTimeAsync(0); });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-03T08:00:00Z'));
  visibility = 'visible';
  rpc.mockReset();
});

afterEach(() => {
  unmount();
  vi.useRealTimers();
});

describe('useActiveTimer', () => {
  it('sends a heartbeat on mount and reports the server time', async () => {
    serverReturns(120);
    mount();
    await advance(0);
    expect(calls()).toEqual(['heartbeat']);
    expect(latest.running).toBe(true);
    expect(latest.seconds).toBe(120);
  });

  it('counts up locally between heartbeats', async () => {
    serverReturns(120);
    mount();
    await advance(10_000);
    expect(latest.seconds).toBe(130);
  });

  it('accepts the candidate row returned as a one-element array', async () => {
    rpc.mockResolvedValue({ data: [candidate(77)], error: null });
    const onCandidate = vi.fn();
    mount({ onCandidate });
    await advance(0);
    expect(latest.seconds).toBe(77);
    expect(onCandidate).toHaveBeenCalledWith(expect.objectContaining({ active_seconds: 77 }));
  });

  it('does nothing when disabled', async () => {
    serverReturns();
    mount({ enabled: false });
    await advance(60_000);
    unmount();
    expect(rpc).not.toHaveBeenCalled();
    expect(latest.running).toBe(false);
  });

  describe('heartbeat cadence', () => {
    it('beats about every 30 s while the candidate is active', async () => {
      serverReturns();
      mount();
      await advance(29_000);
      expect(calls()).toEqual(['heartbeat']);
      await advance(2_000);
      expect(calls()).toEqual(['heartbeat', 'heartbeat']);
      await advance(30_000);
      expect(calls()).toHaveLength(3);
    });
  });

  describe('visibility', () => {
    it('pauses when the tab is hidden and resumes when it is visible again', async () => {
      serverReturns(120, 135);
      mount();
      await advance(0);

      await setVisibility('hidden');
      expect(calls()).toEqual(['heartbeat', 'pause_timer']);
      expect(latest.running).toBe(false);
      expect(latest.seconds).toBe(135); // the banked time from pause_timer

      await advance(10_000); // paused: the display must not keep counting
      expect(latest.seconds).toBe(135);

      await setVisibility('visible');
      expect(calls()).toEqual(['heartbeat', 'pause_timer', 'heartbeat']);
      expect(latest.running).toBe(true);
    });

    it('does not start while the tab is hidden', async () => {
      serverReturns();
      visibility = 'hidden';
      mount();
      await advance(60_000);
      expect(rpc).not.toHaveBeenCalled();
      expect(latest.running).toBe(false);
    });
  });

  describe('idle detection', () => {
    it('pauses after 5 minutes without input, and resumes on the next input', async () => {
      serverReturns();
      mount();
      await advance(IDLE_LIMIT_MS - 2_000);
      expect(latest.running).toBe(true);
      expect(calls()).not.toContain('pause_timer');

      await advance(4_000);
      expect(calls().at(-1)).toBe('pause_timer');
      expect(latest.running).toBe(false);

      const before = calls().length;
      await input('keydown');
      expect(calls().length).toBe(before + 1);
      expect(calls().at(-1)).toBe('heartbeat');
      expect(latest.running).toBe(true);
    });

    it('keeps running past 5 minutes while the candidate keeps using the page', async () => {
      serverReturns();
      mount();
      for (let i = 0; i < 7; i++) {
        await advance(60_000);
        await input();
      }
      expect(calls()).not.toContain('pause_timer');
      expect(latest.running).toBe(true);
    });
  });

  describe('failures', () => {
    it('does not run, and does not send pause_timer, when the heartbeat fails', async () => {
      rpc.mockResolvedValue(fail());
      mount();
      await advance(0);
      expect(latest.running).toBe(false);

      await setVisibility('hidden');
      expect(calls()).toEqual(['heartbeat']); // nothing to pause
    });

    it('does not hammer a failing endpoint on every input event', async () => {
      rpc.mockResolvedValue(fail());
      mount();
      await advance(0);
      expect(rpc).toHaveBeenCalledTimes(1);

      for (let i = 0; i < 20; i++) await input(); // a burst of mouse moves right after the failure
      expect(rpc).toHaveBeenCalledTimes(1);

      await advance(5_000);
      await input();
      expect(rpc).toHaveBeenCalledTimes(2); // retried once the back-off has passed
    });

    it('recovers when the endpoint comes back', async () => {
      rpc.mockResolvedValueOnce(fail());
      serverReturns(200);
      mount();
      await advance(6_000);
      await input();
      expect(latest.running).toBe(true);
      expect(latest.seconds).toBe(200);
    });

    it('calls onExpired when access has ended', async () => {
      rpc.mockResolvedValue(fail('ACCESS_EXPIRED'));
      const onExpired = vi.fn();
      mount({ onExpired });
      await advance(0);
      expect(onExpired).toHaveBeenCalledTimes(1);
      expect(latest.running).toBe(false);
    });

    it('does not call onExpired for ordinary errors', async () => {
      rpc.mockResolvedValue(fail('fetch failed'));
      const onExpired = vi.fn();
      mount({ onExpired });
      await advance(0);
      expect(onExpired).not.toHaveBeenCalled();
    });
  });

  describe('unmount', () => {
    it('banks the time with pause_timer when leaving the page while running', async () => {
      serverReturns();
      mount();
      await advance(0);
      unmount();
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(calls()).toEqual(['heartbeat', 'pause_timer']);
    });

    it('stops its listeners and timers', async () => {
      serverReturns();
      mount();
      await advance(0);
      unmount();
      await advance(0);
      const after = rpc.mock.calls.length;
      await advance(120_000);
      await input();
      expect(rpc.mock.calls.length).toBe(after);
    });
  });
});
