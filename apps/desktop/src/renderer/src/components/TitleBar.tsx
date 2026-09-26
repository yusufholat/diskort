import { bridge, isMac, isWindows } from '../lib/bridge';

/**
 * Discord tarzı ince başlık çubuğu. Windows'ta pencere düğmeleri Electron'un
 * titleBarOverlay'i ile sağda çizilir; macOS'ta trafik ışıkları solda kalır.
 * Linux'ta ve tarayıcıda yerel çerçeve kullanıldığı için gösterilmez.
 */
export function TitleBar() {
  if (!bridge || (!isWindows && !isMac)) return null;
  return (
    <div className="drag flex h-[30px] shrink-0 items-center bg-bg-rail">
      <span className={isMac ? 'pl-[78px]' : 'pl-3'}>
        <span className="text-xs font-bold tracking-wide text-text-muted">Diskurt</span>
      </span>
    </div>
  );
}
