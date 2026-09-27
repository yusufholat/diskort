// Masaüstü ve mobil istemcilerin ortak mantığı. Platforma özgü işler (bildirim, ses, pencere,
// depolama) configureClient() ile verilen ClientEnvironment üzerinden yapılır.

export { configureClient } from './configure';
export type { ClientEnvironment, KeyValueStorage, LocalFile, UploadRequest, UploadResponse } from './env';
export { api, ApiError, errorMessage, normalizeServerUrl } from './api';
export { gateway } from './gateway';
export { useSession } from './session';
export { isUnread, membersOf, useGuild, type GatewayStatus } from './guild';
export {
  ackChannel,
  addFiles,
  deleteMessage,
  discardMessage,
  editMessage,
  loadInitial,
  loadOlder,
  mentions,
  notifyTyping,
  removeFile,
  retryMessage,
  sendMessage,
  setEditing,
  toggleReaction,
  uploadProgress,
  useMessages,
  type ChannelMessages,
  type LocalMessage,
  type LocalUpload,
} from './messages';
export { attachmentUrl, avatarUrl, formatBytes, removeAvatar, uploadAvatar } from './uploads';
export { EMOJI_CATEGORIES, QUICK_REACTIONS, type EmojiCategory } from './emoji';
export { parseInline, parseMarkdown, type MdBlock, type MdInline, type MdStyle } from './markdown';
