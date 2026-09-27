import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { useGuild } from '@diskort/client-core';

/**
 * Ana ekranın gezinmesi (Discord mobil gibi): ana ekran son seçilen kanalın sohbetidir; soldan açılan
 * panelde sunucu çubuğu ve seçili sunucunun kanalları (ya da direkt mesajlar) vardır.
 *
 * Her sunucuda en son açılan kanal hatırlanır: çubukta sunucu değiştirilince arkadaki sohbet de o
 * sunucunun son kanalına geçer (sohbet ile seçili sunucu hep aynı sunucudadır; üyeler, roller doğru olur).
 */
interface NavStore {
  /** Panelde direkt mesajlar gösteriliyor (sohbet bir DM) */
  home: boolean;
  /** Sunucu → o sunucuda en son açılan metin kanalı */
  lastByGuild: Record<string, string>;
  /** En son açılan direkt mesaj konuşması */
  lastDm: string | null;
  /** Sol panel açık mı (kaydırma bırakılınca ya da düğmeyle değişir; saklanmaz) */
  panelOpen: boolean;
}

export const useNav = create<NavStore>()(
  persist(() => ({ home: false, lastByGuild: {}, lastDm: null, panelOpen: false }) as NavStore, {
    name: 'diskort-nav',
    storage: createJSONStorage(() => AsyncStorage),
    partialize: ({ panelOpen: _open, ...rest }) => rest,
  }),
);

export const setPanelOpen = (open: boolean): void => {
  if (useNav.getState().panelOpen !== open) useNav.setState({ panelOpen: open });
};

/** Sunucu çubuğunda sunucu seçildi: panel o sunucunun kanallarını, sohbet son kanalını gösterir */
export function selectGuildInPanel(guildId: string): void {
  useGuild.getState().selectGuild(guildId);
  if (useNav.getState().home) useNav.setState({ home: false });
}

/** Sunucu çubuğunda direkt mesajlar (ana sayfa) seçildi */
export function selectHome(): void {
  if (!useNav.getState().home) useNav.setState({ home: true });
}

/** Bağlantı hazır olmadan (bildirimle soğuk açılış) istenen konuşma: hazır olunca açılır */
let pending: string | null = null;
let unsubscribe: (() => void) | null = null;

/**
 * Kanalı ya da konuşmayı ana ekranın sohbeti yapar ve paneli kapatır. Kanal başka bir sunucudaysa o
 * sunucuya geçilir. Bağlantı henüz hazır değilse (kanal tanınmıyor) hazır olunca açılır.
 */
export function openChat(id: string): void {
  const g = useGuild.getState();
  const guildId = g.channelGuild[id];
  if (guildId) {
    g.selectGuild(guildId);
    useNav.setState((s) => ({ home: false, lastByGuild: { ...s.lastByGuild, [guildId]: id }, panelOpen: false }));
    return;
  }
  if (g.dms[id]) {
    useNav.setState({ home: true, lastDm: id, panelOpen: false });
    return;
  }
  if (g.status === 'ready') return; // görülemeyen kanal (silinmiş ya da erişim kalkmış)
  pending = id;
  unsubscribe ??= useGuild.subscribe((s) => {
    if (s.status !== 'ready') return;
    unsubscribe?.();
    unsubscribe = null;
    const wanted = pending;
    pending = null;
    if (wanted) openChat(wanted);
  });
}

/**
 * Başka bir ekrandan (bildirim, yeni mesaj, üye kartı…) bir sohbete gider: sohbeti seçer ve üstteki
 * ekranları kapatarak ana ekrana döner.
 */
export function showChat(id: string): void {
  openChat(id);
  if (router.canDismiss()) router.dismissTo('/');
}

/**
 * Ana ekranda gösterilecek sohbet: direkt mesajlardaysa son konuşma; sunucudaysa o sunucuda son açılan
 * kanal (yoksa ya da artık görülemiyorsa ilk metin kanalı). Hiçbiri yoksa null.
 */
export function useCurrentChat(): string | null {
  const home = useNav((s) => s.home);
  const lastDm = useNav((s) => s.lastDm);
  const guildId = useGuild((s) => s.activeGuildId);
  const remembered = useNav((s) => (guildId ? s.lastByGuild[guildId] : undefined));
  const dmOk = useGuild((s) => (lastDm ? Boolean(s.dms[lastDm]) : false));
  const rememberedOk = useGuild((s) => (remembered ? s.channelGuild[remembered] === guildId : false));
  const fallback = useGuild((s) => s.channels.find((c) => c.type === 'text')?.id ?? null);
  if (home) return dmOk ? lastDm : null;
  return rememberedOk ? remembered! : fallback;
}
