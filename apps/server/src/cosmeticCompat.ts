// Eski istemcilerin korunması: sunucudan dağıtılan kozmetik paketlerini tanımayan istemcilere (0.9.1 ve
// öncesi) kullanıcıların set seçimlerinde yalnızca yerleşik kimlikler gider.
//
// Neden: o sürümler isim plakasını (User.nameplate) tanıyıp tanımadığına bakmadan çizer. Masaüstünde
// tanınmayan kimlik çizim döngüsünde yakalanmayan bir hata fırlatır (her karede): ekrandaki BÜTÜN hareketli
// süsler durur ve hata sunucuya raporlanır. Telefonda satır, plakası olmadan plaka yazı rengiyle kalır.
// animatedEffect ve avatarDecoration o sürümlerde zaten daraltılarak okunur; yine de üçü birlikte süzülür
// (tek kural, ileride şaşırtmasın).
//
// İstemci paketleri tanıdığını gateway'de IDENTIFY'ın `features` listesiyle, HTTP isteklerinde
// CLIENT_FEATURES_HEADER başlığıyla bildirir; bildirmeyen istemci eski sayılır. Yerleşik olmayan paket
// yayında değilken hiçbir şey süzülmez (bkz. CosmeticPackStore.hasCustomIds).

import {
  animatedDecorationSet,
  ANIMATED_DECORATION_PREFIX,
  CLIENT_FEATURE_COSMETIC_PACKS,
  COSMETIC_SETS,
  isCosmeticSet,
} from '@diskort/shared';

const BUILTIN = COSMETIC_SETS.join('|');
/**
 * JSON metninde yerleşik olmayan bir set kimliği taşıyan alan var mı (ayrıştırmadan, hızlı ön denetim).
 * Alan adı bir metnin içinde geçemez: JSON'da metindeki tırnaklar ters eğik çizgiyle yazılır.
 */
const CUSTOM_ID = new RegExp(
  `"(?:animatedEffect|nameplate)":"(?!(?:${BUILTIN})")|"avatarDecoration":"${ANIMATED_DECORATION_PREFIX}(?!(?:${BUILTIN})")`,
);

function builtinOnly(key: string, value: unknown): unknown {
  if (typeof value !== 'string') return value;
  if (key === 'animatedEffect' || key === 'nameplate') return isCosmeticSet(value) ? value : null;
  if (key === 'avatarDecoration') {
    return value.startsWith(ANIMATED_DECORATION_PREFIX) && !animatedDecorationSet(value) ? null : value;
  }
  return value;
}

/**
 * Giden JSON'un eski istemciye uygun hali: kullanıcıların set seçimlerindeki yerleşik olmayan kimlikler
 * null olur (o istemcide "süs yok"). Çoğu mesajda böyle bir alan yoktur: metin olduğu gibi döner.
 */
export function withoutPackCosmetics(json: string): string {
  if (!CUSTOM_ID.test(json)) return json;
  try {
    return JSON.stringify(JSON.parse(json), builtinOnly);
  } catch {
    // JSON değil: dokunulmaz
    return json;
  }
}

/** İstemci kozmetik paketlerini tanıdığını bildirdi mi (özellik listesi: dizi ya da virgüllü başlık) */
export function knowsCosmeticPacks(features: unknown): boolean {
  const list = Array.isArray(features) ? features : typeof features === 'string' ? features.split(',') : [];
  return list.some((f) => typeof f === 'string' && f.trim() === CLIENT_FEATURE_COSMETIC_PACKS);
}
