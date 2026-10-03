import { describe, expect, it } from 'vitest';
import { fetchAllRows } from './paginate';

/** A fake table that, like PostgREST, serves at most `pageSize` rows per range request. */
function table(n: number) {
  const all = Array.from({ length: n }, (_, i) => ({ id: i }));
  const calls: [number, number][] = [];
  const fetchPage = async (from: number, to: number) => {
    calls.push([from, to]);
    return { data: all.slice(from, to + 1), error: null };
  };
  return { all, calls, fetchPage };
}

describe('fetchAllRows', () => {
  it('returns every row when the table is larger than one page', async () => {
    const t = table(2503);
    const { data, error } = await fetchAllRows(t.fetchPage, 1000);
    expect(error).toBeNull();
    expect(data).toEqual(t.all);
    expect(t.calls).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  it('stops after one request when the table is smaller than a page', async () => {
    const t = table(5);
    const { data } = await fetchAllRows(t.fetchPage, 1000);
    expect(data).toHaveLength(5);
    expect(t.calls).toHaveLength(1);
  });

  it('makes one extra request when the row count is an exact multiple of the page size', async () => {
    const t = table(2000);
    const { data } = await fetchAllRows(t.fetchPage, 1000);
    expect(data).toHaveLength(2000);
    expect(t.calls).toHaveLength(3);
  });

  it('handles an empty table', async () => {
    const { data, error } = await fetchAllRows(async () => ({ data: null, error: null }));
    expect(data).toEqual([]);
    expect(error).toBeNull();
  });

  it('returns the error and no partial data when a page fails', async () => {
    let n = 0;
    const boom = new Error('network');
    const { data, error } = await fetchAllRows(async () => (
      ++n === 1 ? { data: Array.from({ length: 1000 }, (_, i) => i), error: null } : { data: null, error: boom }
    ));
    expect(error).toBe(boom);
    expect(data).toEqual([]);
  });
});
