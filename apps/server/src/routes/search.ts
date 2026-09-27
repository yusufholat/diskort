import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  foldSearchText,
  isSearchEmpty,
  parseSearchQuery,
  SEARCH_HAS_VALUES,
  SEARCH_MAX_PAGE_SIZE,
  SEARCH_MAX_QUERY_LENGTH,
  SEARCH_PAGE_SIZE,
  searchDateRange,
  searchHighlightTerms,
  searchSnippet,
  searchTokens,
  type Channel,
  type ParsedSearch,
  type SearchHas,
  type SearchResponse,
  type User,
} from '@diskort/shared';
import { sendError, type AppContext } from '../context.js';
import { createRateLimiter } from './messages.js';

const id = z.string().min(1).max(64);
/** Tarih: ms zaman damgası ya da GG.AA.YYYY / YYYY-AA-GG */
const dateParam = z.string().max(32);

const searchQuery = z
  .object({
    q: z.string().max(SEARCH_MAX_QUERY_LENGTH, 'Arama çok uzun.').optional(),
    guildId: id.optional(),
    dmId: id.optional(),
    channelId: id.optional(),
    authorId: id.optional(),
    has: z
      .string()
      .max(64)
      .transform((s) => s.split(',').filter(Boolean))
      .pipe(z.array(z.enum(SEARCH_HAS_VALUES as [SearchHas, ...SearchHas[]])))
      .optional(),
    before: dateParam.optional(),
    after: dateParam.optional(),
    limit: z.coerce.number().int().min(1).max(SEARCH_MAX_PAGE_SIZE).optional(),
    cursor: z.string().regex(/^\d{1,15}$/).optional(),
    /** İstemcinin Date#getTimezoneOffset() değeri: sorgudaki tarihler onun gününe göre */
    tz: z.coerce.number().int().min(-900).max(900).optional(),
  })
  .refine((q) => !(q.guildId && q.dmId), 'Sunucu ve konuşma birlikte aranamaz.');

/** Sorgudaki sözcükleri FTS5 sorgusuna çevirir: sözcükler önekle ("kitap" → kitaplar), tırnaklılar tam ifade */
export function ftsMatch(words: ParsedSearch['words']): string | null {
  const parts: string[] = [];
  for (const w of words) {
    const tokens = searchTokens(w.text);
    if (tokens.length === 0) continue;
    // Tek harfli sözcükte önek araması çok geniş olur; tam eşleşme aranır
    const prefix = !w.phrase && tokens[tokens.length - 1]!.length >= 2;
    parts.push(`"${tokens.join(' ')}"${prefix ? '*' : ''}`);
  }
  return parts.length ? parts.slice(0, 16).join(' ') : null;
}

/** Tarih parametresi: ms ya da gün (gün başı) */
function paramDate(value: string | undefined, tz: number | undefined, dayEnd: boolean): number | null | 'invalid' {
  if (value === undefined) return null;
  if (/^\d{1,15}$/.test(value)) return Number(value);
  const range = searchDateRange(dayEnd ? { before: null, after: value, during: null } : { before: value, after: null, during: null }, tz);
  if (range === 'invalid') return 'invalid';
  return dayEnd ? range.after : range.before;
}

/**
 * Mesaj araması (GET /api/search). Kapsam bir sunucu (guildId, isteğe bağlı channelId) ya da bir direkt mesaj
 * konuşmasıdır (dmId; yalnızca channelId de verilebilir). Sonuçlar yalnızca kullanıcının şu an görebildiği
 * kanallardan/konuşmalardan gelir: sunucu üyeliği, kanal izinleri (VIEW_CHANNEL) ve konuşma katılımcılığı
 * her istekte yeniden denetlenir. Görülmeyen kapsam olmayan kapsamdan ayırt edilemez (404).
 * Sorgu işleçleri (from:, in:, has:, önce:, sonra:, tarih:) `q` içinde yazılabilir; ayrı parametrelerle
 * (authorId, channelId, has, before, after) birlikte verilirse hepsi birden uygulanır.
 */
