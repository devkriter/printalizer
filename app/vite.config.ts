import { defineConfig } from 'vite';

export default defineConfig({
  root: import.meta.dirname,
  base: './',
  server: { fs: { allow: ['..'] } },
  optimizeDeps: { exclude: ['manifold-3d'] },
  worker: { format: 'es' },
  build: { outDir: '../dist', emptyOutDir: true, target: 'es2022' },
});
