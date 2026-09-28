// Masaüstü ve mobil istemcilerin ortak mantığı. Platforma özgü işler (bildirim, ses, pencere,
// depolama) configureClient() ile verilen ClientEnvironment üzerinden yapılır.

export { configureClient } from './configure';
export type { ClientEnvironment, KeyValueStorage, LocalFile, UploadRequest, UploadResponse } from './env';
export { api, ApiError, errorMessage, normalizeServerUrl } from './api';
export {
  forgetReactionUsers,
  loadReactionUsers,
  reactionSummary,
  reactionUsersKey,
  useReactionUsers,
  type ReactionUsersEntry,
} from './reactions';
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
  useFeedbackAuthor,
  type FeedbackDraft,
} from './feedback';
export { reportVoiceLog, SpuriousDuplicateGuard } from './voiceDiagnostics';
export {
  fetchStreamPreview,
  formatStreamElapsed,
  reportStreamSource,
  streamPreviewHeaders,
  streamPreviewUrl,
  uploadStreamPreview,
} from './streamPreview';
export { streamViewers, useStreamViewers } from './streamViewers';
export {
  isStreamMuted,
  setStreamVolume,
  shownStreamVolume,
  streamAudioOutput,
  streamVolumeOf,
  toggleStreamMute,
  type StreamAudioOutput,
  type StreamAudioPrefs,
} from './streamAudio';
export {
  describeCandidate,
  describeTransport,
  formatBitrate,
  formatPercent,
  linkQuality,
  minuteTicks,
  outboundDelta,
  parseTransportStats,
  PING_HISTORY_MS,
  pingAxis,
  pushSample,
  statList,
  summarizePings,
  type CandidateInfo,
  type LinkQuality,
  type PingSample,
  type PingSummary,
  type RtcStat,
  type RtpStream,
  type StatsSource,
  type StreamView,
  type TransportStats,
  type TransportView,
} from './connectionStats';
export {
  TELEMETRY_SUBSCRIBER_EVERY_MS,
  VoiceTelemetry,
  voiceTelemetry,
  type TelemetryContext,
  type TelemetrySample,
} from './voiceTelemetry';
export { gateway } from './gateway';
export {
  displayStatusOf,
  formatRemaining,
  setCustomStatus,
  setUserStatus,
  useCustomStatus,
  useSelfStatus,
  useStatus,
  type DisplayStatus,
} from './presence';
export { useSession } from './session';
export {
  clearPendingInvite,
  keepIfGuildInvite,
  pendingInviteNotice,
  refreshPendingInvitePreview,
  setPendingInvite,
  takePendingInvite,
  usePendingInvite,
} from './pendingInvite';
export {
  channelById,
  isGuildUnread,
  isUnread,
  membersOf,
  useGuild,
  type GatewayStatus,
  type GuildState,
  type GuildStore,
  type MemberUser,
} from './guild';
export {
  createGuild,
  deleteGuild,
  guildIconUrl,
  guildInitials,
  guildInvites,
  inviteLink,
  isGuildOwner,
  joinGuild,
  leaveGuild,
  removeGuildIcon,
  uploadGuildIcon,
  useGuildList,
  useGuildUnread,
} from './guilds';
export {
  can,
  canAssignRole,
  canManageRole,
  effectivePermissions,
  isOwner,
  memberColorOf,
  memberGroups,
  outranksUser,
  overwriteState,
  permissionsInGuild,
  permissionsOf,
  roleIsBelowFor,
  rolePermissionSource,
  rolesOf,
  setOverwriteState,
  sortedRoles,
  useCan,
  useMemberColor,
  usePermissions,
  type EffectivePermissions,
  type MemberGroup,
  type OverwriteState,
  type PermissionGrant,
  type RolePermissionSource,
} from './permissions';
export {
  channelPermissionInfos,
  PERMISSION_GROUPS,
  permissionInfo,
  type PermissionGroup,
  type PermissionInfo,
} from './permissionInfo';
export { memberActions, moderation, moveTargets, voiceDropTargets, type MemberActions } from './moderation';
export { canReorderChannels, reorderChannels, reorderedIds } from './channelOrder';
export {
  channelNameFor,
  GUILD_SETTINGS_SECTIONS,
  guildSettingsSections,
  typedChannelName,
  type GuildSettingsSection,
} from './guildSettings';
export {
  normalizeSearch,
  searchSettings,
  SETTINGS_GROUPS,
  settingsGroupsFor,
  settingsSection,
  type SettingsGroupId,
  type SettingsGroupInfo,
  type SettingsPlatform,
  type SettingsSectionId,
  type SettingsSectionInfo,
} from './settingsSections';
export { embedColor, embedHost, embedMediaUrl, embedVideoUrl, visibleLinkEmbeds, youtubePlayerUrl } from './linkEmbeds';
export { lastPathSegment, safeDecodeURIComponent } from './uri';
export {
  ackChannel,
  flushAcks,
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
  suppressEmbeds,
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
  jumpToPinned,
  loadPins,
  markPinsSeen,
  openPins,
  pinMessage,
  unpinMessage,
  usePins,
  type ChannelPins,
} from './pins';
export {
  cancelReply,
  clearJump,
  isOwnReplyTarget,
  jumpToMessage,
  setReplyMention,
  startReply,
} from './replies';
export {
  BROADCAST_MENTIONS,
  broadcastSuggestions,
  focusComposer,
  hasComposer,
  insertText,
  mentionInComposer,
  registerComposer,
  type BroadcastMention,
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
export {
  attachmentUrl,
  avatarUrl,
  bannerUrl,
  formatBytes,
  removeAvatar,
  removeBanner,
  updateProfileLook,
  uploadAvatar,
  uploadBanner,
} from './uploads';
export {
  EMOJI_CATEGORIES,
  isJumboEmoji,
  JUMBO_EMOJI_MAX,
  QUICK_REACTIONS,
  splitEmoji,
  type EmojiCategory,
  type TextPart,
} from './emoji';
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
export {
  broadcastMention,
  parseInline,
  parseMarkdown,
  plainText,
  type MdBlock,
  type MdInline,
  type MdStyle,
} from './markdown';
export {
  clearSearchResults,
  jumpToSearchResult,
  loadMoreSearch,
  onlineViewerCount,
  replaceLastWord,
  runSearch,
  SEARCH_OPTIONS,
  searchScopeKey,
  searchSuggestions,
  useOnlineViewerCount,
  useSearch,
  type SearchState,
  type SearchSuggestion,
} from './search';
export {
  ChannelSoundGate,
  encodeWav,
  OTHERS_QUIET_MS,
  OTHERS_SOUNDS,
  renderSound,
  SFX_PEAK_DBFS,
  SFX_SAMPLE_RATE,
  PREVIEW_SOUND_NAMES,
  SOUND_ALIASES,
  SOUND_LABELS,
  SOUND_NAMES,
  type SoundName,
} from './sfx';
export { PROFILE_THEME_PRESETS, profileGradient } from './profileLook';
export { COSMETIC_SET_INFO, type CosmeticSetInfo } from './cosmeticSets';
export {
  COSMETIC_SHADER_COMMON,
  COSMETIC_SHADER_MAIN,
  COSMETIC_SHADERS,
  COSMETIC_VERTEX_SHADER,
  SHADER_MODE,
  type ShaderViewKind,
} from './cosmeticShaders';
