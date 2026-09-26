import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  clean: true,
  sourcemap: true,
  // node:sqlite yalnızca "node:" önekiyle yüklenebilir.
  removeNodeProtocol: false,
  // Tüm bağımlılıklar tek dosyaya gömülür; yalnızca yerel (native) argon2 dışarıda kalır.
  // Böylece Docker imajında sadece `npm i @node-rs/argon2` yeterlidir.
  noExternal: [/^(?!@node-rs\/argon2|bufferutil|utf-8-validate)/],
  external: ['@node-rs/argon2', 'bufferutil', 'utf-8-validate'],
  // Gömülen CommonJS paketlerinin require() çağrıları için
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
});
