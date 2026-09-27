// Masaüstü ve mobil istemcilerin ortak mantığı. Platforma özgü işler (bildirim, ses, pencere,
// depolama) configureClient() ile verilen ClientEnvironment üzerinden yapılır.

export { configureClient } from './configure';
export type { ClientEnvironment, KeyValueStorage, LocalFile, UploadRequest, UploadResponse } from './env';
export { api, ApiError, errorMessage, normalizeServerUrl } from './api';
export { recentClientErrors, reportClientError } from './errors';
export { parseReleaseNotes, type NoteBlock, type NotePart } from './releaseNotes';
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
  sendGif,
  sendMessage,
  setEditing,
  toggleReaction,
  uploadProgress,
  useMessages,
  type ChannelMessages,
  type JumpRequest,
  type LocalMessage,
  type LocalUpload,
  type ReplyDraft,
} from './messages';
export {
  cancelReply,
  clearJump,
  isOwnReplyTarget,
  jumpToMessage,
  setReplyMention,
  startReply,
} from './replies';
export {
  focusComposer,
  hasComposer,
  insertText,
  mentionInComposer,
  registerComposer,
  type ComposerHandle,
} from './composer';
export {
  addDmParticipant,
  closeDm,
  createDm,
  dmBlockedReason,
  dmPartner,
  dmRecipients,
  dmTitle,
  openDirectMessage,
  renameDm,
  sortDms,
  useDmList,
  useDmUnreadCount,
  useDmUnreadTotal,
  useUnreadDms,
} from './dms';
export { attachmentUrl, avatarUrl, formatBytes, removeAvatar, uploadAvatar } from './uploads';
export { EMOJI_CATEGORIES, QUICK_REACTIONS, type EmojiCategory } from './emoji';
export {
  closeGifPicker,
  fitBox,
  gifEmbed,
  gifOf,
  isGiphyMedia,
  loadMoreGifs,
  openGifPicker,
  retryGifs,
  searchGifs,
  setGifQuery,
  trendingGifs,
  useFeatures,
  useGifPicker,
  type GifPickerState,
} from './gifs';
export { parseInline, parseMarkdown, plainText, type MdBlock, type MdInline, type MdStyle } from './markdown';