export function registerSearchRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { store, auth, permissions } = ctx;
  const allowSearch = createRateLimiter(20, 10_000);

  app.get<{ Querystring: Record<string, string> }>('/api/search', { preHandler: auth.requireUser }, async (req, reply) => {
    const userId = req.user.id;
    const parsedQuery = searchQuery.safeParse(req.query);
    if (!parsedQuery.success) {
      return sendError(reply, 400, 'invalid_query', parsedQuery.error.issues[0]?.message ?? 'Geçersiz arama.');
    }
    const query = parsedQuery.data;
    if (!allowSearch(userId)) return sendError(reply, 429, 'rate_limited', 'Çok hızlı arıyorsun, biraz bekle.');

    const notFound = () => sendError(reply, 404, 'not_found', 'Arama yapılacak yer bulunamadı.');
    // Kapsam: kullanıcının görebildiği metin kanalları ya da tek konuşma
    let scope: Channel[] | null = null;
    let dmId: string | null = null;
    let guildId = query.guildId ?? null;
    if (query.dmId || (!guildId && query.channelId && permissions.isDm(query.channelId))) {
      dmId = query.dmId ?? query.channelId!;
      if (!permissions.isDm(dmId) || !permissions.canView(userId, dmId)) return notFound();
      if (query.channelId && query.channelId !== dmId) return notFound();
    } else {
      if (!guildId && query.channelId) guildId = permissions.guildOf(query.channelId) ?? null;
      if (!guildId || !permissions.isMember(guildId, userId)) return notFound();
      scope = permissions.visibleChannels(guildId, userId).filter((c) => c.type === 'text');
      if (query.channelId) {
        scope = scope.filter((c) => c.id === query.channelId);
        if (scope.length === 0) return notFound();
      }
    }

    const parsed = parseSearchQuery(query.q ?? '');
    const hasFilters = Boolean(query.authorId || query.has?.length || query.before || query.after);
    if (isSearchEmpty(parsed) && !hasFilters) return sendError(reply, 400, 'empty_query', 'Aramak için bir şey yaz.');

    // in: kanal adları (sunucuda; görünen kanallar arasından)
    if (scope && parsed.in.length > 0) {
      const names = new Set(parsed.in.map(foldSearchText));
      scope = scope.filter((c) => names.has(foldSearchText(c.name)));
    }
    const channelIds = scope ? scope.map((c) => c.id) : [dmId!];

    // from: kullanıcı adı ya da görünen ad (tam eşleşme yoksa önek); kullanıcının tanıyabildiği hesaplar
    let authorIds: string[] | null = query.authorId ? [query.authorId] : null;
    if (parsed.from.length > 0) {
      const known = store.usersByIds(store.visibleUserIds(userId));
      const matches = new Set<string>();
      for (const raw of parsed.from) {
        const wanted = foldSearchText(raw);
        const exact = known.filter((u) => foldSearchText(u.username) === wanted || foldSearchText(u.displayName) === wanted);
        const found = exact.length
          ? exact
          : known.filter((u) => foldSearchText(u.username).startsWith(wanted) || foldSearchText(u.displayName).startsWith(wanted));
        for (const u of found) matches.add(u.id);
      }
      authorIds = authorIds ? authorIds.filter((a) => matches.has(a)) : [...matches];
    }

    const has = [...new Set([...(query.has ?? []), ...parsed.has])];
    const range = searchDateRange(parsed, query.tz);
    const before = paramDate(query.before, query.tz, false);
    const after = paramDate(query.after, query.tz, true);
    if (range === 'invalid' || before === 'invalid' || after === 'invalid') {
      return sendError(reply, 400, 'invalid_date', 'Tarih anlaşılamadı; GG.AA.YYYY biçiminde yaz.');
    }
    const minOf = (a: number | null, b: number | null) => (a === null ? b : b === null ? a : Math.min(a, b));
    const maxOf = (a: number | null, b: number | null) => (a === null ? b : b === null ? a : Math.max(a, b));

    const terms = searchHighlightTerms(parsed);
    const found = store.searchMessages({
      channelIds,
      match: ftsMatch(parsed.words),
      authorIds,
      has,
      before: minOf(range.before, before),
      after: maxOf(range.after, after),
      cursor: query.cursor ? Number(query.cursor) : null,
      limit: query.limit ?? SEARCH_PAGE_SIZE,
      viewerId: userId,
    });

    const channels = new Map(scope?.map((c) => [c.id, c]) ?? []);
    const authorSet = new Set(found.messages.map((m) => m.authorId).filter((a): a is string => Boolean(a)));
    const users: User[] = store.usersByIds(authorSet);
    const response: SearchResponse = {
      results: found.messages.map((message) => {
        const channel = channels.get(message.channelId);
        return {
          message,
          channel: channel
            ? { id: channel.id, name: channel.name, guildId: channel.guildId }
            : { id: message.channelId, name: '', guildId: null },
          snippet: searchSnippet(message.content, terms),
        };
      }),
      total: found.total,
      totalCapped: found.totalCapped,
      nextCursor: found.more ? (found.messages[found.messages.length - 1]?.id ?? null) : null,
      terms,
      users,
    };
    return response;
  });
}
