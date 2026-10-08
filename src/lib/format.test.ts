import { describe, expect, it } from 'vitest';
import { accessDays, daysPhrase, elapsedSeconds, formatDateTimeSgt, formatDeadlineSgt } from './format';

describe('Singapore-time formatting', () => {
  // 09:32 UTC = 17:32 SGT, a Thursday
  const iso = '2026-10-08T09:32:00Z';

  it('labels the expiry as SGT regardless of machine timezone', () => {
    expect(formatDateTimeSgt(iso)).toBe('Oct 08, 2026, 05:32 PM SGT');
  });

  it('writes the deadline with weekday and ordinal day', () => {
    expect(formatDeadlineSgt(iso)).toBe('Thursday, 8th October 2026, 05:32 PM');
  });

  it('shows a dash for an invalid date instead of throwing', () => {
    expect(formatDateTimeSgt('not a date')).toBe('—');
    expect(formatDeadlineSgt('not a date')).toBe('—');
  });

  it('rolls over to the next Singapore day', () => {
    expect(formatDeadlineSgt('2026-10-01T17:00:00Z')).toBe('Friday, 2nd October 2026, 01:00 AM');
  });

  it.each([
    ['2026-10-01T04:00:00Z', '1st'], ['2026-10-02T04:00:00Z', '2nd'], ['2026-10-03T04:00:00Z', '3rd'],
    ['2026-10-11T04:00:00Z', '11th'], ['2026-10-12T04:00:00Z', '12th'], ['2026-10-13T04:00:00Z', '13th'],
    ['2026-10-21T04:00:00Z', '21st'], ['2026-10-22T04:00:00Z', '22nd'], ['2026-10-23T04:00:00Z', '23rd'],
  ])('uses the right ordinal for %s', (when, ord) => {
    expect(formatDeadlineSgt(when)).toContain(`, ${ord} October`);
  });
});

describe('accessDays / daysPhrase', () => {
  const now = new Date('2026-10-05T09:32:00Z').getTime();

  it('counts whole days to expiry, to the nearest day', () => {
    expect(accessDays('2026-10-08T09:32:00Z', now)).toBe(3);
    expect(accessDays('2026-10-08T09:32:00Z', now + 5000)).toBe(3); // a few seconds after creation
    expect(accessDays('2026-10-08T09:37:00Z', now)).toBe(3); // 3 days 5 minutes: not "four days"
    expect(accessDays('2026-10-07T14:00:00Z', now)).toBe(2);
  });

  it('is at least 1 even when already expired', () => {
    expect(accessDays('2026-10-01T00:00:00Z', now)).toBe(1);
  });

  it('spells out small numbers and singularises one', () => {
    expect(daysPhrase(1)).toBe('one day');
    expect(daysPhrase(3)).toBe('three days');
    expect(daysPhrase(10)).toBe('ten days');
    expect(daysPhrase(14)).toBe('14 days');
  });
});

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
