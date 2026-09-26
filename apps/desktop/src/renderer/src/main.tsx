// Ortak çekirdeğin platform ayarı her şeyden önce yapılır (kayıtlı oturum burada yüklenir)
import './platform';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { installTurnPortRewrite } from './features/voice/turnPort';
import { voice } from './features/voice/voiceClient';
import { useGuild, useMessages, useSession } from '@diskort/client-core';
import { useSettings } from './stores/settings';
import { useVoice } from './stores/voice';
import './styles.css';

// Herhangi bir WebRTC bağlantısı kurulmadan önce (bkz. turnPort.ts)
installTurnPortRewrite();

// Yalnızca geliştirme: otomatik testlerin iç duruma erişebilmesi için.
if (import.meta.env.DEV) {
  Object.assign(window, { __diskort: { voice, useVoice, useGuild, useSettings, useMessages, useSession } });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
