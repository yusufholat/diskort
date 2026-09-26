import { useMemo, useState, type ReactNode } from 'react';
import { Copy, KeyRound, PhoneOff, Shield, ShieldOff, Trash2 } from 'lucide-react';
import type { User } from '@diskort/shared';
import { api, errorMessage, useGuild, useSession } from '@diskort/client-core';
import { cn } from '../../lib/utils';
import { toast } from '../../stores/ui';
import { Avatar } from '../ui/Avatar';

/** Yönetici paneli: üyeler, şifre sıfırlama kodu, yöneticilik, sesten atma, hesap silme. */
export function MembersSection() {
  const users = useGuild((s) => s.users);
  const online = useGuild((s) => s.online);
  const voiceStates = useGuild((s) => s.voiceStates);
  const channels = useGuild((s) => s.channels);
  const selfId = useSession((s) => s.user?.id);
  const [resetCode, setResetCode] = useState<{ user: User; code: string; expiresAt: number } | null>(null);

  const list = useMemo(
    () =>
      Object.values(users).sort(
        (a, b) =>
          Number(Boolean(online[b.id])) - Number(Boolean(online[a.id])) ||
          Number(b.isAdmin) - Number(a.isAdmin) ||
          a.displayName.localeCompare(b.displayName, 'tr'),
      ),
    [users, online],
  );

  const run = async (action: () => Promise<unknown>, success: string): Promise<void> => {
    try {
      await action();
      toast(success, 'success');
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };

  return (
    <div>
      <h2 className="mb-2 text-xl font-bold text-text-head">Üyeler</h2>
      <p className="mb-5 text-sm text-text-muted">
        {list.length} üye · {Object.keys(online).length} çevrimiçi. Şifresini unutan üyeye bir sıfırlama kodu ver; üye giriş
        ekranında “Sıfırlama koduyla yenile” ile yeni şifre belirler.
      </p>

      {resetCode && (
        <div className="mb-4 rounded-md border border-brand/60 bg-brand/10 p-4">
          <div className="text-sm text-text-muted">
            <strong className="text-text-head">{resetCode.user.displayName}</strong> için şifre sıfırlama kodu (tek kullanımlık,{' '}
            {new Date(resetCode.expiresAt).toLocaleString('tr-TR')} tarihine kadar geçerli):
          </div>
          <div className="mt-2 flex items-center gap-3">
            <code className="font-mono text-2xl tracking-widest text-text-head">{resetCode.code}</code>
            <button
              className="flex items-center gap-1.5 rounded bg-bg-hover px-2.5 py-1.5 text-sm hover:bg-bg-active"
              onClick={() => {
                void navigator.clipboard.writeText(resetCode.code);
                toast('Kopyalandı.');
              }}
            >
              <Copy size={14} /> Kopyala
            </button>
          </div>
          <div className="mt-2 text-xs text-text-muted">
            Kullanıcı adı: <strong>@{resetCode.user.username}</strong> — ikisini birlikte gönder.
          </div>
        </div>
      )}

      <div className="flex flex-col gap-1">
        {list.map((u) => {
          const isSelf = u.id === selfId;
          const voice = voiceStates[u.id];
          const channelName = voice ? channels.find((c) => c.id === voice.channelId)?.name : null;
          return (
            <div key={u.id} className="group flex items-center gap-3 rounded-md bg-bg-side px-3 py-2">
              <Avatar user={u} size={36} online={Boolean(online[u.id])} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-semibold text-text-head">{u.displayName}</span>
                  {u.isAdmin && (
                    <span className="rounded bg-brand/25 px-1.5 text-[11px] font-bold text-[#c9cdfb]">YÖNETİCİ</span>
                  )}
                  {isSelf && <span className="text-xs text-text-muted">(sen)</span>}
                </div>
                <div className="truncate text-xs text-text-muted">
                  @{u.username}
                  {channelName && ` · 🔊 ${channelName}`}
                </div>
              </div>

              <div className={cn('flex gap-1', !isSelf && 'opacity-70 group-hover:opacity-100')}>
                <IconAction
                  title="Şifre sıfırlama kodu üret"
                  onClick={() =>
                    void api
                      .createResetCode(u.id)
                      .then((r) => setResetCode({ user: u, ...r }))
                      .catch((err) => toast(errorMessage(err), 'error'))
                  }
                >
                  <KeyRound size={16} />
                </IconAction>
                {!isSelf && (
                  <IconAction
                    title={u.isAdmin ? 'Yöneticiliği kaldır' : 'Yönetici yap'}
                    onClick={() =>
                      void run(
                        () => api.updateUser(u.id, { isAdmin: !u.isAdmin }),
                        u.isAdmin ? `${u.displayName} artık yönetici değil.` : `${u.displayName} yönetici yapıldı.`,
                      )
                    }
                  >
                    {u.isAdmin ? <ShieldOff size={16} /> : <Shield size={16} />}
                  </IconAction>
                )}
                {!isSelf && voice && (
                  <IconAction
                    title="Sesten at"
                    onClick={() => void run(() => api.kickFromVoice(u.id), `${u.displayName} sesten atıldı.`)}
                  >
                    <PhoneOff size={16} />
                  </IconAction>
                )}
                {!isSelf && (
                  <IconAction
                    title="Hesabı sil"
                    danger
                    onClick={() => {
                      if (!window.confirm(`${u.displayName} (@${u.username}) hesabı kalıcı olarak silinsin mi?`)) return;
                      void run(() => api.deleteUser(u.id), `${u.displayName} silindi.`);
                    }}
                  >
                    <Trash2 size={16} />
                  </IconAction>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function IconAction({
  title,
  onClick,
  danger,
  children,
}: {
  title: string;
  onClick: () => void;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      title={title}
      aria-label={title}
      onClick={onClick}
      className={cn(
        'flex h-8 w-8 items-center justify-center rounded text-text-muted transition-colors hover:bg-bg-hover',
        danger ? 'hover:text-danger' : 'hover:text-text-head',
      )}
    >
      {children}
    </button>
  );
}
