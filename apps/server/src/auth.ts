import { hash, verify } from '@node-rs/argon2';
import { SignJWT, jwtVerify } from 'jose';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Permission, type User } from '@diskort/shared';
import type { Store } from './db.js';
import type { PermissionService } from './permissions.js';

const SESSION_TTL = '30d';

export class AuthService {
  private readonly key: Uint8Array;

  constructor(
    secret: string,
    private readonly store: Store,
    private readonly permissions: PermissionService,
  ) {
    this.key = new TextEncoder().encode(secret);
  }

  hashPassword(password: string): Promise<string> {
    return hash(password);
  }

  async verifyPassword(passwordHash: string, password: string): Promise<boolean> {
    try {
      return await verify(passwordHash, password);
    } catch {
      return false;
    }
  }

  issueToken(userId: string): Promise<string> {
    return new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(userId)
      .setIssuedAt()
      .setExpirationTime(SESSION_TTL)
      .sign(this.key);
  }

  /**
   * Geçerli bir oturum jetonuysa kullanıcıyı döner. Şifre değiştikten (ya da hesap atıldıktan) önce
   * verilmiş jetonlar geçersizdir; üye olmayan hesap hiç kabul edilmez.
   */
  async userFromToken(token: string): Promise<User | null> {
    try {
      const { payload } = await jwtVerify(token, this.key, { algorithms: ['HS256'] });
      if (!payload.sub || payload.iat === undefined) return null;
      const validAfter = this.store.getSessionsValidAfter(payload.sub);
      if (validAfter === null || payload.iat * 1000 < validAfter) return null;
      const user = this.store.getUser(payload.sub);
      return user && !user.removed ? user : null;
    } catch {
      return null;
    }
  }

  /** Fastify preHandler: Authorization: Bearer <token> */
  requireUser = async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
    const user = token ? await this.userFromToken(token) : null;
    if (!user) {
      await reply.code(401).send({ error: 'unauthorized', message: 'Oturum geçersiz, tekrar giriş yap.' });
      return;
    }
    req.user = user;
  };

  /** Fastify preHandler: sunucu genelinde verilen yetkiyi ister (sahip ve yöneticiler hepsine sahiptir). */
  requirePermission(flag: number) {
    return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
      await this.requireUser(req, reply);
      if (reply.sent) return;
      if (!this.permissions.can(req.user.id, flag)) {
        await reply.code(403).send({ error: 'forbidden', message: 'Bu işlem için yetkin yok.' });
      }
    };
  }

  requireAdmin = this.requirePermission(Permission.ADMINISTRATOR);
}

declare module 'fastify' {
  interface FastifyRequest {
    user: User;
  }
}
