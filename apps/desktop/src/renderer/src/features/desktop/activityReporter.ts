import { ensureActivityIcon, setActivity } from '@diskort/client-core';
import type { ActivityGame } from '../../../../shared/bridge';

/** Son bildirilen oyun: süren bir ikon yüklemesi bittiğinde hâlâ o oyun oynanıyor mu diye bakılır */
let current: ActivityGame | null = null;

/**
 * Ana sürecin algıladığı oyunu sunucuya bildirir (null: oyun yok ya da "Oynadığım oyunu göster" kapalı).
 * İkon sunucuda yoksa önce yüklenir: sunucu bilmediği ikon anahtarını ikonsuz sayar. Yükleme sürerken oyun
 * ikonsuz bildirilir, bitince ikonuyla yeniden; yüklenemezse (eski sunucu, ağ hatası) ikonsuz kalır.
 */
export function reportActivity(game: ActivityGame | null, readIcon: (key: string) => Promise<Uint8Array | null>): void {
  current = game;
  if (!game) {
    setActivity(null);
    return;
  }
  const send = (icon: string | null): void =>
    setActivity({ type: 'game', name: game.name, icon, elapsedMs: Math.max(0, Date.now() - game.startedAt) });
  const key = game.icon;
  if (!key) {
    send(null);
    return;
  }
  let settled = false;
  void ensureActivityIcon(key, () => readIcon(key)).then((ok) => {
    settled = true;
    if (current === game) send(ok ? key : null);
  });
  // İkonun sunucuda olduğu zaten biliniyorsa yukarıdaki hemen sonuçlanır; yoksa beklemeden ikonsuz bildirilir
  setTimeout(() => {
    if (!settled && current === game) send(null);
  }, 0);
}
