import { describe, expect, it } from 'vitest';
import { shouldApplyRecovered } from './recovery';

const at = (iso: string) => Date.parse(iso);

describe('shouldApplyRecovered', () => {
  it('applies when the server has no copy', () => {
    expect(shouldApplyRecovered(undefined, at('2026-10-03T08:00:00Z'))).toBe(true);
    expect(shouldApplyRecovered(null, at('2026-10-03T08:00:00Z'))).toBe(true);
  });

  it('applies when the local edit is newer than the server copy', () => {
    expect(shouldApplyRecovered('2026-10-03T07:59:00Z', at('2026-10-03T08:00:00Z'))).toBe(true);
  });

  it('skips when the server copy was saved after the local edit', () => {
    expect(shouldApplyRecovered('2026-10-03T08:05:00Z', at('2026-10-03T08:00:00Z'))).toBe(false);
  });

  it('applies on an equal timestamp, since the server copy is not newer', () => {
    expect(shouldApplyRecovered('2026-10-03T08:00:00Z', at('2026-10-03T08:00:00Z'))).toBe(true);
  });

  it('applies when the local timestamp is unknown or the server one is unparseable', () => {
    expect(shouldApplyRecovered('2026-10-03T08:05:00Z', null)).toBe(true);
    expect(shouldApplyRecovered('not a date', at('2026-10-03T08:00:00Z'))).toBe(true);
  });
});
