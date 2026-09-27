import { afterEach, describe, expect, it, vi } from 'vitest';
import { SpuriousDuplicateGuard } from '../src/voiceDiagnostics';

afterEach(() => vi.useRealTimers());

describe('yeniden bağlanma sonrası "başka cihaz" uyarısı', () => {
  it('yalnızca yeniden bağlanmanın hemen ardından ve dakikada bir kez sessizce geri döner', () => {
    vi.useFakeTimers();
    const guard = new SpuriousDuplicateGuard();
    // Yeniden bağlanma olmadan: gerçekten başka cihaz
    expect(guard.shouldRejoin(true)).toBe(false);

    guard.noteReconnect();
    expect(guard.shouldRejoin(false)).toBe(false); // başka bir kopuş nedeni
    expect(guard.shouldRejoin(true)).toBe(true);
    // Hemen tekrar olursa döngüye girilmez
    guard.noteReconnect();
    expect(guard.shouldRejoin(true)).toBe(false);

    // 30 saniyeden eski yeniden bağlanma sayılmaz
    vi.advanceTimersByTime(61_000);
    expect(guard.shouldRejoin(true)).toBe(false);
    guard.noteReconnect();
    expect(guard.shouldRejoin(true)).toBe(true);
  });
});
