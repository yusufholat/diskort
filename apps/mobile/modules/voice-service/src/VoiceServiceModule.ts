import { NativeModule, requireNativeModule } from 'expo';
import type { VoiceServiceModuleEvents } from './VoiceService.types';

/** Android ön plan servisi: sesli sohbet sürerken uygulamayı arka planda canlı tutar. */
declare class VoiceServiceModule extends NativeModule<VoiceServiceModuleEvents> {
  start(title: string, text: string, muted: boolean): void;
  update(title: string, text: string, muted: boolean): void;
  stop(): void;
}

export default requireNativeModule<VoiceServiceModule>('VoiceService');
