import { Download } from 'lucide-react';
import { bridge, isMac, isWindows } from '../lib/bridge';
import { useUpdate } from '../stores/update';

/**
 * Discord tarzı ince başlık çubuğu. Windows'ta pencere düğmeleri Electron'un
 * titleBarOverlay'i ile sağda çizilir; macOS'ta trafik ışıkları solda kalır.
 * Linux'ta ve tarayıcıda yerel çerçeve kullanıldığı için gösterilmez.
 */
export function TitleBar() {
  if (!bridge || (!isWindows && !isMac)) return null;
  return (
    <div className="drag flex h-[30px] shrink-0 items-center border-b border-divider bg-bg-rail">
      <span className={isMac ? 'pl-[78px]' : 'pl-3'}>
        <span className="text-xs font-bold tracking-wide text-text-muted">Diskort</span>
      </span>
      {/* Windows'ta sağdaki ~140 px pencere düğmelerine ayrılmış */}
      <span className={isWindows ? 'ml-auto pr-[146px]' : 'ml-auto pr-2'}>
        <UpdateButton />
      </span>
    </div>
  );
}

/** Arka planda indirilen güncelleme hazırsa Discord'daki gibi yeşil indirme simgesi: tıklayınca yeniden başlatır. */
function UpdateButton() {
  const state = useUpdate((s) => s.state);
  if (state.kind !== 'ready' && state.kind !== 'installing') return null;
  const installing = state.kind === 'installing';
  return (
    <button
      type="button"
      className="no-drag flex h-[22px] items-center gap-1 rounded px-1.5 text-ok transition-colors hover:bg-bg-hover disabled:opacity-60"
      data-tooltip={installing ? 'Yeniden başlatılıyor…' : `Diskort ${state.version} hazır — yeniden başlat`}
      disabled={installing}
      onClick={() => void bridge?.updates.install()}
    >
      <Download size={16} strokeWidth={2.5} className="ico-drop" />
    </button>
  );
}
