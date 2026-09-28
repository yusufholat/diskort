import { useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AVATAR_COLORS } from '@diskort/shared';
import { api, errorMessage, removeAvatar, uploadAvatar, useSession } from '@diskort/client-core';
import { pickAvatar } from '../../attachments';
import { toast } from '../../stores/ui';
import { colors, createStyles, font, radius, space } from '../../theme';
import { PresenceAvatar } from '../Avatar';
import { confirmDialog } from '../Dialog';
import { PressableScale } from '../PressableScale';
import { StatusChip } from '../StatusPicker';
import { Card, SectionTitle } from '../ui';

/**
 * Ayarlar → Profil (masaüstündeki profil fotoğrafı ve Profil Rengi): fotoğraf galeriden seçilip kare
 * kırpılır; durum ve özel durum; fotoğraf yokken avatarın zemin rengi.
 */
export function ProfileSettings() {
  const user = useSession((s) => s.user);
  const photo = useProfilePhoto();
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
      <View style={styles.profile}>
        <View style={styles.banner} />
        <View style={styles.profileBody}>
          <PressableScale
            scaleTo={0.94}
            onPress={() => void photo.change()}
            disabled={photo.busy !== null}
            accessibilityLabel="Profil fotoğrafını değiştir"
            style={styles.avatarWrap}
          >
            <PresenceAvatar userId={user.id} user={user} size={88} surface={colors.side} />
            <View style={styles.cameraBadge}>
              {photo.busy ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="camera" size={15} color="#fff" />}
            </View>
          </PressableScale>
          <Text style={styles.name}>{user.displayName}</Text>
          <Text style={styles.username}>@{user.username}</Text>
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
        </View>
      </View>

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
    </View>
  );
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
  profile: { backgroundColor: colors.side, borderRadius: radius.lg, overflow: 'hidden' },
  banner: { height: 64, backgroundColor: colors.brand },
  profileBody: { alignItems: 'center', paddingHorizontal: space.lg, paddingBottom: space.lg, marginTop: -48 },
  avatarWrap: { padding: 4, borderRadius: 52, backgroundColor: colors.side },
  cameraBadge: {
    position: 'absolute',
    right: 2,
    bottom: 2,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.brand,
    borderWidth: 3,
    borderColor: colors.side,
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: { color: colors.head, fontSize: font.heading + 2, fontWeight: '800', marginTop: space.sm },
  username: { color: colors.muted, fontSize: font.body - 1, marginTop: 2 },
  removePhoto: { marginTop: space.md },
  removePhotoText: { color: colors.muted, fontSize: font.small, fontWeight: '600' },
  photoHint: { color: colors.faint, fontSize: font.caption, marginTop: space.md },
  pad: { padding: space.lg },
  hint: { color: colors.muted, fontSize: font.small, marginBottom: space.md },
  colors: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  swatch: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  swatchOn: { borderWidth: 3, borderColor: colors.head },
}));
