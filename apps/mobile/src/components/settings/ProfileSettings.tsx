import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  AVATAR_COLORS,
  COSMETIC_SET_LABELS,
  isCosmeticSet,
  isLegacyProfileEffect,
  LEGACY_PROFILE_EFFECTS,
  PROFILE_EFFECT_LABELS,
  type ProfileEffect,
  type ProfileTheme,
} from '@diskort/shared';
import {
  api,
  errorMessage,
  loadCosmetics,
  PROFILE_THEME_PRESETS,
  profileGradient,
  removeAvatar,
  removeBanner,
  updateProfileLook,
  uploadAvatar,
  uploadBanner,
  useCosmetics,
  useSession,
  type CosmeticKind,
} from '@diskort/client-core';
import { pickAvatar, pickBanner } from '../../attachments';
import { toast } from '../../stores/ui';
import { colors, createStyles, font, radius, space } from '../../theme';
import { Avatar, PresenceAvatar } from '../Avatar';
import { confirmDialog } from '../Dialog';
import { PressableScale } from '../PressableScale';
import { ProfileFrame } from '../ProfileFrame';
import { ProfileHeader } from '../ProfileHeader';
import { StatusChip } from '../StatusPicker';
import { Button, Card, Choices, SectionTitle } from '../ui';

/**
 * Ayarlar → Profil (masaüstündeki profil fotoğrafı ve Profil Rengi): fotoğraf galeriden seçilip kare
 * kırpılır; durum ve özel durum; fotoğraf yokken avatarın zemin rengi; profil süsleri (afiş, tema, efekt).
 * En üstteki kart, üyelerin gördüğü profil kartının canlı önizlemesidir.
 */
export function ProfileSettings() {
  const user = useSession((s) => s.user);
  const photo = useProfilePhoto();
  const banner = useProfileBanner();
  const look = useProfileLook();
  const [savingColor, setSavingColor] = useState(false);

  const setColor = async (avatarColor: string): Promise<void> => {
    setSavingColor(true);
    try {
      const updated = await api.updateMe({ avatarColor });
      useSession.getState().setUser(updated);
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setSavingColor(false);
    }
  };

  if (!user) return null;
  return (
    <View>
      <ProfileHeader
        user={{
          ...user,
          profileTheme: look.theme,
          // Telefon şimdilik yalnızca eski efektleri çizer (hareketli setler masaüstünde)
          profileEffect: isLegacyProfileEffect(look.effect) ? look.effect : null,
          avatarDecoration: look.decoration,
          profileFrame: look.frame,
        }}
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

      <SectionTitle>Profil rengi</SectionTitle>
      <Card style={styles.pad}>
        <Text style={styles.hint}>Profil fotoğrafın yokken avatarının zemin rengi.</Text>
        <View style={styles.colors} accessibilityRole="radiogroup" accessibilityLabel="Profil rengi">
          {AVATAR_COLORS.map((color) => {
            const selected = user.avatarColor === color;
            return (
              <Pressable
                key={color}
                disabled={savingColor}
                onPress={() => void setColor(color)}
                style={[styles.swatch, { backgroundColor: color }, selected && styles.swatchOn]}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={color}
              >
                {selected ? <Ionicons name="checkmark" size={20} color="#fff" /> : null}
              </Pressable>
            );
          })}
        </View>
      </Card>

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
                style={[styles.swatch, { experimental_backgroundImage: profileGradient(preset) }, selected && styles.swatchOn]}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={preset.name}
              >
                {selected ? <Ionicons name="checkmark" size={20} color="#fff" /> : null}
              </Pressable>
            );
          })}
        </View>
      </Card>

      <SectionTitle>Profil efekti</SectionTitle>
      <Card style={styles.pad}>
        <Text style={styles.hint}>Profil kartında oynayan hafif bir süs.</Text>
        {look.effectSet && (
          <Text style={styles.hint}>
            Masaüstünde seçilen hareketli efekt açık: {COSMETIC_SET_LABELS[look.effectSet]}. Telefonda henüz
            görünmez; Yok ile kaldırabilir ya da başka bir efekt seçebilirsin.
          </Text>
        )}
        <Choices
          label="Profil efekti"
          options={EFFECT_OPTIONS}
          // Hareketli set efekti açıkken hiçbir seçenek seçili görünmez: Yok ona dokununca kaldırır
          value={look.effectSet ? 'set' : (look.effect ?? 'none')}
          onChange={(value) => look.setEffect(value === 'none' || value === 'set' ? null : value)}
        />
      </Card>

      <SectionTitle>Avatar dekorasyonu</SectionTitle>
      <Card style={styles.pad}>
        <Text style={styles.hint}>Avatarının çevresindeki süs; mesajlarda ve üye listesinde de görünür.</Text>
        <CosmeticChoices kind="decorations" label="Avatar dekorasyonu" value={look.decoration} onPick={look.setDecoration}>
          {(id) => <Avatar user={user} size={42} decoration={id} />}
        </CosmeticChoices>
      </Card>

      <SectionTitle>Profil çerçevesi</SectionTitle>
      <Card style={styles.pad}>
        <Text style={styles.hint}>Profil kartının kenarlarındaki süs.</Text>
        <CosmeticChoices kind="frames" label="Profil çerçevesi" value={look.frame} onPick={look.setFrame}>
          {(id) => (
            <View style={styles.miniCard}>
              <View style={[styles.miniBanner, { backgroundColor: look.theme?.primary ?? user.avatarColor }]} />
              <ProfileFrame frame={id} border={16} />
            </View>
          )}
        </CosmeticChoices>
      </Card>
    </View>
  );
}

