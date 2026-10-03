/**
 * Lets pages wait for the diagram editor's own debounced save (scene change -> PNG export -> autosave queue)
 * before they flush autosave, e.g. on "Save & exit" or submit. Kept separate from DiagramEditor so importing
 * it does not pull the ~1 MB Excalidraw chunk into the main bundle.
 */
const inflight = new Set<Promise<void>>();
let activeFlush: (() => Promise<void>) | null = null;

export function trackDiagramSave(p: Promise<void>): Promise<void> {
  inflight.add(p);
  void p.finally(() => inflight.delete(p));
  return p;
}

export function registerDiagramFlush(fn: (() => Promise<void>) | null) {
  activeFlush = fn;
}

/** Emit any debounced diagram change now and wait for every in-flight diagram save to reach autosave. */
export async function flushDiagramSaves(): Promise<void> {
  await activeFlush?.();
  await Promise.allSettled([...inflight]);
}
