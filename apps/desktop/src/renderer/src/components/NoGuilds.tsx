import { Link2, Sparkles } from 'lucide-react';
import { useUi } from '../stores/ui';

/** Sunucusuz ekranın sol listesi (alttaki kullanıcı paneli LeftColumn'da) */
export function NoGuildsSidebar() {
  return (
    <aside className="flex w-(--sidebar-w) shrink-0 flex-col border-r border-divider bg-bg-side">
      <div className="flex h-12 shrink-0 items-center border-b border-edge px-4 font-semibold text-text-head shadow-sm">
        Sunucular
      </div>
      <div className="flex-1 px-4 pt-4 text-sm text-text-muted">Henüz bir sunucuya üye değilsin.</div>
    </aside>
  );
}

/**
 * Hiç sunucusu olmayan kullanıcının ekranı (yeni hesap ya da bütün sunuculardan ayrılan): sunucu kur ya da
 * davetle katıl. Direkt mesajlar soldaki çubuktan açılabilir.
 */
export function NoGuilds() {
  const openModal = useUi((s) => s.openModal);
  return (
    <main className="anim-fade-in flex min-w-0 flex-1 flex-col items-center justify-center gap-6 bg-bg-main p-8 text-center">
      <div>
        <h1 className="text-2xl font-bold text-text-head">Henüz bir sunucun yok</h1>
        <p className="mt-2 max-w-md text-text-muted">
          Arkadaşlarınla konuşmak için kendi sunucunu kur ya da bir arkadaşının gönderdiği davet bağlantısıyla
          onun sunucusuna katıl.
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-3">
        <button
          className="press flex w-56 flex-col items-center gap-2 rounded-lg bg-bg-side px-5 py-5 transition-colors hover:bg-bg-hover"
          onClick={() => openModal({ type: 'addGuild', tab: 'create' })}
        >
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-brand text-white">
            <Sparkles size={24} className="ico-twinkle" />
          </span>
          <span className="font-semibold text-text-head">Sunucu oluştur</span>
          <span className="text-sm text-text-muted">Metin ve ses kanalıyla hazır gelir</span>
        </button>
        <button
          className="press flex w-56 flex-col items-center gap-2 rounded-lg bg-bg-side px-5 py-5 transition-colors hover:bg-bg-hover"
          onClick={() => openModal({ type: 'addGuild', tab: 'join' })}
        >
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-ok text-white">
            <Link2 size={24} className="ico-tilt" />
          </span>
          <span className="font-semibold text-text-head">Sunucuya katıl</span>
          <span className="text-sm text-text-muted">Davet bağlantın ya da kodun var</span>
        </button>
      </div>
  </main>
  );
}
