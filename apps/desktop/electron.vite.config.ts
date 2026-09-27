import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const { version } = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')) as { version: string };

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
      // Ortak çekirdek paket de aynı React ve zustand kopyasını kullanmalı
      dedupe: ['react', 'react-dom', 'zustand'],
    },
    plugins: [react(), tailwindcss()],
    // Gateway'e bildirilen uygulama sürümü (sunucu eski sürümleri reddeder)
    define: { __APP_VERSION__: JSON.stringify(version) },
    server: { port: 5173, strictPort: true },
    // DPDFNet işçisi onnxruntime-web'i ES modülü olarak yükler
    worker: { format: 'es' },
    build: {
      target: 'chrome140',
      // AudioWorklet betikleri CSP gereği data: URL olarak gömülmemeli.
      assetsInlineLimit: (file: string) => (file.endsWith('.js') ? false : undefined),
    },
  },
});
