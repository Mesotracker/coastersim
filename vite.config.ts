import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig(() => ({
  base: './',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, '.'),
    },
  },
  optimizeDeps: {
    // The generated coaster-forge.html is already bundled and must not be
    // treated as a second development entry point.
    entries: ['index.html'],
  },
  build: {
    chunkSizeWarningLimit: 1200,
  },
  server: {
    host: '0.0.0.0',
    allowedHosts: true as const,
    hmr: process.env.DISABLE_HMR !== 'true',
    watch: process.env.DISABLE_HMR === 'true' ? null : {},
  },
}));
