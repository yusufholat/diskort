import { useEffect } from 'react';
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
}
