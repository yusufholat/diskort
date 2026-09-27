import { useEffect, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { AVATAR_COLORS, DISPLAY_NAME_MAX_LENGTH } from '@diskort/shared';
import { gateway, api, errorMessage, useGuild, useSession } from '@diskort/client-core';
import { SCREEN_CODECS, SCREEN_PRESETS } from '../../features/voice/screenPresets';
import { voice } from '../../features/voice/voiceClient';
import { bridge, isWindows } from '../../lib/bridge';
import { confirmDialog } from '../../lib/dialog';
import { useEscapeLayer } from '../../lib/escape';
import { usePresenceClosing } from '../../lib/motion';
import { cn } from '../../lib/utils';
import { useSettings, type ScreenCodec, type ScreenPresetId } from '../../stores/settings';
import { toast, useUi, type SettingsSection } from '../../stores/ui';
import { Avatar } from '../ui/Avatar';
import { Button, Divider, Field, SectionTitle, Select, TextInput, Toggle } from '../ui/controls';
import { ChangePassword } from './ChangePassword';
import { DeleteAccount } from './DeleteAccount';
import { KeybindInput } from './KeybindInput';
import { ProfilePhoto } from './ProfilePhoto';
import { VoiceSettings } from './VoiceSettings';

// Üyeler ve davetler Sunucu Ayarları'na taşındı (sunucu adının yanındaki menü)
const SECTIONS: { id: SettingsSection; label: string }[] = [
  { id: 'account', label: 'Hesabım' },
  { id: 'voice', label: 'Ses' },
  { id: 'stream', label: 'Yayın' },
  { id: 'keybinds', label: 'Kısayollar' },
  { id: 'app', label: 'Uygulama' },
];

export function SettingsModal({ initial }: { initial?: SettingsSection }) {
  const close = useUi((s) => s.closeModal);
  const [section, setSection] = useState<SettingsSection>(initial ?? 'account');
  const closing = usePresenceClosing();
  useEscapeLayer(close, !closing);

  const logout = async (): Promise<void> => {
    close();
    await voice.leave();
    gateway.disconnect();
    useSession.getState().logout();
  };

  return (
    <div
      className={cn(
        'fixed inset-x-0 bottom-0 top-[var(--titlebar-h,0px)] z-40 flex bg-bg-main',
        closing ? 'anim-settings-out pointer-events-none' : 'anim-settings-in',
      )}
    >
      <nav className="flex w-[35%] min-w-[220px] justify-end overflow-y-auto bg-bg-side py-14 pr-2">
        <div className="w-[190px]">
          <div className="px-2.5 pb-1.5 text-xs font-bold text-text-muted uppercase">Kullanıcı Ayarları</div>
          {SECTIONS.map((s) => (
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
        {/* Bölüm değişince içerik hafifçe yükselerek belirir */}
        <div key={section} className="anim-rise-in max-w-[660px]">
          {section === 'account' && <AccountSection />}
          {section === 'voice' && <VoiceSettings />}
          {section === 'stream' && <StreamSection />}
          {section === 'keybinds' && <KeybindsSection />}
          {section === 'app' && <AppSection />}
        </div>
        <button
          onClick={close}
          className="group fixed top-14 right-10 flex flex-col items-center gap-1 text-text-muted transition-colors hover:text-text-head"
          aria-label="Kapat"
        >
          <span className="press-icon flex h-9 w-9 items-center justify-center rounded-full border-2 border-current transition-transform group-hover:rotate-90 group-active:scale-90">
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
  // Rolleri, en üstteki önce
  const roleNames = useGuild((s) =>
    (s.users[user?.id ?? '']?.roles ?? [])
      .map((id) => s.roles[id])
      .filter((r) => r !== undefined)
      .sort((a, b) => b.position - a.position)
      .map((r) => r.name)
      .join(', '),
  );
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
          <div className="text-sm text-text-muted">
            @{user.username}
            {roleNames && ` · ${roleNames}`}
          </div>
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
      <ProfilePhoto user={user} />
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
      <Divider />
      <ChangePassword />
      <Divider />
      <DeleteAccount />
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
        Not: seçilen kalite en az o kadar yükleme hızı ister (ör. 1080p60 için ~10 Mbps); yetmezse yayın kendiliğinden düşer. Yayını izleyen her kişi için sunucu bu veriyi ayrıca
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
        description="Pencereyi kapatınca Diskort arka planda çalışmaya ve sesi iletmeye devam eder."
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
