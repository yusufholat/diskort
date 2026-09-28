import { Component, type ReactNode } from 'react';
import { Text } from 'react-native';
import { reportClientError } from '@diskort/client-core';
import { colors, createStyles } from '../theme';

interface Props {
  /** Değişince (ör. mesaj düzenlenince) yeniden denenir */
  resetKey: unknown;
  children: ReactNode;
}

interface State {
  failed: boolean;
  resetKey: unknown;
}

/**
 * Tek bir mesaj satırının çizim hatasını yakalar: bozuk veri (ör. hatalı bağlantı önizlemesi) tüm sohbeti
 * hata ekranına düşürmek yerine yalnızca o satırın yerine kısa bir not gösterir ve hata bildirilir.
 * Ekranın tamamı için _layout.tsx'teki ErrorBoundary vardır.
 */
export class MessageErrorBoundary extends Component<Props, State> {
  state: State = { failed: false, resetKey: this.props.resetKey };

  static getDerivedStateFromError(): Partial<State> {
    return { failed: true };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    // Veri değişti: yeniden dene
    return props.resetKey !== state.resetKey ? { failed: false, resetKey: props.resetKey } : null;
  }

  componentDidCatch(error: unknown): void {
    reportClientError(error, 'mesaj');
  }

  render(): ReactNode {
    return this.state.failed ? <Text style={styles.text}>Bu mesaj gösterilemedi</Text> : this.props.children;
  }
}

const styles = createStyles(() => ({
  text: { color: colors.muted, fontSize: 14, fontStyle: 'italic', paddingVertical: 4, paddingLeft: 64, paddingRight: 14 },
}));
