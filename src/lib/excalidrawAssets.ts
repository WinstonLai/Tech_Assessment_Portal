/**
 * Makes Excalidraw load its fonts from this site (see excalidrawFonts.ts) instead of esm.sh. Production only: the
 * dev server does not serve the copied files, so it keeps Excalidraw's default. Idempotent; call it before the
 * first Excalidraw render or export.
 */
export function configureExcalidrawAssets(): void {
  if (!import.meta.env.PROD) return;
  const w = window as unknown as { EXCALIDRAW_ASSET_PATH?: string };
  // Resolved against the page URL, so it works from any GitHub Pages sub-path (the build uses base './').
  w.EXCALIDRAW_ASSET_PATH ??= new URL('excalidraw-assets/', document.baseURI).href;
}
