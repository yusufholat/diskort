import { useEffect, useState, type ReactNode } from 'react';
import { Copy, Trash2, X } from 'lucide-react';
import { AVATAR_COLORS, DISPLAY_NAME_MAX_LENGTH, type Invite } from '@diskurt/shared';
import { gateway } from '../../features/gateway/gateway';
import { SCREEN_CODECS, SCREEN_PRESETS } from '../../features/voice/screenPresets';
import { voice } from '../../features/voice/voiceClient';
import { api, errorMessage } from '../../lib/api';
import { bridge, isWindows } from '../../lib/bridge';
import { cn } from '../../lib/utils';
import { useSession } from '../../stores/session';
import { useSettings, type ScreenCodec, type ScreenPresetId } from '../../stores/settings';
import { toast, useUi, type SettingsSection } from '../../stores/ui';
import { Avatar } from '../ui/Avatar';
import { Button, Divider, Field, SectionTitle, Select, TextInput, Toggle } from '../ui/controls';
import { KeybindInput } from './KeybindInput';
import { VoiceSettings } from './VoiceSettings';

const SECTIONS: { id: SettingsSection; label: string; admin?: boolean }[] = [
  { id: 'account', label: 'Hesabım' },
  { id: 'voice', label: 'Ses' },
  { id: 'stream', label: 'Yayın' },
  { id: 'keybinds', label: 'Kısayollar' },
  { id: 'app', label: 'Uygulama' },
  { id: 'invites', label: 'Davetler', admin: true },
];

export function SettingsModal({ initial }: { initial?: SettingsSection }) {
  const close = useUi((s) => s.closeModal);
  const isAdmin = useSession((s) => s.user?.isAdmin ?? false);
  const [section, setSection] = useState<SettingsSection>(initial ?? 'account');

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  const logout = async (): Promise<void> => {
    close();
    await voice.leave();
    gateway.disconnect();
    useSession.getState().logout();
  };

  return (
    <div className="animate-pop fixed inset-x-0 bottom-0 top-[var(--titlebar-h,0px)] z-40 flex bg-bg-main">
      <nav className="flex w-[35%] min-w-[220px] justify-end overflow-y-auto bg-bg-side py-14 pr-2">
        <div className="w-[190px]">
          <div className="px-2.5 pb-1.5 text-xs font-bold text-text-muted uppercase">Kullanıcı Ayarları</div>
          {SECTIONS.filter((s) => !s.admin || isAdmin).map((s) => (
            <NavItem key={s.id} active={section === s.id} onClick={() => setSection(s.id)}>
              {s.label}
            </NavItem>
          ))}
          <div className="mx-2.5 my-2 h-px bg-line" />
          <NavItem onClick={() => void logout()} danger>
            Çıkış Yap
          </NavItem>
        </div>
      </nav>
      <main className="relative flex-1 overflow-y-auto py-14 pr-10 pl-10">
        <div className="max-w-[660px]">
          {section === 'account' && <AccountSection />}
          {section === 'voice' && <VoiceSettings />}
          {section === 'stream' && <StreamSection />}
          {section === 'keybinds' && <KeybindsSection />}
          {section === 'app' && <AppSection />}
          {section === 'invites' && isAdmin && <InvitesSection />}
        </div>
        <button
          onClick={close}
          className="fixed top-14 right-10 flex flex-col items-center gap-1 text-text-muted hover:text-text-head"
          aria-label="Kapat"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-current">
            <X size={20} />
          </span>
          <span className="text-xs font-semibold">ESC</span>
        </button>
      </main>
    </div>
  );
}

function NavItem({
  active,
  onClick,
  danger,
  children,
}: {
  active?: boolean;
  onClick: () => void;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'mb-0.5 block w-full rounded px-2.5 py-1.5 text-left font-medium transition-colors',
        active ? 'bg-bg-active text-text-head' : 'text-text-muted hover:bg-bg-hover hover:text-text-normal',
        danger && 'text-danger hover:text-danger',
      )}
    >
      {children}
    </button>
  );
}

