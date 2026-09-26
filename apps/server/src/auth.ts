import { hash, verify } from '@node-rs/argon2';
import { SignJWT, jwtVerify } from 'jose';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { User } from '@diskort/shared';
import type { Store } from './db.js';

const SESSION_TTL = '30d';

export class AuthService {
  private readonly key: Uint8Array;

  constructor(
    secret: string,
    private readonly store: Store,
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

  /** Geçerli bir oturum jetonuysa kullanıcıyı döner. */
  async userFromToken(token: string): Promise<User | null> {
    try {
      const { payload } = await jwtVerify(token, this.key, { algorithms: ['HS256'] });
      return payload.sub ? this.store.getUser(payload.sub) : null;
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

  requireAdmin = async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    await this.requireUser(req, reply);
    if (reply.sent) return;
    if (!req.user.isAdmin) {
      await reply.code(403).send({ error: 'forbidden', message: 'Bu işlem için yönetici olmalısın.' });
    }
  };
}

declare module 'fastify' {
  interface FastifyRequest {
    user: User;
  }
}
