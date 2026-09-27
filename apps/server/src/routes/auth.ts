import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  AVATAR_COLORS,
  DISPLAY_NAME_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  RESERVED_USERNAMES,
  USERNAME_PATTERN,
  type AuthResponse,
} from '@diskort/shared';
import { removeAccount } from '../accounts.js';
import { parseBody, sendError, type AppContext } from '../context.js';

const displayName = z
  .string()
  .trim()
  .min(1, 'Görünen ad boş olamaz.')
  .max(DISPLAY_NAME_MAX_LENGTH, `Görünen ad en fazla ${DISPLAY_NAME_MAX_LENGTH} karakter olabilir.`);

const registerSchema = z.object({
  inviteCode: z.string().trim().min(1, 'Davet kodu gerekli.'),
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(USERNAME_PATTERN, 'Kullanıcı adı 3-32 karakter; küçük harf, rakam, _ ve . içerebilir.')
    .refine((name) => !RESERVED_USERNAMES.includes(name), 'Bu kullanıcı adı kullanılamaz.'),
  password: z.string().min(PASSWORD_MIN_LENGTH, `Şifre en az ${PASSWORD_MIN_LENGTH} karakter olmalı.`).max(256),
  displayName: displayName.optional(),
});

const loginSchema = z.object({
  username: z.string().trim().toLowerCase().min(1, 'Kullanıcı adı gerekli.'),
  password: z.string().min(1, 'Şifre gerekli.'),
});

