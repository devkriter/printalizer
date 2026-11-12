import { defineConfig } from 'vite';
import type { Plugin } from 'vite';

/**
 * The built app only loads code from, and talks to, its own origin. Models are read in the page
 * and never sent anywhere. Not applied in development, where Vite needs inline scripts.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self'",
  "connect-src 'self'",
  "img-src 'self' data: blob:",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

const csp = (): Plugin => ({
  name: 'printalizer-csp',
  apply: 'build',
  transformIndexHtml: (html) => html.replace('<meta charset="utf-8">', `<meta charset="utf-8">\n<meta http-equiv="Content-Security-Policy" content="${CSP}">`),
});

export default defineConfig({
  root: import.meta.dirname,
  base: './',
  plugins: [csp()],
  server: { fs: { allow: ['..'] } },
  optimizeDeps: { exclude: ['manifold-3d'] },
  worker: { format: 'es' },
  build: { outDir: '../dist', emptyOutDir: true, target: 'es2022', chunkSizeWarningLimit: 1200 },
});
