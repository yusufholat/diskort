import { defineConfig } from 'vitest/config';

// Testler gerçek SQLite/parola özeti/sharp işi yapar; paralel çalışmada CPU paylaşıldığı için
// varsayılan 5 sn'lik sınır seyrek de olsa aşılıyordu (test tek başına geçiyor).
export default defineConfig({
  test: { testTimeout: 30_000, hookTimeout: 30_000 },
});
