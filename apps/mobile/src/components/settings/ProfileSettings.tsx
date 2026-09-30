import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  animatedDecoration,
  animatedDecorationSet,
  COSMETIC_SET_LABELS,
  COSMETIC_SETS,
  NAMEPLATE_LABELS,
  NAMEPLATES,
  PROFILE_EFFECT_LABELS,
  PROFILE_EFFECTS,
  userProfileEffect,
  type AnimatedDecoration,
  type CosmeticSet,
  type Nameplate,
  type ProfileEffect,
  type ProfileTheme,
  type User,
} from '@diskort/shared';
import {
  COSMETIC_SET_INFO,
  errorMessage,
  PROFILE_THEME_PRESETS,
  profileGradient,
  removeAvatar,
  removeBanner,
  updateProfileLook,
  uploadAvatar,
  uploadBanner,
  useSession,
} from '@diskort/client-core';
import { pickAvatar, pickBanner } from '../../attachments';
import { toast } from '../../stores/ui';
import { colors, createStyles, font, radius, space } from '../../theme';
import { Avatar, PresenceAvatar } from '../Avatar';
import { useHasSkia, NAMEPLATE_TEXT_SHADOW, NameplateBackground, nameplateNameColor, SetThumb } from '../cosmetics/Cosmetics';
import { confirmDialog } from '../Dialog';
import { PressableScale } from '../PressableScale';
import { ProfileHeader } from '../ProfileHeader';
import { StatusChip } from '../StatusPicker';
import { Button, Card, Choices, SectionTitle } from '../ui';

/**
 * Ayarlar → Profil (masaüstündeki profil fotoğrafı ve süsler): fotoğraf galeriden seçilip kare
 * kırpılır; durum ve özel durum; profil süsleri (afiş, tema, efekt).
 * En üstteki kart, üyelerin gördüğü profil kartının canlı önizlemesidir.
 */
