import { describe, expect, it } from 'vitest';
import { csvCell } from './csv';

describe('csvCell', () => {
  it('quotes and escapes embedded quotes', () => {
    expect(csvCell('Tan, "Ann"')).toBe('"Tan, ""Ann"""');
  });

  it('renders null and undefined as empty', () => {
    expect(csvCell(null)).toBe('""');
    expect(csvCell(undefined)).toBe('""');
  });

  it('neutralises spreadsheet formulas in text', () => {
    expect(csvCell('=HYPERLINK("http://evil","x")')).toBe(`"'=HYPERLINK(""http://evil"",""x"")"`);
    expect(csvCell('+1+1')).toBe(`"'+1+1"`);
    expect(csvCell('-2+3')).toBe(`"'-2+3"`);
    expect(csvCell('@SUM(A1)')).toBe(`"'@SUM(A1)"`);
    expect(csvCell('\t=1')).toBe(`"'\t=1"`);
  });

  it('leaves numbers, dates and ordinary text alone', () => {
    expect(csvCell(-3.5)).toBe('"-3.5"');
    expect(csvCell(0)).toBe('"0"');
    expect(csvCell('2026-10-03T08:00:00Z')).toBe('"2026-10-03T08:00:00Z"');
    expect(csvCell('ann@example.com')).toBe('"ann@example.com"');
  });
});
