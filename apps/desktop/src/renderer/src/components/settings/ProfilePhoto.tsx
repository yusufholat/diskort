import { useRef, useState } from 'react';
import { Camera } from 'lucide-react';
import type { User } from '@diskort/shared';
import { errorMessage, formatBytes, removeAvatar, uploadAvatar } from '@diskort/client-core';
import { confirmDialog } from '../../lib/dialog';
import { PresenceProvider, usePresence } from '../../lib/motion';
import { toast } from '../../stores/ui';
import { Avatar } from '../ui/Avatar';
import { Button, SectionTitle } from '../ui/controls';
import { AvatarCropper } from './AvatarCropper';

const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif';
/** Tarayıcıda açılıp kırpılacak resmin en büyük boyutu (sunucuya kırpılmış küçük kopya gider) */
const MAX_SOURCE_BYTES = 50 * 1024 * 1024;

/** Hesabım → Profil Fotoğrafı: seçilen resim kırpılıp yüklenir; kaldırılınca baş harfler görünür. */
export function ProfilePhoto({ user }: { user: User }) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [removing, setRemoving] = useState(false);
  const cropper = usePresence(file);
  const pick = (): void => input.current?.click();

  const save = async (image: Blob): Promise<void> => {
    try {
      await uploadAvatar({ name: 'profil.png', size: image.size, type: image.type, blob: image });
      setFile(null);
      toast('Profil fotoğrafı güncellendi.', 'success');
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };

  const remove = async (): Promise<void> => {
    const ok = await confirmDialog({
      title: 'Profil fotoğrafı kaldırılsın mı?',
      message: 'Fotoğrafının yerine yeniden baş harflerin görünür.',
      confirmLabel: 'Kaldır',
      danger: true,
    });
    if (!ok) return;
    setRemoving(true);
    try {
      await removeAvatar();
      toast('Profil fotoğrafı kaldırıldı.', 'success');
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setRemoving(false);
    }
  };

  return (
    <div>
      <SectionTitle>Profil Fotoğrafı</SectionTitle>
      <div className="flex items-center gap-4">
        <button
          type="button"
          className="press-icon group relative shrink-0 rounded-full"
          onClick={pick}
          data-tooltip={user.avatarUrl ? 'Profil fotoğrafını değiştir' : 'Profil fotoğrafı yükle'}
          aria-label={user.avatarUrl ? 'Profil fotoğrafını değiştir' : 'Profil fotoğrafı yükle'}
        >
          <Avatar user={user} size={56} />
          <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/55 text-white opacity-0 transition-opacity group-hover:opacity-100">
            <Camera size={20} className="scale-75 transition-transform duration-200 ease-(--ease-hov) group-hover:scale-100" />
          </span>
        </button>
        <div className="flex gap-2">
          <Button type="button" onClick={pick}>
            {user.avatarUrl ? 'Fotoğrafı Değiştir' : 'Fotoğraf Yükle'}
          </Button>
          {user.avatarUrl && (
            <Button type="button" variant="secondary" disabled={removing} onClick={() => void remove()}>
              Kaldır
            </Button>
          )}
        </div>
      </div>
      <p className="mt-2 text-xs text-text-muted">
        PNG, JPEG, WebP ya da GIF. Fotoğraf yokken baş harflerin aşağıdaki renkle gösterilir.
      </p>
      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        hidden
        onChange={(e) => {
          const picked = e.target.files?.[0];
          e.target.value = ''; // aynı dosya yeniden seçilebilsin
          if (!picked) return;
          if (picked.size > MAX_SOURCE_BYTES) {
            toast(`Resim çok büyük (en fazla ${formatBytes(MAX_SOURCE_BYTES)}).`, 'error');
            return;
          }
          setFile(picked);
        }}
      />
      {/* Kırpma penceresi kapanırken de animasyonla kaybolur */}
      <PresenceProvider value={cropper.closing}>
        {cropper.value && <AvatarCropper file={cropper.value} onCancel={() => setFile(null)} onSave={save} />}
      </PresenceProvider>
    </div>
  );
}
