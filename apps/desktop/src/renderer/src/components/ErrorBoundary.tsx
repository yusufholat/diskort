import { Component, type ReactNode } from 'react';
import { reportClientError } from '@diskort/client-core';

interface Props {
  /** Hata olunca çizilecek yer tutucu */
  fallback: ReactNode;
  /** Sunucu kayıtlarında hatanın yeri */
  where: string;
  /** Değişince (ör. mesaj düzenlenince) yeniden denenir */
  resetKey?: unknown;
  children: ReactNode;
}

interface State {
  failed: boolean;
  resetKey: unknown;
}

/**
 * Çizim sırasında fırlatılan hatayı yakalar: tüm arayüz beyaz ekrana dönmek yerine yalnızca bu parçanın
 * yerine `fallback` çizilir ve hata sunucu kayıtlarına bildirilir.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false, resetKey: this.props.resetKey };

  static getDerivedStateFromError(): Partial<State> {
    return { failed: true };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    // Veri değişti: yeniden dene
    return props.resetKey !== state.resetKey ? { failed: false, resetKey: props.resetKey } : null;
  }

  componentDidCatch(error: unknown): void {
    reportClientError(error, this.props.where);
  }

  render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/** Uygulamanın tamamı çizilemedi: yeniden yükleme önerilir. */
export function AppCrashScreen() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 bg-bg-rail p-8 text-center">
      <h1 className="text-xl font-bold text-text-head">Bir şeyler ters gitti</h1>
      <p className="max-w-sm text-sm text-text-muted">Hata bildirildi, en kısa sürede düzeltilecek.</p>
      <button
        className="mt-2 rounded bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover"
        onClick={() => window.location.reload()}
      >
        Yeniden yükle
      </button>
    </div>
  );
}

/** Tek bir mesaj çizilemedi: kanalın geri kalanı çalışmaya devam eder. */
export function BrokenMessage() {
  return <div className="px-4 py-1 pl-[72px] text-sm text-text-muted italic">Bu mesaj gösterilemedi</div>;
}
