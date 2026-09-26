import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  main: {
    build: { externalizeDeps: true },
  },
  preload: {
    build: { externalizeDeps: true },
  },
  renderer: {
    resolve: {
      alias: { '@': resolve(__dirname, 'src/renderer/src') },
    },
    plugins: [react(), tailwindcss()],
    server: { port: 5173, strictPort: true },
    build: {
      target: 'chrome140',
      // AudioWorklet betikleri CSP gereği data: URL olarak gömülmemeli.
      assetsInlineLimit: (file: string) => (file.endsWith('.js') ? false : undefined),
    },
  },
});
