import { afterEach, describe, expect, it, vi } from 'vitest';
import { safeStorage } from './safeStorage';

// Minimal localStorage stand-in (the vitest environment is node).
function stubStorage(impl: Partial<Storage>) {
  vi.stubGlobal('localStorage', impl);
}

afterEach(() => vi.unstubAllGlobals());

describe('safeStorage', () => {
  it('reads, writes and removes through localStorage', () => {
    const data = new Map<string, string>();
    stubStorage({
      getItem: (k) => data.get(k) ?? null,
      setItem: (k, v) => void data.set(k, v),
      removeItem: (k) => void data.delete(k),
    });
    expect(safeStorage.set('a', '1')).toBe(true);
    expect(safeStorage.get('a')).toBe('1');
    safeStorage.remove('a');
    expect(safeStorage.get('a')).toBeNull();
  });

  it('never throws when storage is blocked or full', () => {
    const boom = () => { throw new DOMException('blocked', 'SecurityError'); };
    stubStorage({ getItem: boom, setItem: boom, removeItem: boom });
    expect(safeStorage.get('a')).toBeNull();
    expect(safeStorage.set('a', '1')).toBe(false);
    expect(() => safeStorage.remove('a')).not.toThrow();
  });

  it('does not throw when localStorage itself is inaccessible', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(safeStorage.get('a')).toBeNull();
    expect(safeStorage.set('a', '1')).toBe(false);
  });
});
