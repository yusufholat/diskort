// Masaüstü ve mobil istemcilerin ortak mantığı. Platforma özgü işler (bildirim, ses, pencere,
// depolama) configureClient() ile verilen ClientEnvironment üzerinden yapılır.

export { configureClient } from './configure';
export type { ClientEnvironment, KeyValueStorage, LocalFile, UploadRequest, UploadResponse } from './env';
export { api, ApiError, errorMessage, normalizeServerUrl } from './api';
export { recentClientErrors, reportClientError } from './errors';
export {
  baseFeedbackContext,
  canManageFeedback,
  deleteFeedback,
  feedbackApi,
  feedbackImageHeaders,
  feedbackScreenshotUrl,
  fetchFeedbackScreenshot,
  loadAllFeedback,
  loadMyFeedback,
  onOwnFeedbackUpdate,
  refreshFeedbackCount,
  submitFeedback,
  updateFeedback,
  useFeedback,
  type FeedbackDraft,
} from './feedback';
export { reportVoiceLog, SpuriousDuplicateGuard } from './voiceDiagnostics';
export { gateway } from './gateway';
export { useSession } from './session';
export { isUnread, membersOf, useGuild, type GatewayStatus, type GuildStore } from './guild';
export {
  can,
  canAssignRole,
  canManageRole,
  isOwner,
  memberColorOf,
  memberGroups,
  outranksUser,
  overwriteState,
  permissionsOf,
  roleIsBelowFor,
  rolesOf,
  setOverwriteState,
  sortedRoles,
  useCan,
  useMemberColor,
  usePermissions,
  type MemberGroup,
  type OverwriteState,
} from './permissions';
export {
  channelPermissionInfos,
  PERMISSION_GROUPS,
  permissionInfo,
  type PermissionGroup,
  type PermissionInfo,
} from './permissionInfo';
export { memberActions, moderation, moveTargets, type MemberActions } from './moderation';
export {
  ackChannel,
  addFiles,
  deleteMessage,
  discardMessage,
  editMessage,
  isMentioned,
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
