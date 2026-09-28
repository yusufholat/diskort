import { useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  AVATAR_COLORS,
  PROFILE_EFFECT_LABELS,
  PROFILE_EFFECTS,
  type ProfileEffect,
  type ProfileTheme,
} from '@diskort/shared';
import {
  api,
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
import { colors, createStyles, font, space } from '../../theme';
import { PresenceAvatar } from '../Avatar';
import { confirmDialog } from '../Dialog';
import { PressableScale } from '../PressableScale';
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
        user={{ ...user, profileTheme: look.theme, profileEffect: look.effect }}
        centered
        avatar={(ring) => (
          <PressableScale
            scaleTo={0.94}
            onPress={() => void photo.change()}
            disabled={photo.busy !== null}
            accessibilityLabel="Profil fotoğrafını değiştir"
          >
            <PresenceAvatar userId={user.id} user={user} size={88} surface={ring} />
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
        <Choices
          label="Profil efekti"
          options={EFFECT_OPTIONS}
          value={look.effect ?? 'none'}
          onChange={(value) => look.setEffect(value === 'none' ? null : value)}
        />
      </Card>
    </View>
  );
}

const EFFECT_OPTIONS: readonly { value: ProfileEffect | 'none'; label: string }[] = [
  { value: 'none', label: 'Yok' },
  ...PROFILE_EFFECTS.map((value) => ({ value, label: PROFILE_EFFECT_LABELS[value] })),
];

const sameTheme = (a: ProfileTheme | null, b: ProfileTheme | null): boolean =>
  a === b || (a !== null && b !== null && a.primary === b.primary && a.accent === b.accent);

/**
 * Profil teması ve efekti: seçim önizlemede hemen görünür ve sunucuya kaydedilir; kaydedilemezse eskisine
 * döner ve hata gösterilir.
 */
function useProfileLook() {
  const user = useSession((s) => s.user);
  const [theme, setThemeDraft] = useState<ProfileTheme | null | undefined>(undefined);
  const [effect, setEffectDraft] = useState<ProfileEffect | null | undefined>(undefined);

  const setTheme = (next: ProfileTheme | null): void => {
    setThemeDraft(next);
    updateProfileLook({ profileTheme: next })
      .catch((err: unknown) => toast(errorMessage(err), 'error'))
      // Bu arada başka bir seçim yapıldıysa taslak onundur
      .finally(() => setThemeDraft((d) => (d === next ? undefined : d)));
  };

  const setEffect = (next: ProfileEffect | null): void => {
    setEffectDraft(next);
    updateProfileLook({ profileEffect: next })
      .catch((err: unknown) => toast(errorMessage(err), 'error'))
      .finally(() => setEffectDraft((d) => (d === next ? undefined : d)));
  };

  return {
    theme: theme === undefined ? (user?.profileTheme ?? null) : theme,
    effect: effect === undefined ? (user?.profileEffect ?? null) : effect,
    setTheme,
    setEffect,
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
  button: { flex: 1 },
}));
