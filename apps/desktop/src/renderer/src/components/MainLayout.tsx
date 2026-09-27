import { useEffect } from 'react';
import { AudioLines } from 'lucide-react';
import { gateway, useGuild, useSession } from '@diskort/client-core';
import { voice } from '../features/voice/voiceClient';
import { toast, useUi } from '../stores/ui';
import { useVoice } from '../stores/voice';
import { useMainView } from '../lib/mainView';
import { DURATION, PresenceProvider, usePresence } from '../lib/motion';
import { ImageViewer } from './text/ImageViewer';
import { TextChannelView } from './text/TextChannelView';
import { UpdateReadyBar } from './UpdateRequired';
import { ChannelSidebar } from './sidebar/ChannelSidebar';
import { GuildRail } from './GuildRail';
import { VoiceStage } from './stage/VoiceStage';
import { Welcome } from './stage/Welcome';
import { BanModal } from './modals/BanModal';
import { ChannelModal } from './modals/ChannelModal';
import { ScreenSharePicker } from './modals/ScreenSharePicker';
import { ServerSettingsModal } from './serverSettings/ServerSettingsModal';
import { SettingsModal } from './settings/SettingsModal';
import { FeedbackModal } from './feedback/FeedbackModal';
import { useFeedbackToasts } from '../features/feedback/useFeedbackToasts';

export function MainLayout() {
  const token = useSession((s) => s.token);
  const status = useGuild((s) => s.status);
  const hasGuild = useGuild((s) => s.guild !== null);
  const view = useMainView();
  const textChannel = useGuild((s) =>
    view.kind === 'text' ? s.channels.find((c) => c.id === view.channelId) : undefined,
  );
  const voiceError = useVoice((s) => s.error);
  useFeedbackToasts();
  // Kapanan pencere, kapanış animasyonu bitene kadar ekranda kalır
  const { value: modal, closing: modalClosing } = usePresence(
    useUi((s) => s.modal),
    DURATION.base,
  );

  useEffect(() => {
    gateway.connect();
    return () => {
      void voice.leave();
      gateway.disconnect();
    };
  }, [token]);

  useEffect(() => {
    if (!voiceError) return;
    toast(voiceError, 'error');
    voice.clearError();
  }, [voiceError]);

  if (!hasGuild) {
    return (
      <div className="anim-fade-in flex h-full flex-col items-center justify-center gap-4 bg-bg-main text-text-muted">
        <AudioLines size={48} className="animate-pulse text-brand" />
        <div>{status === 'reconnecting' ? 'Sunucuya ulaşılamıyor, tekrar deneniyor…' : 'Bağlanıyor…'}</div>
        <button
          className="text-sm text-[#00a8fc] hover:underline"
          onClick={() => {
            gateway.disconnect();
            useSession.getState().logout();
          }}
        >
          Çıkış yap
        </button>
      </div>
    );
  }

  return (
    <div className="relative flex h-full min-h-0">
      <GuildRail />
      <ChannelSidebar />
      <main className="flex min-w-0 flex-1 flex-col">
        <UpdateReadyBar />
        {status === 'reconnecting' && (
          <div className="anim-bar-in bg-warn px-4 py-1 text-center text-sm font-medium text-black">
            Sunucu bağlantısı koptu, yeniden bağlanılıyor…
          </div>
        )}
        {/* Kanal/görünüm değişince yeni içerik hafifçe belirir */}
        <div className="min-h-0 flex-1 bg-bg-main">
          {view.kind === 'voice' ? (
            <div key="voice" className="anim-fade-in h-full">
              <VoiceStage />
            </div>
          ) : textChannel ? (
            <TextChannelView key={textChannel.id} channel={textChannel} />
          ) : (
            <div key="home" className="anim-fade-in h-full">
              <Welcome />
            </div>
          )}
        </div>
      </main>

      <PresenceProvider value={modalClosing}>
        {modal?.type === 'settings' && <SettingsModal initial={modal.section} />}
        {modal?.type === 'serverSettings' && <ServerSettingsModal initial={modal.section} />}
        {modal?.type === 'screenPicker' && <ScreenSharePicker />}
        {modal?.type === 'channel' && <ChannelModal channel={modal.channel} channelType={modal.channelType} />}
        {modal?.type === 'image' && <ImageViewer attachment={modal.attachment} />}
        {modal?.type === 'feedback' && <FeedbackModal />}
      </PresenceProvider>
      <BanModal />
    </div>
  );
}
