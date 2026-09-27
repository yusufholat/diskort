import type {
  ApiErrorBody,
  AuthResponse,
  Ban,
  Channel,
  ChangePasswordRequest,
  CreateRoleRequest,
  DeleteAccountRequest,
  DmChannel,
  Guild,
  PushTokenRequest,
  Message,
  CreateChannelRequest,
  CreateInviteRequest,
  Invite,
  LoginRequest,
  RegisterRequest,
  ResetCodeResponse,
  ResetPasswordRequest,
  Role,
  UpdateChannelRequest,
  UpdateGuildRequest,
  UpdateMeRequest,
  UpdateRoleRequest,
  UpdateUserRequest,
  User,
  VoiceJoinResponse,
  VoiceModerationRequest,
} from '@diskort/shared';
import { env } from './env';
import { useSession } from './session';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function normalizeServerUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, '');
  return /^https?:\/\//.test(trimmed) ? trimmed : `http://${trimmed}`;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = useSession.getState().token;
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let res: Response;
  try {
    res = await fetch(normalizeServerUrl(env().serverUrl()) + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'network', 'Sunucuya ulaşılamadı. Adresi ve internet bağlantını kontrol et.');
  }

  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    const err = data as Partial<ApiErrorBody> | null;
    if (res.status === 401 && token) useSession.getState().logout();
    throw new ApiError(res.status, err?.error ?? 'error', err?.message ?? `İstek başarısız (${res.status}).`);
  }
  return data as T;
}

export const api = {
  login: (body: LoginRequest) => request<AuthResponse>('POST', '/api/auth/login', body),
  register: (body: RegisterRequest) => request<AuthResponse>('POST', '/api/auth/register', body),
  resetPassword: (body: ResetPasswordRequest) => request<AuthResponse>('POST', '/api/auth/reset', body),
  me: () => request<User>('GET', '/api/me'),
  updateMe: (body: UpdateMeRequest) => request<User>('PATCH', '/api/me', body),
  removeAvatar: () => request<User>('DELETE', '/api/me/avatar'),
  changePassword: (body: ChangePasswordRequest) => request<AuthResponse>('POST', '/api/me/password', body),
  deleteAccount: (body: DeleteAccountRequest) => request<void>('DELETE', '/api/me', body),
  registerPushToken: (body: PushTokenRequest) => request<void>('POST', '/api/me/push-tokens', body),
  unregisterPushToken: (token: string) => request<void>('DELETE', '/api/me/push-tokens', { token }),
  sendTestPush: () => request<{ devices: number }>('POST', '/api/me/push-test'),

  createResetCode: (userId: string) => request<ResetCodeResponse>('POST', `/api/users/${userId}/reset-code`),
  updateUser: (userId: string, body: UpdateUserRequest) => request<User>('PATCH', `/api/users/${userId}`, body),
  kickFromVoice: (userId: string) => request<void>('POST', `/api/users/${userId}/voice-kick`),
  deleteUser: (userId: string) => request<void>('DELETE', `/api/users/${userId}`),
  /** Sesli sohbette yönetim: sunucuda sustur/sağırlaştır, taşı (channelId) ya da sesten çıkar (null) */
  moderateVoice: (userId: string, body: VoiceModerationRequest) =>
    request<void>('PATCH', `/api/users/${userId}/voice`, body),
  kickMember: (userId: string) => request<void>('POST', `/api/users/${userId}/kick`),
  banMember: (userId: string, reason?: string) =>
    request<void>('POST', `/api/users/${userId}/ban`, reason ? { reason } : {}),
  listBans: () => request<Ban[]>('GET', '/api/bans'),
  unban: (userId: string) => request<void>('DELETE', `/api/bans/${userId}`),

  updateGuild: (body: UpdateGuildRequest) => request<Guild>('PATCH', '/api/guild', body),
  createRole: (body: CreateRoleRequest) => request<Role>('POST', '/api/roles', body),
  updateRole: (id: string, body: UpdateRoleRequest) => request<Role>('PATCH', `/api/roles/${id}`, body),
  deleteRole: (id: string) => request<void>('DELETE', `/api/roles/${id}`),
  /** @everyone hariç tüm roller, yukarıdan aşağı */
  reorderRoles: (roleIds: string[]) => request<Role[]>('PUT', '/api/roles/order', { roleIds }),
  addMemberRole: (userId: string, roleId: string) => request<User>('PUT', `/api/users/${userId}/roles/${roleId}`),
  removeMemberRole: (userId: string, roleId: string) =>
    request<User>('DELETE', `/api/users/${userId}/roles/${roleId}`),

  listInvites: () => request<Invite[]>('GET', '/api/invites'),
  createInvite: (body: CreateInviteRequest) => request<Invite>('POST', '/api/invites', body),
  deleteInvite: (code: string) => request<void>('DELETE', `/api/invites/${encodeURIComponent(code)}`),

  createChannel: (body: CreateChannelRequest) => request<Channel>('POST', '/api/channels', body),
  updateChannel: (id: string, body: UpdateChannelRequest) => request<Channel>('PATCH', `/api/channels/${id}`, body),
  deleteChannel: (id: string) => request<void>('DELETE', `/api/channels/${id}`),

  joinVoice: (channelId: string) => request<VoiceJoinResponse>('POST', `/api/voice/${channelId}/join`),

  listMessages: (channelId: string, before?: string, limit?: number) => {
    const query = new URLSearchParams();
    if (before) query.set('before', before);
    if (limit) query.set('limit', String(limit));
    const qs = query.toString();
    return request<Message[]>('GET', `/api/channels/${channelId}/messages${qs ? `?${qs}` : ''}`);
  },
  sendMessage: (
    channelId: string,
    content: string,
    attachmentIds: string[] = [],
    reply?: { replyToId: string; replyMention: boolean },
  ) =>
    request<Message>('POST', `/api/channels/${channelId}/messages`, {
      content,
      ...(attachmentIds.length ? { attachmentIds } : {}),
      ...(reply ?? {}),
    }),
  updateMessage: (id: string, content: string) => request<Message>('PATCH', `/api/messages/${id}`, { content }),
  deleteMessage: (id: string) => request<void>('DELETE', `/api/messages/${id}`),
  addReaction: (messageId: string, emoji: string) =>
    request<void>('PUT', `/api/messages/${messageId}/reactions/${encodeURIComponent(emoji)}`),
  removeReaction: (messageId: string, emoji: string) =>
    request<void>('DELETE', `/api/messages/${messageId}/reactions/${encodeURIComponent(emoji)}`),
  ack: (channelId: string, messageId: string) =>
    request<void>('POST', `/api/channels/${channelId}/ack`, { messageId }),

  // Direkt mesajlar: mesajları kanallarla aynı uçlardan (listMessages, sendMessage…) gider
  listDms: () => request<DmChannel[]>('GET', '/api/dms'),
  /** Tek kişi: bire bir konuşma (varsa aynısı); birden çok kişi: yeni grup */
  createDm: (userIds: string[], name?: string | null) =>
    request<DmChannel>('POST', '/api/dms', name ? { userIds, name } : { userIds }),
  renameDm: (id: string, name: string | null) => request<DmChannel>('PATCH', `/api/dms/${id}`, { name }),
  /** Bire bir konuşmayı listeden kaldırır; gruptan ayrılır */
  closeDm: (id: string) => request<void>('DELETE', `/api/dms/${id}`),
  addDmParticipant: (id: string, userId: string) =>
    request<DmChannel>('PUT', `/api/dms/${id}/participants/${userId}`),
};

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return 'Beklenmeyen bir hata oluştu.';
}
