/**
 * Decides whether an unsynced local edit from an earlier session should be re-applied over what the server
 * holds. The server row's `updated_at` is stamped by the server (migration 004); the local edit's timestamp is the
 * browser clock, so a badly wrong device clock can still mis-order the two. If the server copy is newer (the answer was saved after the local edit, e.g. from
 * another device) the stale local edit must not overwrite it.
 *
 * An unknown local timestamp (older stored data) keeps the previous behaviour: apply it.
 */
export function shouldApplyRecovered(serverUpdatedAt: string | null | undefined, localEditedAt: number | null): boolean {
  if (!serverUpdatedAt || localEditedAt == null) return true;
  const server = Date.parse(serverUpdatedAt);
  if (Number.isNaN(server)) return true;
  return server <= localEditedAt;
}