export function ProfileSettings() {
  const user = useSession((s) => s.user);
  const photo = useProfilePhoto();
  const banner = useProfileBanner();
  const look = useProfileLook();
  // Hareketli setler yalnızca Skia'lı uygulamada sunulur (yoksa çizilemez)
  const animated = useHasSkia();

  if (!user) return null;
  // Önizleme: seçimler kaydedilmeden önce de kartta görünür
  const preview: User = {
    ...user,
    profileTheme: look.theme,
    animatedEffect: look.effect,
    avatarDecoration: look.decoration,
    nameplate: look.nameplate,
  };
  // Setin üç parçası birden seçili mi
  const appliedSet =
    COSMETIC_SETS.find(
      (set) => look.effect === set && animatedDecorationSet(look.decoration) === set && look.nameplate === set,
    ) ?? null;
  return (
    <View>
      <ProfileHeader
        user={preview}
        // Ayarlar sayfasında seçicilerle birlikte çizilir: önizleme 30 kare/sn
        effectFps={30}
        centered
        avatar={(ring) => (
          <PressableScale
            scaleTo={0.94}
            onPress={() => void photo.change()}
            disabled={photo.busy !== null}
            accessibilityLabel="Profil fotoğrafını değiştir"
          >
            <PresenceAvatar userId={user.id} user={user} size={88} surface={ring} decoration={look.decoration} />
            <View style={[styles.cameraBadge, { borderColor: ring }]}>
              {photo.busy ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="camera" size={15} color="#fff" />}
            </View>
          </PressableScale>
        )}
      >
        <StatusChip />
        {user.avatarUrl ? (
          <Pressable
            onPress={() => void photo.remove()}
            disabled={photo.busy !== null}
            hitSlop={8}
            style={styles.removePhoto}
            accessibilityRole="button"
          >
            <Text style={styles.removePhotoText}>Fotoğrafı kaldır</Text>
          </Pressable>
        ) : (
          <Text style={styles.photoHint}>Fotoğraf eklemek için avatara dokun</Text>
        )}
      </ProfileHeader>

      <SectionTitle>Afiş</SectionTitle>
      <Card style={styles.pad}>
        <Text style={styles.hint}>Profil kartının üstündeki geniş resim. Seçerken 17:6 kırpılır.</Text>
        <View style={styles.buttons}>
          <View style={styles.button}>
            <Button
              title={user.bannerUrl ? 'Afişi değiştir' : 'Afiş seç'}
              busy={banner.busy === 'upload'}
              disabled={banner.busy !== null}
              onPress={() => void banner.change()}
            />
          </View>
          {user.bannerUrl ? (
            <View style={styles.button}>
              <Button
                title="Kaldır"
                variant="secondary"
                busy={banner.busy === 'remove'}
                disabled={banner.busy !== null}
                onPress={() => void banner.remove()}
              />
            </View>
          ) : null}
        </View>
      </Card>

      <SectionTitle>Profil teması</SectionTitle>
      <Card style={styles.pad}>
        <Text style={styles.hint}>Profil kartının zemini: yukarıdan aşağıya iki renk.</Text>
        <View style={styles.colors} accessibilityRole="radiogroup" accessibilityLabel="Profil teması">
          <Pressable
            onPress={() => look.setTheme(null)}
            style={[styles.swatch, styles.swatchNone, look.theme === null && styles.swatchOn]}
            accessibilityRole="radio"
            accessibilityState={{ selected: look.theme === null }}
            accessibilityLabel="Yok"
          >
            <Ionicons name={look.theme === null ? 'checkmark' : 'close'} size={20} color={colors.muted} />
          </Pressable>
          {PROFILE_THEME_PRESETS.map((preset) => {
            const selected = sameTheme(look.theme, preset);
            return (
              <Pressable
                key={preset.name}
                onPress={() => look.setTheme({ primary: preset.primary, accent: preset.accent })}
                style={[styles.swatch, selected && styles.swatchOn]}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={preset.name}
              >
                {/* Degrade kenarlığı hiç olmayan ayrı görünümde (#28, #29): Android'de (RN 0.86) kenarlık kaldırılınca
                    genişlik NaN gelir, degradeli görünümde LinearGradient NaN noktalarla kurulur ve uygulama çöker
                    (IllegalArgumentException, BackgroundImageDrawable.draw) */}
                <View
                  pointerEvents="none"
                  style={[StyleSheet.absoluteFill, { experimental_backgroundImage: profileGradient(preset) }]}
                />
                {selected ? <Ionicons name="checkmark" size={20} color="#fff" /> : null}
              </Pressable>
            );
          })}
        </View>
      </Card>

      {animated ? (
        <>
          <SectionTitle>Hareketli setler</SectionTitle>
          <Card style={styles.pad}>
            <Text style={styles.hint}>
              Her set üç parça: kartı saran efekt, avatar dekorasyonu ve üye listesindeki isim plakası. Seti uygula ya
              da parçaları aşağıdan tek tek seçip karıştır.
            </Text>
            <SetPicker applied={appliedSet} onApply={look.applySet} />
          </Card>

          <SectionTitle>Profil efekti</SectionTitle>
          <Card style={styles.pad}>
            <Text style={styles.hint}>Profil kartında oynayan süs.</Text>
            <Choices
              label="Profil efekti"
              options={EFFECT_OPTIONS}
              value={look.effect ?? 'none'}
              onChange={(value) => look.setEffect(value === 'none' ? null : value)}
            />
          </Card>

          <SectionTitle>Avatar dekorasyonu</SectionTitle>
          <Card style={styles.pad}>
            <Text style={styles.hint}>
              Avatarının çevresindeki süs; mesajlarda ve üye listesinde de görünür (küçük avatarda sabit bir halka olur).
            </Text>
            <DecorationChoices user={user} value={look.decoration} onPick={look.setDecoration} />
          </Card>

          <SectionTitle>İsim plakası</SectionTitle>
          <Card style={styles.pad}>
            <Text style={styles.hint}>Üye listesinde adının arkasında oynayan zemin.</Text>
            <NameplatePicker user={preview} value={look.nameplate} onPick={look.setNameplate} />
          </Card>
        </>
      ) : (
        <>
          <SectionTitle>Hareketli setler</SectionTitle>
          <Card style={styles.pad}>
            <Text style={[styles.hint, styles.hintLast]}>
              Profil efekti, avatar dekorasyonu ve isim plakası bu sürümde telefonda gösterilemiyor. Uygulamayı
              güncelleyince buradan seçebilirsin.
            </Text>
          </Card>
        </>
      )}
    </View>
  );
}

