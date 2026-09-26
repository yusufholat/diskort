export type VoiceServiceAction = 'toggleMute' | 'disconnect';

export type VoiceServiceModuleEvents = {
  onAction: (params: { action: VoiceServiceAction }) => void;
};