function AccountSection() {
  const user = useSession((s) => s.user);
  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [busy, setBusy] = useState(false);

  const save = async (patch: { displayName?: string; avatarColor?: string }): Promise<void> => {
    setBusy(true);
    try {
      const updated = await api.updateMe(patch);
      useSession.getState().setUser(updated);
      toast('Kaydedildi.', 'success');
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  if (!user) return null;
  return (
    <div>
      <h2 className="mb-5 text-xl font-bold text-text-head">Hesabım</h2>
      <div className="mb-6 flex items-center gap-4 rounded-lg bg-bg-rail p-4">
        <Avatar user={user} size={72} />
        <div>
          <div className="text-lg font-semibold text-text-head">{user.displayName}</div>
          <div className="text-sm text-text-muted">@{user.username}{user.isAdmin && ' · Yönetici'}</div>
        </div>
      </div>
      <Field label="Görünen ad">
        <div className="flex gap-2">
          <TextInput
            value={displayName}
            maxLength={DISPLAY_NAME_MAX_LENGTH}
            onChange={(e) => setDisplayName(e.target.value)}
          />
          <Button
            disabled={busy || !displayName.trim() || displayName === user.displayName}
            onClick={() => void save({ displayName })}
          >
            Kaydet
          </Button>
        </div>
      </Field>
      <SectionTitle>Profil Rengi</SectionTitle>
      <div className="flex flex-wrap gap-2">
        {AVATAR_COLORS.map((color) => (
          <button
            key={color}
            disabled={busy}
            onClick={() => void save({ avatarColor: color })}
            className={cn(
              'h-10 w-10 rounded-full transition-transform hover:scale-110',
              user.avatarColor === color && 'ring-2 ring-white ring-offset-2 ring-offset-bg-main',
            )}
            style={{ background: color }}
            aria-label={color}
          />
        ))}
      </div>
    </div>
  );
}

function StreamSection() {
  const s = useSettings();
  return (
    <div>
      <h2 className="mb-5 text-xl font-bold text-text-head">Yayın (Ekran Paylaşımı)</h2>
      <Field label="Varsayılan kalite">
        <Select<ScreenPresetId>
          value={s.screenPreset}
          onChange={(screenPreset) => s.set({ screenPreset })}
          options={Object.entries(SCREEN_PRESETS).map(([value, p]) => ({
            value: value as ScreenPresetId,
            label: `${p.label} (~${(p.bitrate / 1_000_000).toFixed(1)} Mbps)`,
          }))}
        />
      </Field>
      <Field label="Video kodeği">
        <Select<ScreenCodec>
          value={s.screenCodec}
          onChange={(screenCodec) => s.set({ screenCodec })}
          options={Object.entries(SCREEN_CODECS).map(([value, label]) => ({ value: value as ScreenCodec, label }))}
        />
      </Field>
      <Field label="İçerik türü">
        <Select
          value={s.screenContent}
          onChange={(screenContent) => s.set({ screenContent })}
          options={[
            { value: 'motion', label: 'Oyun / Video — akıcılık öncelikli' },
            { value: 'detail', label: 'Metin / Kod — netlik öncelikli' },
          ]}
        />
      </Field>
      <Toggle
        label="Sistem sesini paylaş"
        description={
          isWindows
            ? 'Yayına oyun/video sesi eklenir; sohbetteki sesler otomatik hariç tutulur.'
            : 'Sistem sesi paylaşımı şimdilik yalnızca Windows’ta destekleniyor.'
        }
        checked={s.shareAudio && isWindows}
        disabled={!isWindows}
        onChange={(shareAudio) => s.set({ shareAudio })}
      />
      <p className="mt-4 text-sm text-text-muted">
        Not: 1080p60 yayın ~7 Mbps yükleme hızı gerektirir. Yayını izleyen her kişi için sunucu bu veriyi ayrıca
        gönderir; izlemeyenlere hiç video gitmez.
      </p>
    </div>
  );
}

function KeybindsSection() {
  const hotkeys = useSettings((s) => s.hotkeys);
  const inputMode = useSettings((s) => s.inputMode);
  const set = useSettings((s) => s.set);
  const [available, setAvailable] = useState(true);

  useEffect(() => {
    void bridge?.hotkeys.available().then(setAvailable);
  }, []);

  return (
    <div>
      <h2 className="mb-2 text-xl font-bold text-text-head">Kısayollar</h2>
      <p className="mb-5 text-sm text-text-muted">
        Kısayollar uygulama arka plandayken (ör. oyun oynarken) de çalışır. Fare yan tuşları da atanabilir.
      </p>
      {(!bridge || !available) && (
        <div className="mb-4 rounded bg-warn/15 px-3 py-2 text-sm text-warn">
          Global kısayollar bu sistemde kullanılamıyor (ör. Linux Wayland).
        </div>
      )}
      <Field label="Susturmayı aç/kapat">
        <KeybindInput value={hotkeys.toggleMute} onChange={(toggleMute) => set({ hotkeys: { ...hotkeys, toggleMute } })} />
      </Field>
      <Field label="Sağırlaştırmayı aç/kapat">
        <KeybindInput
          value={hotkeys.toggleDeafen}
          onChange={(toggleDeafen) => set({ hotkeys: { ...hotkeys, toggleDeafen } })}
        />
      </Field>
      <Field label="Bas-konuş">
        <KeybindInput value={hotkeys.pushToTalk} onChange={(pushToTalk) => set({ hotkeys: { ...hotkeys, pushToTalk } })} />
      </Field>
      {inputMode !== 'ptt' && (
        <p className="text-xs text-text-muted">Bas-konuş tuşu yalnızca Ses ayarlarında giriş modu “Bas-Konuş” iken etkindir.</p>
      )}
    </div>
  );
}

function AppSection() {
  const s = useSettings();
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    void bridge?.getVersion().then(setVersion);
  }, []);

  return (
    <div>
      <h2 className="mb-5 text-xl font-bold text-text-head">Uygulama</h2>
      <Toggle
        label="Kapatınca sistem tepsisine küçült"
        description="Pencereyi kapatınca Diskurt arka planda çalışmaya ve sesi iletmeye devam eder."
        checked={s.minimizeToTray}
        disabled={!bridge}
        onChange={(minimizeToTray) => s.set({ minimizeToTray })}
      />
      <Toggle
        label="Bilgisayar açılınca başlat"
        checked={s.openAtLogin}
        disabled={!bridge || bridge.platform === 'linux'}
        onChange={(openAtLogin) => s.set({ openAtLogin })}
      />
      <Divider />
      <div className="text-sm text-text-muted">
        <div>
          Sunucu: <span className="text-text-normal">{s.serverUrl}</span>
        </div>
        <div className="mt-1">Sürüm: {version ?? 'web'}</div>
      </div>
    </div>
  );
}

