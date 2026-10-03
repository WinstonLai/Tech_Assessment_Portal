import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { Plugin } from 'vite';

/**
 * Copies Excalidraw's fonts into the production build (under `excalidraw-assets/fonts/`). By default Excalidraw
 * downloads them from esm.sh at runtime, which sends every candidate's IP to a third party, needs that host in
 * the CSP, and leaves diagrams in fallback fonts on networks that block it. `src/lib/excalidrawAssets.ts` points
 * `window.EXCALIDRAW_ASSET_PATH` at the copy.
 */
export function excalidrawFontsPlugin(): Plugin {
  let root = process.cwd();
  return {
    name: 'excalidraw-fonts',
    apply: 'build',
    configResolved(config) {
      root = config.root;
    },
    generateBundle() {
      const fonts = join(root, 'node_modules/@excalidraw/excalidraw/dist/prod/fonts');
      const walk = (dir: string): string[] =>
        readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
      for (const file of walk(fonts)) {
        if (!file.endsWith('.woff2')) continue;
        this.emitFile({
          type: 'asset',
          fileName: `excalidraw-assets/fonts/${relative(fonts, file).split(sep).join('/')}`,
          source: readFileSync(file),
        });
      }
    },
  };
}
