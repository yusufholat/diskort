import { beforeEach, vi } from 'vitest';

// Testler ağa çıkmaz. Çekirdek bazı işleri kendiliğinden başlatır (ör. gateway READY'de kozmetik paketi
// bildirimini tazeler): kendi sahte fetch'ini kurmayan testte istek gerçek ağa gitmesin diye her testin
// başında fetch "sunucuya ulaşılamadı" gibi davranır. Test kendi fetch'ini kurarsa (vi.stubGlobal) o geçerlidir.
beforeEach(() => {
  vi.stubGlobal('fetch', async () => {
    throw new TypeError('fetch failed (test: ağ yok)');
  });
});
