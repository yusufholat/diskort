import type {
  ApiErrorBody,
  AuthResponse,
  Channel,
  ChangePasswordRequest,
  Message,
  CreateChannelRequest,
  CreateInviteRequest,
  Invite,
  LoginRequest,
  RegisterRequest,
  ResetCodeResponse,
  ResetPasswordRequest,
  UpdateChannelRequest,
  UpdateMeRequest,
  UpdateUserRequest,
  User,
  VoiceJoinResponse,
} from '@diskort/shared';
import { useSession } from '../stores/session';
import { getSettings } from '../stores/settings';

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
    res = await fetch(normalizeServerUrl(getSettings().serverUrl) + path, {
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
  changePassword: (body: ChangePasswordRequest) => request<AuthResponse>('POST', '/api/me/password', body),

  createResetCode: (userId: string) => request<ResetCodeResponse>('POST', `/api/users/${userId}/reset-code`),
  updateUser: (userId: string, body: UpdateUserRequest) => request<User>('PATCH', `/api/users/${userId}`, body),
  kickFromVoice: (userId: string) => request<void>('POST', `/api/users/${userId}/voice-kick`),
  deleteUser: (userId: string) => request<void>('DELETE', `/api/users/${userId}`),

  listInvites: () => request<Invite[]>('GET', '/api/invites'),
  createInvite: (body: CreateInviteRequest) => request<Invite>('POST', '/api/invites', body),
  deleteInvite: (code: string) => request<void>('DELETE', `/api/invites/${encodeURIComponent(code)}`),

  createChannel: (body: CreateChannelRequest) => request<Channel>('POST', '/api/channels', body),
  updateChannel: (id: string, body: UpdateChannelRequest) => request<Channel>('PATCH', `/api/channels/${id}`, body),
  deleteChannel: (id: string) => request<void>('DELETE', `/api/channels/${id}`),

  joinVoice: (channelId: string) => request<VoiceJoinResponse>('POST', `/api/voice/${channelId}/join`),

  listMessages: (channelId: string, before?: string) =>
    request<Message[]>('GET', `/api/channels/${channelId}/messages${before ? `?before=${before}` : ''}`),
  sendMessage: (channelId: string, content: string) =>
    request<Message>('POST', `/api/channels/${channelId}/messages`, { content }),
  updateMessage: (id: string, content: string) => request<Message>('PATCH', `/api/messages/${id}`, { content }),
  deleteMessage: (id: string) => request<void>('DELETE', `/api/messages/${id}`),
  ack: (channelId: string, messageId: string) =>
    request<void>('POST', `/api/channels/${channelId}/ack`, { messageId }),
};

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return 'Beklenmeyen bir hata oluştu.';
}
