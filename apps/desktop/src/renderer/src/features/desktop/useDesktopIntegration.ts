import { useEffect } from 'react';
import { gateway } from '@diskort/client-core';
import { bridge } from '../../lib/bridge';
import { useSettings } from '../../stores/settings';
import { toast } from '../../stores/ui';
import { useUpdate } from '../../stores/update';
import { useVoice } from '../../stores/voice';
import { voice } from '../voice/voiceClient';

/** Electron ana süreciyle entegrasyon: global kısayollar, tepsi menüsü, tercihler, güncellemeler. */
export function useDesktopIntegration(): void {
  // Otomatik "Boşta": ana süreç girdi yokluğunu ve ekran kilidini izler, sunucuya iletilir (elle seçilen
  // durum değişmez; başka bir cihazda etkinsen "Çevrim içi" kalırsın)
  useEffect(() => {
    const idle = bridge?.idle;
    if (!idle) return;
    void idle.get().then((value) => gateway.setIdle(value), () => undefined);
    return idle.onChange((value) => gateway.setIdle(value));
  }, []);

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

  // Dosya indirmeleri
  useEffect(() => {
    if (!bridge) return;
    return bridge.onDownloadDone(({ name, ok }) =>
      toast(ok ? `İndirildi: ${name}` : `İndirilemedi: ${name}`, ok ? 'success' : 'error'),
    );
  }, []);

  // Güncelleyici durumu (arka planda indirme, "hazır" şeridi, zorunlu güncelleme ekranı)
  useEffect(() => {
    if (!bridge) return;
    void bridge.updates.getState().then((state) => useUpdate.setState({ state }));
    return bridge.updates.onState((state) => useUpdate.setState({ state }));
  }, []);
}