const newPassword = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Şifre en az ${PASSWORD_MIN_LENGTH} karakter olmalı.`)
  .max(256);

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Mevcut şifre gerekli.'),
  newPassword,
});

const resetPasswordSchema = z.object({
  username: z.string().trim().toLowerCase().min(1, 'Kullanıcı adı gerekli.'),
  code: z.string().trim().min(1, 'Sıfırlama kodu gerekli.'),
  newPassword,
});

const deleteAccountSchema = z.object({ password: z.string().min(1, 'Şifre gerekli.') });
const pushTokenSchema = z.object({
  token: z.string().min(10).max(4096),
  platform: z.enum(['android', 'ios']),
});
const removePushTokenSchema = z.object({ token: z.string().min(10).max(4096) });

const updateMeSchema = z.object({
  displayName: displayName.optional(),
  avatarColor: z.enum(AVATAR_COLORS, { message: 'Geçersiz renk.' }).optional(),
});

/** Basit bellek içi deneme sınırlayıcı (kaba kuvvet girişimlerine karşı). */
function createLimiter(maxAttempts: number, windowMs: number) {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return (key: string): boolean => {
    const now = Date.now();
    if (hits.size > 10_000) {
      for (const [k, v] of hits) if (v.resetAt < now) hits.delete(k);
    }
    const entry = hits.get(key);
    if (!entry || entry.resetAt < now) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      return true;
    }
    entry.count++;
    return entry.count <= maxAttempts;
  };
}

/** Üye olmayan hesabın girişte gördüğü açıklama */
const MEMBERSHIP_ERRORS = {
  kicked: {
    error: 'kicked',
    message:
      'Sunucudan çıkarıldın. Geri dönmek için yeni bir davet koduyla "Kayıt ol" ekranında kendi kullanıcı adın ve şifreni kullan.',
  },
  banned: { error: 'banned', message: 'Bu sunucudan yasaklandın.' },
} as const;

export function registerAuthRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { store, auth, gateway, push } = ctx;
  const limit = createLimiter(20, 60_000);

  app.post('/api/auth/register', async (req, reply) => {
    if (!limit(req.ip)) return sendError(reply, 429, 'rate_limited', 'Çok fazla deneme. Biraz bekle.');
    const body = parseBody(registerSchema, req.body, reply);
    if (!body) return reply;

    // Atılan hesap, yeni davetle aynı kullanıcı adı ve şifresiyle geri döner (hesap ve mesajları korunur)
    const existing = store.getUserAuthByUsername(body.username);
    const returning =
      existing?.removed === true && (await auth.verifyPassword(existing.passwordHash, body.password)) ? existing : null;
    const result = returning
      ? store.rejoinWithInvite(body.inviteCode, returning.id)
      : store.registerWithInvite({
          code: body.inviteCode,
          username: body.username,
          displayName: body.displayName ?? body.username,
          passwordHash: await auth.hashPassword(body.password),
        });
    if (!result.ok) {
      const status = result.reason === 'username' ? 409 : result.reason === 'banned' ? 403 : 400;
      return sendError(reply, status, result.reason, result.message);
    }
    // İlk kayıtla topluluğun sahibi belli olur
    if (!ctx.guild.ownerId) Object.assign(ctx.guild, store.getGuild());
    gateway.broadcast({ t: 'USER_UPDATE', d: result.user });
    const response: AuthResponse = { token: await auth.issueToken(result.user.id), user: result.user };
    return reply.code(201).send(response);
  });

  app.post('/api/auth/login', async (req, reply) => {
    if (!limit(req.ip)) return sendError(reply, 429, 'rate_limited', 'Çok fazla deneme. Biraz bekle.');
    const body = parseBody(loginSchema, req.body, reply);
    if (!body) return reply;

    const record = store.getUserAuthByUsername(body.username);
    const valid = record ? await auth.verifyPassword(record.passwordHash, body.password) : false;
    if (!record || !valid) {
      return sendError(reply, 401, 'invalid_credentials', 'Kullanıcı adı veya şifre hatalı.');
    }
    // Şifre doğruysa neden giremediği söylenir
    const status = store.membership(record.id);
    if (status !== 'member') return sendError(reply, 403, MEMBERSHIP_ERRORS[status].error, MEMBERSHIP_ERRORS[status].message);
    const { passwordHash: _omit, ...user } = record;
    const response: AuthResponse = { token: await auth.issueToken(user.id), user };
    return response;
  });

  // Yöneticinin verdiği tek kullanımlık kodla şifre sıfırlama; başarılı olursa giriş yapılmış olur.
  app.post('/api/auth/reset', async (req, reply) => {
    if (!limit(req.ip)) return sendError(reply, 429, 'rate_limited', 'Çok fazla deneme. Biraz bekle.');
    const body = parseBody(resetPasswordSchema, req.body, reply);
    if (!body) return reply;
    const userId = store.consumeResetCode(body.username, body.code);
    if (!userId || store.membership(userId) !== 'member') {
      return sendError(reply, 400, 'invalid_code', 'Kullanıcı adı veya sıfırlama kodu hatalı ya da kodun süresi dolmuş.');
    }
    store.setPassword(userId, await auth.hashPassword(body.newPassword));
    const user = store.getUser(userId)!;
    const response: AuthResponse = { token: await auth.issueToken(user.id), user };
    return response;
  });

  app.get('/api/me', { preHandler: auth.requireUser }, async (req) => req.user);

  // Şifre değişince diğer cihazlardaki oturumlar kapanır; bu cihaz yeni jetonla devam eder.
  app.post('/api/me/password', { preHandler: auth.requireUser }, async (req, reply) => {
    if (!limit(req.ip)) return sendError(reply, 429, 'rate_limited', 'Çok fazla deneme. Biraz bekle.');
    const body = parseBody(changePasswordSchema, req.body, reply);
    if (!body) return reply;
    const record = store.getUserAuthByUsername(req.user.username);
    if (!record || !(await auth.verifyPassword(record.passwordHash, body.currentPassword))) {
      return sendError(reply, 400, 'invalid_password', 'Mevcut şifre hatalı.');
    }
    store.setPassword(req.user.id, await auth.hashPassword(body.newPassword));
    const response: AuthResponse = { token: await auth.issueToken(req.user.id), user: req.user };
    return response;
  });

  // Telefon bildirimleri için cihaz jetonu (uygulama açılışta ve jeton yenilenince gönderir)
  app.post('/api/me/push-tokens', { preHandler: auth.requireUser }, async (req, reply) => {
    const body = parseBody(pushTokenSchema, req.body, reply);
    if (!body) return reply;
    store.savePushToken(req.user.id, body.token, body.platform);
    return reply.code(204).send();
  });

  // Çıkış yaparken: bu cihaza artık bu hesabın bildirimleri gitmesin
  app.delete('/api/me/push-tokens', { preHandler: auth.requireUser }, async (req, reply) => {
    const body = parseBody(removePushTokenSchema, req.body, reply);
    if (!body) return reply;
    store.removePushToken(body.token);
    return reply.code(204).send();
  });

  // Ayarlardaki "Test bildirimi gönder"
  app.post('/api/me/push-test', { preHandler: auth.requireUser }, async (req, reply) => {
    if (!limit(req.ip)) return sendError(reply, 429, 'rate_limited', 'Çok fazla deneme. Biraz bekle.');
    if (!push.enabled) return sendError(reply, 503, 'push_disabled', 'Sunucuda telefon bildirimleri kapalı.');
    return { devices: await push.sendTest(req.user.id) };
  });

  // Kullanıcı kendi hesabını siler (şifre onayıyla). Sahip, topluluk sahipsiz kalmasın diye önce sahipliği
  // devretmelidir.
  app.delete('/api/me', { preHandler: auth.requireUser }, async (req, reply) => {
    if (!limit(req.ip)) return sendError(reply, 429, 'rate_limited', 'Çok fazla deneme. Biraz bekle.');
    const body = parseBody(deleteAccountSchema, req.body, reply);
    if (!body) return reply;
    const record = store.getUserAuthByUsername(req.user.username);
    if (!record || !(await auth.verifyPassword(record.passwordHash, body.password))) {
      return sendError(reply, 400, 'invalid_password', 'Şifre hatalı.');
    }
    if (ctx.permissions.isOwner(req.user.id)) {
      return sendError(
        reply,
        400,
        'owner',
        'Sunucunun sahibi hesabını silemez. Önce Sunucu Ayarları > Genel bölümünden sahipliği başka birine devret.',
      );
    }
    await removeAccount(ctx, req.user.id, 'Hesabın silindi.');
    return reply.code(204).send();
  });

  app.patch('/api/me', { preHandler: auth.requireUser }, async (req, reply) => {
    const body = parseBody(updateMeSchema, req.body, reply);
    if (!body) return reply;
    const user = store.updateUser(req.user.id, body)!;
    gateway.broadcast({ t: 'USER_UPDATE', d: user });
    return user;
  });
}
