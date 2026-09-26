import type {
  ApiErrorBody,
  AuthResponse,
  Channel,
  CreateChannelRequest,
  CreateInviteRequest,
  Invite,
  LoginRequest,
  RegisterRequest,
  UpdateChannelRequest,
  UpdateMeRequest,
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
  me: () => request<User>('GET', '/api/me'),
  updateMe: (body: UpdateMeRequest) => request<User>('PATCH', '/api/me', body),

  listInvites: () => request<Invite[]>('GET', '/api/invites'),
  createInvite: (body: CreateInviteRequest) => request<Invite>('POST', '/api/invites', body),
  deleteInvite: (code: string) => request<void>('DELETE', `/api/invites/${encodeURIComponent(code)}`),

  createChannel: (body: CreateChannelRequest) => request<Channel>('POST', '/api/channels', body),
  updateChannel: (id: string, body: UpdateChannelRequest) => request<Channel>('PATCH', `/api/channels/${id}`, body),
  deleteChannel: (id: string) => request<void>('DELETE', `/api/channels/${id}`),

  joinVoice: (channelId: string) => request<VoiceJoinResponse>('POST', `/api/voice/${channelId}/join`),
};

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return 'Beklenmeyen bir hata oluştu.';
}
