import { useEffect } from 'react';
import { AuthScreen } from './components/AuthScreen';
import { ContextMenu } from './components/ContextMenu';
import { EmojiPicker } from './components/EmojiPicker';
import { MainLayout } from './components/MainLayout';
import { TitleBar } from './components/TitleBar';
import { Toasts } from './components/Toasts';
import { UpdateRequired } from './components/UpdateRequired';
import { useDesktopIntegration } from './features/desktop/useDesktopIntegration';
import { bridge, isMac, isWindows } from './lib/bridge';
import { useSession } from '@diskort/client-core';
import { useUpdate } from './stores/update';

const hasTitleBar = Boolean(bridge) && (isWindows || isMac);

export function App() {
  const token = useSession((s) => s.token);
  const requiredVersion = useUpdate((s) => s.required);
  useDesktopIntegration();

  useEffect(() => {
    document.documentElement.style.setProperty('--titlebar-h', hasTitleBar ? '30px' : '0px');
    // Uygulama içinde varsayılan sağ tık menüsünü kapat (metin alanları hariç).
    const onContextMenu = (e: MouseEvent): void => {
      const target = e.target as HTMLElement;
      if (!target.closest('input, textarea')) e.preventDefault();
    };
    window.addEventListener('contextmenu', onContextMenu);
    return () => window.removeEventListener('contextmenu', onContextMenu);
  }, []);

  return (
    <div className="flex h-full flex-col">
      <TitleBar />
      <div className="min-h-0 flex-1">
        {requiredVersion ? (
          <UpdateRequired version={requiredVersion} />
        ) : token ? (
          <MainLayout />
        ) : (
          <AuthScreen />
        )}
      </div>
      <ContextMenu />
      <EmojiPicker />
      <Toasts />
    </div>
  );
}
