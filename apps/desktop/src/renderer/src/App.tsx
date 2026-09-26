import { useEffect } from 'react';
import { AuthScreen } from './components/AuthScreen';
import { ContextMenu } from './components/ContextMenu';
import { MainLayout } from './components/MainLayout';
import { TitleBar } from './components/TitleBar';
import { Toasts } from './components/Toasts';
import { useDesktopIntegration } from './features/desktop/useDesktopIntegration';
import { bridge, isMac, isWindows } from './lib/bridge';
import { useSession } from './stores/session';

const hasTitleBar = Boolean(bridge) && (isWindows || isMac);

export function App() {
  const token = useSession((s) => s.token);
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
      <div className="min-h-0 flex-1">{token ? <MainLayout /> : <AuthScreen />}</div>
      <ContextMenu />
      <Toasts />
    </div>
  );
}
