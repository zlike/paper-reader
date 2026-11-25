import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: path.resolve(rootDir, 'web'),
  publicDir: path.resolve(rootDir, 'public'),
  plugins: [react()],
  build: {
    outDir: path.resolve(rootDir, 'dist'),
    emptyOutDir: true
  },
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:3000',
      '/vendor': 'http://127.0.0.1:3000'
    }
  }
});
