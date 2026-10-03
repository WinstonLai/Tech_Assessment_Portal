import { describe, expect, it } from 'vitest';
import { safePngDataUrl } from './markdown';

describe('safePngDataUrl', () => {
  it('accepts an inline PNG data URL', () => {
    const url = 'data:image/png;base64,iVBORw0KGgo=';
    expect(safePngDataUrl(url)).toBe(url);
  });

  it('rejects remote URLs, other schemes and other media types', () => {
    expect(safePngDataUrl('https://evil.example/pixel.png')).toBeNull();
    expect(safePngDataUrl('javascript:alert(1)')).toBeNull();
    expect(safePngDataUrl('data:image/svg+xml;base64,PHN2Zz4=')).toBeNull();
    expect(safePngDataUrl('data:image/png;base64,AAAA" onerror="x')).toBeNull();
  });

  it('handles empty values', () => {
    expect(safePngDataUrl(null)).toBeNull();
    expect(safePngDataUrl(undefined)).toBeNull();
    expect(safePngDataUrl('')).toBeNull();
  });
});
