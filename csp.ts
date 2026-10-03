import { loadEnv, type Plugin } from 'vite';

/**
 * Content-Security-Policy for the production build, delivered as a <meta> tag because GitHub Pages cannot set
 * response headers. It is defence in depth for the admin's session: the Supabase token lives in localStorage, so
 * an injected script must not be able to run or send data to an arbitrary host.
 *
 * What each directive allows, and why:
 *  - script-src 'self' 'wasm-unsafe-eval': our bundle only (no inline scripts, no eval). Excalidraw's image
 *    resizing (pica) instantiates WebAssembly.
 *  - connect-src: the configured Supabase project (not a wildcard, which would let injected code talk to an
 *    attacker's own project). Excalidraw's fonts are copied into the build (excalidrawFonts.ts), so no font CDN.
 *  - worker-src blob: data:: Excalidraw and its libraries start workers from blob:/data: URLs.
 *  - style-src 'unsafe-inline': React style props and CodeMirror/Excalidraw inject styles at runtime.
 *  - img-src data: blob:: diagram snapshots and pasted images are data URLs; nothing remote is fetched.
 *  - frame-src / object-src 'none': no embeds. (frame-ancestors cannot be set from a <meta> tag.)
 */
export function buildCsp(supabaseUrl?: string): string {
  let supabase = 'https://*.supabase.co'; // only when the URL is not configured (e.g. a build without secrets)
  try {
    if (supabaseUrl) supabase = new URL(supabaseUrl).origin;
  } catch {
    /* keep the fallback */
  }
  return [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self' ${supabase}`,
    "worker-src 'self' blob: data:",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
}

/** Injects the CSP meta tag into index.html for `vite build` only (it would break the dev server's HMR). */
export function cspPlugin(): Plugin {
  let csp = '';
  return {
    name: 'inject-csp',
    apply: 'build',
    configResolved(config) {
      const fromFile = loadEnv(config.mode, config.root, 'VITE_').VITE_SUPABASE_URL;
      csp = buildCsp(process.env.VITE_SUPABASE_URL ?? fromFile);
    },
    transformIndexHtml() {
      return [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: csp }, injectTo: 'head-prepend' }];
    },
  };
}
