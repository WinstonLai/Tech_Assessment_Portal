import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import type { DiagramScene } from './types';
import { reviewElements, safeFiles } from './diagramScene';
import { configureExcalidrawAssets } from './excalidrawAssets';

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

/**
 * Renders a candidate's diagram to a PNG data URL from its scene, in the reviewer's browser. The stored
 * `diagram_png` column is written by the candidate's browser independently of `diagram_scene`, so showing or
 * exporting it would let a candidate present an image that was never drawn in the tool. Excalidraw is imported
 * dynamically (it is ~1 MB and already its own chunk). Returns null if the scene cannot be rendered.
 */
export async function renderSceneToPng(scene: DiagramScene): Promise<string | null> {
  try {
    const elements = reviewElements(scene).filter((el) => !el.isDeleted) as unknown as ExcalidrawElement[];
    if (!elements.length) return null;
    configureExcalidrawAssets();
    const { exportToBlob } = await import('@excalidraw/excalidraw');
    const blob = await exportToBlob({
      elements,
      files: safeFiles(scene.files),
      appState: { exportBackground: true, viewBackgroundColor: '#ffffff' },
      mimeType: 'image/png',
      exportPadding: 24,
      maxWidthOrHeight: 1800,
    });
    return await blobToDataUrl(blob);
  } catch {
    return null;
  }
}
