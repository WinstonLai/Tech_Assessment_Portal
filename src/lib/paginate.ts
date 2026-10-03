/**
 * PostgREST returns at most 1000 rows per request (Supabase's default `max-rows`) and says nothing when it
 * truncates. Reading a whole table therefore has to page through it. `fetchPage` must use a deterministic
 * order (e.g. the primary key), otherwise rows can repeat or be skipped between pages.
 */
export const PAGE_SIZE = 1000;

type PageResult<T> = { data: T[] | null; error: unknown };

export async function fetchAllRows<T>(
  fetchPage: (from: number, to: number) => PromiseLike<PageResult<T>>,
  pageSize = PAGE_SIZE,
): Promise<{ data: T[]; error: unknown }> {
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await fetchPage(from, from + pageSize - 1);
    if (error) return { data: [], error };
    const page = data ?? [];
    rows.push(...page);
    if (page.length < pageSize) return { data: rows, error: null };
  }
}