const EFFECT_OPTIONS: readonly { value: ProfileEffect | 'none'; label: string }[] = [
  { value: 'none', label: 'Yok' },
  ...PROFILE_EFFECTS.map((value) => ({ value, label: PROFILE_EFFECT_LABELS[value] })),
];

/** Hareketli setler: canlı küçük resimli kutular; dokununca setin üç parçası birden uygulanır */
function SetPicker({ applied, onApply }: { applied: CosmeticSet | null; onApply: (set: CosmeticSet) => void }) {
  return (
    <View style={styles.sets}>
      {COSMETIC_SETS.map((set) => {
        const info = COSMETIC_SET_INFO[set];
        const on = applied === set;
        return (
          <Pressable
            key={set}
            onPress={() => onApply(set)}
            style={({ pressed }) => [
              styles.set,
              on && { borderColor: info.accent, boxShadow: `0 6px 18px -8px ${info.accent}` },
              pressed && { opacity: 0.85 },
            ]}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            accessibilityLabel={`${COSMETIC_SET_LABELS[set]} setini uygula`}
            accessibilityHint={info.description}
          >
            <SetThumb set={set} still={!on} style={styles.setThumb} />
            <View style={styles.setLabel}>
              <Text style={styles.setName} numberOfLines={1}>
                {COSMETIC_SET_LABELS[set]}
              </Text>
              {on && <Ionicons name="checkmark" size={16} color={info.accent} />}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

/** İsim plakaları: "Yok" ve her setin plakası, üye listesindeki satırın küçük kopyasıyla */
function NameplatePicker({
  user,
  value,
  onPick,
}: {
  user: User;
  value: Nameplate | null;
  onPick: (id: Nameplate | null) => void;
}) {
  const options: { id: Nameplate | null; name: string }[] = [
    { id: null, name: 'Yok' },
    ...NAMEPLATES.map((id) => ({ id, name: NAMEPLATE_LABELS[id] })),
  ];
  return (
    <View style={styles.plates} accessibilityRole="radiogroup" accessibilityLabel="İsim plakası">
      {options.map((o) => {
        const selected = value === o.id;
        return (
          <Pressable
            key={o.id ?? 'none'}
            onPress={() => onPick(o.id)}
            style={({ pressed }) => [styles.plateOption, selected && styles.tileOn, pressed && { opacity: 0.85 }]}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={o.name}
          >
            <View style={styles.plateRow}>
              {o.id && <NameplateBackground set={o.id} still={!selected} />}
              <Avatar user={user} size={30} status="online" surface={o.id ? '#0a0a0a' : colors.main} decoration={user.avatarDecoration} />
              <Text
                style={[styles.plateName, o.id ? [{ color: nameplateNameColor(null) }, NAMEPLATE_TEXT_SHADOW] : null]}
                numberOfLines={1}
              >
                {user.displayName}
              </Text>
              <Text style={[styles.plateLabel, o.id ? styles.plateLabelOn : null]} numberOfLines={1}>
                {o.name}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const sameTheme = (a: ProfileTheme | null, b: ProfileTheme | null): boolean =>
  a === b || (a !== null && b !== null && a.primary === b.primary && a.accent === b.accent);

/** Hareketli avatar dekorasyonları ve "Yok": avatarın önizlemesiyle küçük kutular */
const DECORATION_OPTIONS: readonly { id: AnimatedDecoration | null; name: string }[] = [
  { id: null, name: 'Yok' },
  ...COSMETIC_SETS.map((set) => ({ id: animatedDecoration(set), name: COSMETIC_SET_LABELS[set] })),
];

function DecorationChoices({
  user,
  value,
  onPick,
}: {
  user: User;
  value: AnimatedDecoration | null;
  onPick: (id: AnimatedDecoration | null) => void;
}) {
  return (
    <View style={styles.tiles} accessibilityRole="radiogroup" accessibilityLabel="Avatar dekorasyonu">
      {DECORATION_OPTIONS.map((o) => {
        const selected = value === o.id;
        return (
          <Pressable
            key={o.id ?? 'none'}
            onPress={() => onPick(o.id)}
            style={({ pressed }) => [styles.tile, selected && styles.tileOn, pressed && { opacity: 0.8 }]}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={o.name}
          >
            {/* Yalnızca seçili dekorasyon oynar; diğerleri tek sabit kare (sayfada onlarca yüzey olmasın) */}
            <Avatar user={user} size={42} decoration={o.id} animateDecoration decorationStill={!selected} />
          </Pressable>
        );
      })}
    </View>
  );
}

type LookPatch = Parameters<typeof updateProfileLook>[0];

/**
 * Profil teması, efekti, dekorasyonu ve isim plakası: seçim önizlemede hemen görünür ve sunucuya kaydedilir;
 * kaydedilemezse eskisine döner ve hata gösterilir. Setin üç parçası tek istekle kaydedilir.
 */
function useProfileLook() {
  const user = useSession((s) => s.user);
  const [draft, setDraft] = useState<LookPatch>({});

  const save = (patch: LookPatch): void => {
    setDraft((d) => ({ ...d, ...patch }));
    updateProfileLook(patch)
      .catch((err: unknown) => toast(errorMessage(err), 'error'))
      // Bu arada aynı alan için başka bir seçim yapıldıysa taslak onundur
      .finally(() =>
        setDraft((d) => {
          const next = { ...d };
          for (const key of Object.keys(patch) as (keyof LookPatch)[]) if (next[key] === patch[key]) delete next[key];
          return next;
        }),
      );
  };
  const pick = <K extends keyof LookPatch>(key: K): NonNullable<LookPatch[K]> | null =>
    ((key in draft ? draft[key] : user?.[key]) ?? null) as NonNullable<LookPatch[K]> | null;

  const savedDecoration = animatedDecorationSet(user?.avatarDecoration);

  return {
    theme: pick('profileTheme'),
    // Efekt istekte profileEffect'le gider, kullanıcıda animatedEffect'te durur
    effect: 'profileEffect' in draft ? (draft.profileEffect ?? null) : user ? userProfileEffect(user) : null,
    decoration:
      'avatarDecoration' in draft
        ? (draft.avatarDecoration ?? null)
        : savedDecoration && animatedDecoration(savedDecoration),
    nameplate: pick('nameplate'),
    setTheme: (profileTheme: ProfileTheme | null) => save({ profileTheme }),
    setEffect: (profileEffect: ProfileEffect | null) => save({ profileEffect }),
    setDecoration: (avatarDecoration: AnimatedDecoration | null) => save({ avatarDecoration }),
    setNameplate: (nameplate: Nameplate | null) => save({ nameplate }),
    applySet: (set: CosmeticSet) =>
      save({ profileEffect: set, avatarDecoration: animatedDecoration(set), nameplate: set }),
  };
}

/** Profil afişi: galeriden seçilip 17:6 kırpılır, sunucu küçültür. Kaldırmadan önce onay sorulur. */
function useProfileBanner() {
  const [busy, setBusy] = useState<'upload' | 'remove' | null>(null);

  const change = async (): Promise<void> => {
    const file = await pickBanner().catch((err: unknown) => {
      toast(errorMessage(err), 'error');
      return null;
    });
    if (!file) return;
    setBusy('upload');
    try {
      await uploadBanner(file);
      toast('Afiş güncellendi.');
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(null);
    }
  };

  const remove = async (): Promise<void> => {
    const ok = await confirmDialog({
      title: 'Afiş kaldırılsın mı?',
      message: 'Kartının üstünde yeniden tema rengin (yoksa avatarının rengi) görünür.',
      confirmLabel: 'Kaldır',
      danger: true,
    });
    if (!ok) return;
    setBusy('remove');
    try {
      await removeBanner();
      toast('Afiş kaldırıldı.');
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(null);
    }
  };

  return { busy, change, remove };
}

/** Profil fotoğrafı: galeriden seçilip kare kırpılır, sunucu küçültür. Kaldırmadan önce onay sorulur. */
function useProfilePhoto() {
  const [busy, setBusy] = useState<'upload' | 'remove' | null>(null);

  const change = async (): Promise<void> => {
    const file = await pickAvatar().catch((err: unknown) => {
      toast(errorMessage(err), 'error');
      return null;
    });
    if (!file) return;
    setBusy('upload');
    try {
      await uploadAvatar(file);
      toast('Profil fotoğrafı güncellendi.');
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(null);
    }
  };

  const remove = async (): Promise<void> => {
    const ok = await confirmDialog({
      title: 'Fotoğraf kaldırılsın mı?',
      message: 'Avatarında adının baş harfleri görünür.',
      confirmLabel: 'Kaldır',
      danger: true,
    });
    if (!ok) return;
    setBusy('remove');
    try {
      await removeAvatar();
      toast('Profil fotoğrafı kaldırıldı.');
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(null);
    }
  };

  return { busy, change, remove };
}

const styles = createStyles(() => ({
  cameraBadge: {
    position: 'absolute',
    right: 2,
    bottom: 2,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.brand,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  removePhoto: { marginTop: space.md, alignSelf: 'center' },
  removePhotoText: { color: colors.muted, fontSize: font.small, fontWeight: '600' },
  photoHint: { color: colors.faint, fontSize: font.caption, marginTop: space.md, textAlign: 'center' },
  pad: { padding: space.lg },
  hint: { color: colors.muted, fontSize: font.small, marginBottom: space.md },
  hintLast: { marginBottom: 0 },
  colors: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  // borderWidth: 0 bilerek: seçim kalkınca kenarlık "kaldırılmasın", 0 olsun. Android'de (RN 0.86) kaldırılan
  // kenarlığın genişliği NaN gelir; yuvarlak kırpma alanı NaN olur, içerik (degrade) görünmez (#29)
  swatch: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  swatchOn: { borderWidth: 3, borderColor: colors.head },
  swatchNone: { backgroundColor: colors.main, borderWidth: 1, borderColor: colors.line },
  buttons: { flexDirection: 'row', gap: space.sm },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  tile: {
    width: 72,
    height: 72,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: 'transparent',
    backgroundColor: colors.main,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileOn: { borderColor: colors.brand },
  button: { flex: 1 },
  // Hareketli setler: iki sütun, 16:10 canlı küçük resim ve adı
  sets: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  set: {
    width: '48.5%',
    flexGrow: 1,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.main,
    overflow: 'hidden',
  },
  setThumb: { width: '100%', aspectRatio: 16 / 10 },
  setLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.xs,
    paddingHorizontal: space.sm,
    paddingVertical: space.sm - 2,
  },
  setName: { color: colors.head, fontSize: font.small, fontWeight: '700', flexShrink: 1 },
  // İsim plakası seçenekleri: üye listesindeki satırın küçük kopyası
  plates: { gap: space.sm },
  plateOption: { borderRadius: radius.md, borderWidth: 2, borderColor: 'transparent', padding: 2 },
  plateRow: {
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm + 2,
    paddingHorizontal: space.sm,
    borderRadius: radius.sm,
    overflow: 'hidden',
    backgroundColor: colors.main,
  },
  plateName: { color: colors.text, fontSize: font.small, fontWeight: '600', flexShrink: 1 },
  plateLabel: { marginLeft: 'auto', color: colors.muted, fontSize: font.caption },
  plateLabelOn: { color: 'rgba(255,255,255,0.85)', ...NAMEPLATE_TEXT_SHADOW },
}));
