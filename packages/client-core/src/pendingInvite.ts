// Uygulamayı açan davet bağlantısı (diskort://davet/<kod>): oturum yokken bekletilir, giriş yapınca
// "Sunucuya katıl" ekranı bu kodla açılır. Sunucu daveti hesap açtırmaz (hesap yalnızca hesap davetiyle
// açılır); bu yüzden giriş ekranı kayda geçmez, yalnızca "giriş yapınca katılacaksın" notu gösterir.
import { create } from 'zustand';
import { parseInviteCode, type InvitePreview } from '@diskort/shared';
import { api } from './api';

interface PendingInviteStore {
  /** Bekleyen davet kodu (yoksa null) */
  code: string | null;
  /** Davetin önizlemesi (sunucu adı); yüklenemezse null, kod yine gösterilir */
  preview: InvitePreview | null;
}

export const usePendingInvite = create<PendingInviteStore>()(() => ({ code: null, preview: null }));

/**
 * Aynı bağlantı birden çok yoldan gelebilir (telefonda hem yönlendirici hem bağlantı dinleyicisi):
 * az önce işlenen kod kısa süre içinde yeniden gelirse ikinci kez açılmaz.
 */
const REPEAT_WINDOW_MS = 5000;
let lastTaken: { code: string; at: number } | null = null;

/** Davet bağlantısından gelen kodu bekletir (geçersizse yok sayar). Kod kabul edildiyse true. */
export function setPendingInvite(codeOrLink: string, now = Date.now()): boolean {
  const code = parseInviteCode(codeOrLink);
  if (!code) return false;
  if (lastTaken && lastTaken.code === code && now - lastTaken.at < REPEAT_WINDOW_MS) return false;
  if (usePendingInvite.getState().code === code) return true;
  usePendingInvite.setState({ code, preview: null });
  refreshPendingInvitePreview();
  return true;
}

/**
 * Giriş ekranında sunucunun adı görünsün (önizleme giriş gerektirmez). Telefonda bağlantı istemci
 * kurulmadan önce gelebilir; giriş ekranı açılınca yeniden denenir.
 */
export function refreshPendingInvitePreview(): void {
  const { code, preview } = usePendingInvite.getState();
  if (!code || preview) return;
  api
    .previewInvite(code)
    .then((result) => {
      if (usePendingInvite.getState().code === code) usePendingInvite.setState({ preview: result });
    })
    .catch(() => undefined);
}

/**
 * Sunucu davetiyle kayıt olunamaz (hesap yalnızca hesap davetiyle açılır). Kayıt ekranına sunucu daveti
 * yazıldıysa kod bekletilir: hesabı olan giriş yapınca katılma ekranı bu kodla açılır.
 */
export async function keepIfGuildInvite(codeOrLink: string): Promise<boolean> {
  const code = parseInviteCode(codeOrLink);
  if (!code) return false;
  try {
    const preview = await api.previewInvite(code);
    if (!preview.guild) return false;
    setPendingInvite(code);
    return true;
  } catch {
    return false;
  }
}

/**
 * Bekleyen kodu alır ve temizler (katılma ekranı açılırken). Hesap davetiyse (önizlemede sunucu yok)
 * katılma ekranında işe yaramaz: temizlenir, null döner.
 */
export function takePendingInvite(now = Date.now()): string | null {
  const { code, preview } = usePendingInvite.getState();
  if (!code) return null;
  lastTaken = { code, at: now };
  usePendingInvite.setState({ code: null, preview: null });
  return preview && !preview.guild ? null : code;
}

/** Bekleyen daveti bırakır (kullanıcı vazgeçti). */
export function clearPendingInvite(): void {
  usePendingInvite.setState({ code: null, preview: null });
}

/** Giriş ekranındaki not: "Giriş yapınca <sunucu> sunucusuna katılacaksın" */
export function pendingInviteNotice(state: PendingInviteStore): string | null {
  if (!state.code) return null;
  const { preview } = state;
  if (preview && !preview.guild) {
    return `${state.code} bir hesap daveti: hesabın yoksa "Davet koduyla kayıt ol" ile bu kodu kullan.`;
  }
  return preview?.guild
    ? `Giriş yapınca "${preview.guild.name}" sunucusuna katılabileceksin.`
    : `Giriş yapınca ${state.code} davetiyle sunucuya katılabileceksin.`;
}
