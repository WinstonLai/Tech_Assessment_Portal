import type { BinaryFiles } from '@excalidraw/excalidraw/types';
import type { DiagramScene } from './types';

/**
 * Scenes are candidate-controlled and opened in the admin's browser. Keep only embedded images that are
 * inline raster data URLs, so a `dataURL` pointing at a remote host is never fetched.
 */
export function safeFiles(files: DiagramScene['files']): BinaryFiles {
  const out: Record<string, unknown> = {};
  for (const [id, f] of Object.entries(files ?? {})) {
    const url = (f as { dataURL?: unknown } | null)?.dataURL;
    if (typeof url === 'string' && /^data:image\/(png|jpeg|gif|webp);base64,/.test(url)) out[id] = f;
  }
  return out as BinaryFiles;
}

/**
 * Elements of a scene a reviewer is about to open. Drops anything that is not an object and removes `link`,
 * so a hyperlink planted on an element cannot be clicked from the admin's session. Excalidraw sanitises link
 * URLs itself and the CSP limits what a link could do; this removes the clickable target altogether.
 */
export function reviewElements(scene: DiagramScene | null | undefined): Record<string, unknown>[] {
  const elements = scene?.elements;
  if (!Array.isArray(elements)) return [];
  return elements
    .filter((el): el is Record<string, unknown> => !!el && typeof el === 'object')
    .map((el) => (el.link ? { ...el, link: null } : el));
}