function InvitesSection() {
  const [invites, setInvites] = useState<Invite[]>([]);
  const [maxUses, setMaxUses] = useState<number>(1);
  const [expires, setExpires] = useState<number>(168);
  const [busy, setBusy] = useState(false);

  const load = (): void => {
    api.listInvites().then(setInvites).catch((err) => toast(errorMessage(err), 'error'));
  };
  useEffect(load, []);

  const create = async (): Promise<void> => {
    setBusy(true);
    try {
      const invite = await api.createInvite({
        maxUses: maxUses === 0 ? null : maxUses,
        expiresInHours: expires === 0 ? null : expires,
      });
      await navigator.clipboard.writeText(invite.code).catch(() => undefined);
      toast(`Davet kodu oluşturuldu ve kopyalandı: ${invite.code}`, 'success');
      load();
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <h2 className="mb-2 text-xl font-bold text-text-head">Davetler</h2>
      <p className="mb-5 text-sm text-text-muted">
        Arkadaşların uygulamada “Davet koduyla kaydol” seçeneğiyle bu kodu kullanarak hesap açar.
      </p>
      <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-3">
        <Field label="Kullanım hakkı">
          <Select
            value={maxUses}
            onChange={setMaxUses}
            options={[
              { value: 1, label: '1 kişi' },
              { value: 5, label: '5 kişi' },
              { value: 10, label: '10 kişi' },
              { value: 25, label: '25 kişi' },
              { value: 0, label: 'Sınırsız' },
            ]}
          />
        </Field>
        <Field label="Geçerlilik">
          <Select
            value={expires}
            onChange={setExpires}
            options={[
              { value: 1, label: '1 saat' },
              { value: 24, label: '1 gün' },
              { value: 168, label: '7 gün' },
              { value: 0, label: 'Süresiz' },
            ]}
          />
        </Field>
        <div className="mb-4">
          <Button disabled={busy} onClick={() => void create()}>
            Davet Oluştur
          </Button>
        </div>
      </div>

      <SectionTitle>Aktif Davetler</SectionTitle>
      <div className="flex flex-col gap-1">
        {invites.length === 0 && <div className="text-sm text-text-muted">Henüz davet yok.</div>}
        {invites.map((inv) => {
          const expired = inv.expiresAt !== null && inv.expiresAt < Date.now();
          const used = inv.maxUses !== null && inv.uses >= inv.maxUses;
          return (
            <div key={inv.code} className="flex items-center gap-3 rounded bg-bg-side px-3 py-2">
              <code className={cn('font-mono text-base text-text-head', (expired || used) && 'line-through opacity-50')}>
                {inv.code}
              </code>
              <span className="flex-1 text-xs text-text-muted">
                {inv.uses}/{inv.maxUses ?? '∞'} kullanım ·{' '}
                {inv.expiresAt ? `${new Date(inv.expiresAt).toLocaleString('tr-TR')} tarihine kadar` : 'süresiz'}
              </span>
              <button
                title="Kopyala"
                className="rounded p-1.5 text-text-muted hover:bg-bg-hover hover:text-text-head"
                onClick={() => {
                  void navigator.clipboard.writeText(inv.code);
                  toast('Kopyalandı.');
                }}
              >
                <Copy size={16} />
              </button>
              <button
                title="Sil"
                className="rounded p-1.5 text-text-muted hover:bg-bg-hover hover:text-danger"
                onClick={() => api.deleteInvite(inv.code).then(load).catch((err) => toast(errorMessage(err), 'error'))}
              >
                <Trash2 size={16} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
