import { hydrateCosmeticPacks } from './cosmeticPacks';
import { setEnvironment, type ClientEnvironment } from './env';
import { useSession } from './session';

/**
 * Uygulama açılırken, arayüz çizilmeden önce bir kez çağrılır: platform ayrıntılarını verir ve
 * kayıtlı oturumu yükler. Masaüstünde (eşzamanlı depolama) oturum bu çağrı dönünce hazırdır;
 * mobilde (eşzamansız depolama) dönen söz tamamlanınca hazırdır.
 *
 * Cihazda saklanan kozmetik paketi bildirimi de yüklenir (masaüstünde hemen; mobilde arka planda: açılış
 * onu beklemez, gelince süsler görünür).
 */
export function configureClient(environment: ClientEnvironment): Promise<void> {
  setEnvironment(environment);
  void hydrateCosmeticPacks();
  return useSession.persist.rehydrate() ?? Promise.resolve();
}
