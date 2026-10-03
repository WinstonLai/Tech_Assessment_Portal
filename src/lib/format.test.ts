import { describe, expect, it } from 'vitest';
import { elapsedSeconds } from './format';

describe('elapsedSeconds', () => {
  const start = '2026-10-03T08:00:00.000Z';

  it('is null before the candidate has started', () => {
    expect(elapsedSeconds(null, null)).toBeNull();
    expect(elapsedSeconds(null, start)).toBeNull();
  });

  it('measures start to submission', () => {
    expect(elapsedSeconds(start, '2026-10-03T09:30:15.900Z')).toBe(5415);
  });

  it('measures start to now while in progress', () => {
    expect(elapsedSeconds(start, null, new Date('2026-10-03T08:10:00Z').getTime())).toBe(600);
  });

  it('never goes negative', () => {
    expect(elapsedSeconds(start, '2026-10-03T07:00:00Z')).toBe(0);
  });
});
