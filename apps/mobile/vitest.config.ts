import { defineConfig } from 'vitest/config';

// Bütün paketlerin testleri birlikte koşarken (pnpm -r test) CPU paylaşılır: modülleri her denemede yeniden
// yükleyen testlerde (engine.test.ts) varsayılan 5 sn'lik sınır aşılıyordu (test tek başına geçiyor).
export default defineConfig({
  test: { testTimeout: 30_000, hookTimeout: 30_000 },
});
