import { describe, expect, it } from 'vitest';
import { friendlySaveError, isPermanentSaveError, splitPatch } from './saveErrors';

describe('isPermanentSaveError', () => {
  it('treats CHECK/integrity, data and privilege errors as permanent', () => {
    expect(isPermanentSaveError({ code: '23514' })).toBe(true); // check_violation (size limits)
    expect(isPermanentSaveError({ code: '22001' })).toBe(true); // string data right truncation
    expect(isPermanentSaveError({ code: '42501' })).toBe(true); // RLS / insufficient privilege
  });

  it('keeps network, server and token errors retryable', () => {
    expect(isPermanentSaveError({ code: '' })).toBe(false); // fetch failure
    expect(isPermanentSaveError({ code: 'PGRST301' })).toBe(false); // JWT expired, refreshed by supabase-js
    expect(isPermanentSaveError({ code: '57014' })).toBe(false); // statement timeout
    expect(isPermanentSaveError(null)).toBe(false);
    expect(isPermanentSaveError(undefined)).toBe(false);
  });
});

describe('friendlySaveError', () => {
  it('explains size-limit violations', () => {
    const msg = 'new row for relation "answers" violates check constraint "answers_size_limits"';
    expect(friendlySaveError(msg)).toMatch(/too large/);
  });

  it('explains RLS rejections and passes other messages through', () => {
    expect(friendlySaveError('new row violates row-level security policy for table "answers"')).toMatch(/access/);
    expect(friendlySaveError('something else')).toBe('something else');
  });
});

describe('splitPatch', () => {
  it('separates diagram fields from text/code fields', () => {
    const parts = splitPatch({ rich_text_plain: 'hi', code: 'select 1', diagram_scene: { elements: [] }, diagram_png: null });
    expect(parts).toEqual([
      { group: 'content', patch: { rich_text_plain: 'hi', code: 'select 1' } },
      { group: 'diagram', patch: { diagram_scene: { elements: [] }, diagram_png: null } },
    ]);
  });

  it('omits empty groups', () => {
    expect(splitPatch({ code: 'x' }).map((p) => p.group)).toEqual(['content']);
    expect(splitPatch({ diagram_png: null }).map((p) => p.group)).toEqual(['diagram']);
    expect(splitPatch({})).toEqual([]);
  });
});
