import { defineConfig } from 'vite';

// Serves phase0/ so the viewer can read corpus/ and out/ next to it.
export default defineConfig({
  root: import.meta.dirname,
  server: { fs: { allow: ['..'] } },
  optimizeDeps: { exclude: ['manifold-3d'] },
});