const EFFECT_OPTIONS: readonly { value: ProfileEffect | 'none' | 'set'; label: string }[] = [
  { value: 'none', label: 'Yok' },
  // Hareketli set efektleri telefonda henüz çizilmiyor: yalnızca eski efektler sunulur
  ...LEGACY_PROFILE_EFFECTS.map((value) => ({ value, label: PROFILE_EFFECT_LABELS[value] })),
];

const sameTheme = (a: ProfileTheme | null, b: ProfileTheme | null): boolean =>
  a === b || (a !== null && b !== null && a.primary === b.primary && a.accent === b.accent);

/** Katalogdaki tasarımlar ve "Yok": küçük önizlemeli kutular */
function CosmeticChoices({
  kind,
  label,
  value,
  onPick,
  children,
}: {
  kind: CosmeticKind;
  label: string;
  value: string | null;
  onPick: (id: string | null) => void;
  /** Kutunun içindeki önizleme (null: süs yok) */
  children: (id: string | null) => ReactNode;
}) {
  const catalog = useCosmetics((s) => s.catalog);
  useEffect(() => void loadCosmetics(), []);
  if (!catalog) return <Text style={styles.hint}>Tasarımlar yükleniyor…</Text>;
  const options = [{ id: null, name: 'Yok' }, ...catalog[kind]];
  return (
    <View style={styles.tiles} accessibilityRole="radiogroup" accessibilityLabel={label}>
      {options.map((o) => {
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
            {children(o.id)}
          </Pressable>
        );
      })}
    </View>
  );
}

type LookPatch = Parameters<typeof updateProfileLook>[0];

/**
 * Profil teması, efekti, dekorasyonu ve çerçevesi: seçim önizlemede hemen görünür ve sunucuya
 * kaydedilir; kaydedilemezse eskisine döner ve hata gösterilir.
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

  return {
    theme: pick('profileTheme'),
    effect: pick('profileEffect'),
    // Masaüstünde seçilmiş hareketli set efekti (telefon henüz çizmez); efekt seçilince taslak onun yerine geçer
    effectSet: !('profileEffect' in draft) && isCosmeticSet(user?.animatedEffect) ? user.animatedEffect : null,
    decoration: pick('avatarDecoration'),
    frame: pick('profileFrame'),
    setTheme: (profileTheme: ProfileTheme | null) => save({ profileTheme }),
    setEffect: (profileEffect: ProfileEffect | null) => save({ profileEffect }),
    setDecoration: (avatarDecoration: string | null) => save({ avatarDecoration }),
    setFrame: (profileFrame: string | null) => save({ profileFrame }),
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
      message: 'Kartının üstünde yeniden tema rengin (yoksa profil rengin) görünür.',
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
      message: 'Avatarında adının baş harfleri ve profil rengin görünür.',
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
  colors: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  swatch: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
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
  miniCard: { width: 46, height: 60, borderRadius: 6, overflow: 'hidden', backgroundColor: colors.side },
  miniBanner: { height: 14 },
  button: { flex: 1 },
}));
