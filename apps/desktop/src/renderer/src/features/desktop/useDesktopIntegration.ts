import { useEffect } from 'react';
import { normalizeServerUrl } from '../../lib/api';
import { bridge } from '../../lib/bridge';
import { useSettings } from '../../stores/settings';
import { toast } from '../../stores/ui';
import { useVoice } from '../../stores/voice';
import { voice } from '../voice/voiceClient';

/** Electron ana süreciyle entegrasyon: global kısayollar, tepsi menüsü, tercihler, güncellemeler. */
export function useDesktopIntegration(): void {
  // Global kısayol olayları → ses motoru
  useEffect(() => {
    if (!bridge) return;
    return bridge.hotkeys.onEvent((event) => {
      if (event.action === 'pushToTalk') voice.setPushToTalk(event.pressed);
      else if (event.action === 'toggleMute') voice.toggleMute();
      else voice.toggleDeafen();
    });
  }, []);

  // Kısayol atamalarını ana sürece bildir (bas-konuş yalnızca PTT modunda dinlenir)
  const hotkeys = useSettings((s) => s.hotkeys);
  const inputMode = useSettings((s) => s.inputMode);
  useEffect(() => {
    void bridge?.hotkeys.set({ ...hotkeys, pushToTalk: inputMode === 'ptt' ? hotkeys.pushToTalk : null });
  }, [hotkeys, inputMode]);

  // Uygulama tercihleri
  const minimizeToTray = useSettings((s) => s.minimizeToTray);
  const openAtLogin = useSettings((s) => s.openAtLogin);
  useEffect(() => {
    void bridge?.setPreferences({ minimizeToTray, openAtLogin });
  }, [minimizeToTray, openAtLogin]);

  // Tepsi menüsü durumu ve eylemleri
  const selfMute = useSettings((s) => s.selfMute);
  const selfDeaf = useSettings((s) => s.selfDeaf);
  const connected = useVoice((s) => s.status !== 'idle');
  useEffect(() => {
    bridge?.setTrayState({ connected, muted: selfMute || selfDeaf, deafened: selfDeaf });
  }, [connected, selfMute, selfDeaf]);

  useEffect(() => {
    if (!bridge) return;
    return bridge.onTrayAction((action) => {
      if (action === 'toggleMute') voice.toggleMute();
      else if (action === 'toggleDeafen') voice.toggleDeafen();
      else void voice.leave();
    });
  }, []);

  // Güncelleme hazır
  useEffect(() => {
    if (!bridge) return;
    return bridge.updates.onReady((version) => {
      toast(`Diskort ${version} indirildi; uygulamayı yeniden başlatınca kurulacak.`, 'success');
    });
  }, []);

  // macOS'ta kendi kendine güncelleme yok: yeni sürüm varsa indirme sayfasını öner
  useEffect(() => {
    if (!bridge || bridge.platform !== 'darwin') return;
    const serverUrl = normalizeServerUrl(useSettings.getState().serverUrl);
    void Promise.all([bridge.getVersion(), fetch(`${serverUrl}/api/download/latest`).then((r) => r.json())])
      .then(([current, latest]: [string, { version?: string }]) => {
        if (latest.version && isNewer(latest.version, current)) {
          toast(`Diskort ${latest.version} yayınlandı. ${serverUrl}/download adresinden indirip kurabilirsin.`);
        }
      })
      .catch(() => undefined);
  }, []);
}

function isNewer(candidate: string, current: string): boolean {
  const a = candidate.split('.').map(Number);
  const b = current.split('.').map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return false;
}
