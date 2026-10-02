import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// base './' + HashRouter lets the build run from any GitHub Pages sub-path.
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  define: { 'process.env.IS_PREACT': JSON.stringify('false') },
  build: { chunkSizeWarningLimit: 4000 },
});
