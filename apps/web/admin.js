// Yönetim paneli (/admin): hesap yöneticilerine sunucunun genel durumu. Veriler GET /api/admin/dashboard'dan
// sekme görünürken 5 sn'de bir gelir. Giriş, uygulamanın kendi giriş ucuyla (POST /api/auth/login) yapılır;
// jeton sessionStorage'da ("Beni hatırla" seçilirse localStorage'da) durur.
// CSP gereği satır içi betik ve stil yok (öğe stilleri yalnızca CSSOM ile). Tüm metinler textContent ile
// yazılır: istemci hata iletileri gibi dışarıdan gelen metinler asla HTML olarak yorumlanmaz.

const REFRESH_MS = 5_000;
const TOKEN_KEY = 'diskort-admin-token';
const USERS_SHOWN = 15;

const $ = (id) => document.getElementById(id);

// ---------- Oturum ----------

function loadToken() {
  try {
    return sessionStorage.getItem(TOKEN_KEY) ?? localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function saveToken(value, remember) {
  try {
    (remember ? localStorage : sessionStorage).setItem(TOKEN_KEY, value);
  } catch {
    // Depolama kapalı (gizli sekme): jeton yalnızca bu sayfa açıkken bellekte kalır
  }
}

function clearToken() {
  try {
    sessionStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    // yok say
  }
}

let token = loadToken();
let timer = null;
let inflight = false;
let lastData = null;
let failures = 0;
/** Yeniden çizimde korunacak arayüz durumu */
const ui = { allUsers: false, openErrors: new Set() };

const VIEWS = ['adm-login', 'adm-denied', 'adm-loading', 'adm-dashboard'];

function show(view) {
  for (const id of VIEWS) $(id).hidden = id !== view;
  $('adm-session').hidden = view !== 'adm-dashboard' && view !== 'adm-loading';
  if (view === 'adm-login') setTimeout(() => $('adm-login-form').elements.username.focus(), 0);
}

function logout(message) {
  clearTimeout(timer);
  token = null;
  lastData = null;
  clearToken();
  loginError(message ?? null);
  show('adm-login');
}

function loginError(message) {
  const el = $('adm-login-error');
  el.hidden = !message;
  el.textContent = message ?? '';
}

$('adm-login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const username = form.elements.username.value.trim();
  const password = form.elements.password.value;
  if (!username || !password) return loginError('Kullanıcı adı ve şifre gerekli.');
  const submit = $('adm-login-submit');
  submit.disabled = true;
  loginError(null);
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) return loginError(body?.message ?? `Giriş başarısız (${res.status}).`);
    form.elements.password.value = '';
    // Yönetici olmayanın jetonu saklanmaz
    if (!body?.user?.isAdmin) return show('adm-denied');
    token = body.token;
    saveToken(token, form.elements.remember.checked);
    show('adm-loading');
    void refresh();
  } catch {
    loginError('Sunucuya ulaşılamadı. İnternet bağlantını kontrol et.');
  } finally {
    submit.disabled = false;
  }
});

$('adm-logout').addEventListener('click', () => logout());
$('adm-denied-logout').addEventListener('click', () => logout());

// ---------- Yenileme ----------

function schedule() {
  clearTimeout(timer);
  if (token && !document.hidden) timer = setTimeout(refresh, REFRESH_MS);
}

async function refresh() {
  if (inflight || !token) return;
  clearTimeout(timer);
  inflight = true;
  try {
    const res = await fetch(`/api/admin/dashboard?tz=${new Date().getTimezoneOffset()}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    if (res.status === 401) return logout('Oturumun sona erdi, tekrar giriş yap.');
    if (res.status === 403) {
      clearToken();
      token = null;
      return show('adm-denied');
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    lastData = await res.json();
    failures = 0;
    render(lastData);
    setLive('ok', `Canlı · ${clock(lastData.generatedAt, true)}`);
    show('adm-dashboard');
  } catch {
    failures++;
    setLive('bad', lastData ? `Bağlantı yok · son ${clock(lastData.generatedAt, true)}` : 'Bağlantı yok');
    if (!lastData) {
      $('adm-loading-text').textContent = 'Sunucuya ulaşılamadı; yeniden deneniyor…';
      show('adm-loading');
    }
  } finally {
    inflight = false;
    if (token) schedule();
  }
}

function setLive(state, text) {
  $('adm-live').dataset.state = state;
  $('adm-live-text').textContent = text;
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    clearTimeout(timer);
    if (token) setLive('paused', 'Duraklatıldı');
  } else if (token) {
    void refresh();
  }
});

// ---------- Biçimlendirme ----------

const nf = new Intl.NumberFormat('tr-TR');
const nf1 = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 2 });

const num = (n) => nf.format(n);

/** Bayt (ondalık birimler: kota ve sağlayıcı paketleri de öyle) */
function bytes(n) {
  if (n === null || n === undefined) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = n;
  let i = 0;
  while (v >= 1000 && i < units.length - 1) {
    v /= 1000;
    i++;
  }
  return `${i === 0 ? nf.format(v) : nf1.format(v)} ${units[i]}`;
}

/** Bayt/sn → bit/sn */
function rate(bps) {
  if (bps === null || bps === undefined) return '—';
  const bits = bps * 8;
  if (bits >= 1e9) return `${nf1.format(bits / 1e9)} Gb/sn`;
  if (bits >= 1e6) return `${nf1.format(bits / 1e6)} Mb/sn`;
  if (bits >= 1e3) return `${nf.format(Math.round(bits / 1e3))} kb/sn`;
  return `${nf.format(Math.round(bits))} b/sn`;
}

const percent = (x) => (x === null || x === undefined ? '—' : `%${nf.format(Math.round(x * 100))}`);

function duration(sec) {
  if (sec === null || sec === undefined) return '—';
  const s = Math.max(0, Math.floor(sec));
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3_600);
  const m = Math.floor((s % 3_600) / 60);
  if (d > 0) return `${d} g ${h} sa`;
  if (h > 0) return `${h} sa ${m} dk`;
  if (m > 0) return `${m} dk`;
  return `${s} sn`;
}

function clock(ms, seconds = false) {
  return new Date(ms).toLocaleTimeString('tr-TR', {
    hour: '2-digit',
    minute: '2-digit',
    ...(seconds ? { second: '2-digit' } : {}),
  });
}

const shortDate = (ms) => new Date(ms).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' });
const dateTime = (ms) =>
  new Date(ms).toLocaleString('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function ago(ms, now) {
  if (ms === null || ms === undefined) return '—';
  const s = Math.max(0, (now - ms) / 1000);
  if (s < 60) return 'şimdi';
  if (s < 3_600) return `${Math.floor(s / 60)} dk önce`;
  if (s < 86_400) return `${Math.floor(s / 3_600)} sa önce`;
  if (s < 7 * 86_400) return `${Math.floor(s / 86_400)} gün önce`;
  return shortDate(ms);
}

const PLATFORM = { desktop: 'Masaüstü', android: 'Android', ios: 'iOS' };

// ---------- DOM yardımcıları ----------

/** Öğe oluşturur; çocuklar metin (textContent olarak), öğe, dizi ya da boş (atlanır) olabilir */
function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (typeof props === 'string') el.className = props;
  else if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'on') for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
}

const SVG_NS = 'http://www.w3.org/2000/svg';
function svg(tag, attrs) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

/**
 * Kutu: başlık, büyük değer, alt satırlar ve isteğe bağlı grafik. `wide` her zaman tüm satırı kaplar.
 * Telefonda kutular tam genişliktir; yalnızca kısa sayı kutuları (`compact`) ikişer yan yana dizilir.
 */
function card({ label, value, unit, sub, wide, compact, tone, children }) {
  return h(
    'article',
    `adm-card${wide ? ' adm-wide' : ''}${compact ? ' adm-compact' : ''}${tone ? ` adm-tone-${tone}` : ''}`,
    h('div', 'adm-label', label),
    value !== undefined && h('div', 'adm-value', value, unit && h('span', 'adm-unit', unit)),
    sub && (Array.isArray(sub) ? sub : [sub]).filter(Boolean).map((line) => h('div', 'adm-sub', line)),
    children,
  );
}

/** Doluluk çubuğu: renk durumu taşır (normal → uyarı → tehlike) */
function meter(fraction, label) {
  const f = Math.max(0, Math.min(1, fraction ?? 0));
  const bar = h('span');
  bar.style.width = `${(f * 100).toFixed(1)}%`;
  const state = f >= 0.95 ? 'danger' : f >= 0.8 ? 'warn' : 'ok';
  return h('div', { class: `adm-meter adm-meter-${state}`, role: 'meter', 'aria-label': label, 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.round(f * 100) }, bar);
}

/**
 * Küçük çizgi grafik (son ~15 dk). points: [{ at, v }] (v null ise çizgide boşluk). Fareyle ya da
 * dokunarak üzerine gelinen ölçümün saati ve değeri gösterilir.
 */
function sparkline(points, { max, format, color = 'brand', label }) {
  const W = 300;
  const H = 60;
  const wrap = h('div', `adm-spark adm-c-${color}`);
  const valid = points.filter((p) => p.v !== null && p.v !== undefined);
  if (points.length < 2 || valid.length === 0) {
    append(wrap, [h('div', 'adm-spark-empty', 'Ölçülüyor…')]);
    return wrap;
  }
  const from = points[0].at;
  const to = points[points.length - 1].at;
  const top = Math.max(max ?? 0, ...valid.map((p) => p.v)) || 1;
  const x = (t) => ((t - from) / Math.max(1, to - from)) * W;
  const y = (v) => H - 2 - (Math.min(v, top) / top) * (H - 6);
  let line = '';
  let area = '';
  let run = [];
  const flush = () => {
    if (run.length === 0) return;
    const d = run.map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`).join('');
    line += run.length === 1 ? `${d}h0.5` : d;
    area += `${d}L${run[run.length - 1][0].toFixed(1)},${H}L${run[0][0].toFixed(1)},${H}Z`;
    run = [];
  };
  for (const p of points) {
    if (p.v === null || p.v === undefined) flush();
    else run.push([x(p.at), y(p.v)]);
  }
  flush();
  const chart = svg('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', role: 'img', 'aria-label': label });
  chart.append(svg('path', { d: area, class: 'adm-spark-area' }));
  chart.append(svg('path', { d: line, class: 'adm-spark-line', 'vector-effect': 'non-scaling-stroke' }));
  const cursor = h('div', 'adm-spark-cursor');
  const dot = h('div', 'adm-spark-dot');
  const tip = h('div', 'adm-spark-tip');
  cursor.hidden = dot.hidden = tip.hidden = true;
  const move = (e) => {
    const rect = wrap.getBoundingClientRect();
    const t = from + ((e.clientX - rect.left) / rect.width) * (to - from);
    let best = null;
    for (const p of valid) if (!best || Math.abs(p.at - t) < Math.abs(best.at - t)) best = p;
    if (!best) return;
    const left = (x(best.at) / W) * 100;
    cursor.style.left = dot.style.left = `${left}%`;
    dot.style.top = `${(y(best.v) / H) * 100}%`;
    tip.textContent = `${clock(best.at, true)} · ${format(best.v)}`;
    tip.style.left = `${left}%`;
    tip.dataset.side = left > 60 ? 'left' : 'right';
    cursor.hidden = dot.hidden = tip.hidden = false;
  };
  const leave = (e) => {
    // Dokunmatikte parmak kalkınca da "ayrıldı" gelir: değer bir sonraki yenilemeye kadar görünür kalsın
    if (e.pointerType === 'touch') return;
    cursor.hidden = dot.hidden = tip.hidden = true;
  };
  wrap.addEventListener('pointermove', move);
  wrap.addEventListener('pointerdown', move);
  wrap.addEventListener('pointerleave', leave);
  append(wrap, [chart, cursor, dot, tip]);
  return wrap;
}

const series = (history, key) => history.map((s) => ({ at: s.at, v: s[key] }));

// ---------- Bölümler ----------

function render(d) {
  const now = d.generatedAt;
  $('adm-overview').replaceChildren(...overview(d, now));
  $('adm-voice').replaceChildren(...voice(d, now));
  $('adm-system').replaceChildren(...system(d, now));
  $('adm-clients').replaceChildren(...clients(d, now));
  $('adm-errors').replaceChildren(...errors(d, now));
  $('adm-feedback').replaceChildren(...feedback(d));
  $('adm-foot').textContent =
    `Son güncelleme ${clock(now, true)} · sekme açıkken 5 saniyede bir yenilenir. ` +
    `Hata kayıtları ve grafikler sunucu belleğinde tutulur (${dateTime(d.errors.since)} tarihinden beri).`;
}

function overview(d, now) {
  const o = d.overview;
  const m = o.messages;
  const trackedDays = (now - o.activitySince) / 86_400_000;
  const maxDay = Math.max(1, ...m.perDay.map((p) => p.count));
  const caption = h('div', 'adm-sub adm-bars-caption', `Son ${m.perDay.length} gün`);
  const bars = h(
    'div',
    { class: 'adm-bars', role: 'img', 'aria-label': `Son ${m.perDay.length} günün günlük mesaj sayıları` },
    m.perDay.map((p, i) => {
      const bar = h('span', {
        class: `adm-bar${p.count === 0 ? ' adm-bar-zero' : ''}${i === m.perDay.length - 1 ? ' adm-bar-today' : ''}`,
        title: `${shortDate(p.day)}: ${num(p.count)} mesaj`,
      });
      bar.style.height = `${Math.max(3, (p.count / maxDay) * 100)}%`;
      const label = `${i === m.perDay.length - 1 ? 'Bugün' : shortDate(p.day)}: ${num(p.count)} mesaj`;
      const showDay = () => (caption.textContent = label);
      bar.addEventListener('pointerenter', showDay);
      bar.addEventListener('pointerdown', showDay);
      bar.addEventListener('pointerleave', (e) => {
        if (e.pointerType !== 'touch') caption.textContent = `Son ${m.perDay.length} gün`;
      });
      return bar;
    }),
  );
  const s = o.storage;
  const storageLine = (name, value) => h('div', 'adm-kv', h('span', null, name), h('b', null, value));
  return [
    card({
      label: 'Hesaplar',
      value: num(o.users),
      compact: true,
      sub: [
        `${num(o.admins)} yönetici · ${num(o.guilds)} sunucu`,
        `${num(o.channels.text + o.channels.voice)} kanal · ${num(o.channels.dm)} DM`,
      ],
    }),
    card({
      label: 'Şu an bağlı',
      value: num(o.online),
      unit: 'kişi',
      sub: `${num(o.sessions)} açık bağlantı`,
      children: sparkline(series(d.system.history, 'online'), {
        format: (v) => `${num(v)} kişi`,
        label: 'Bağlı kişi sayısı, son dakikalar',
        max: 1,
      }),
    }),
    card({
      label: 'Etkin hesaplar',
      value: num(o.active24h),
      unit: 'son 24 saat',
      compact: true,
      sub: [
        `Son 7 günde ${num(o.active7d)}`,
        // Bağlantı takibi yeni başladıysa öncesi yalnızca mesaj yazanlardan bilinir
        trackedDays < 7 && `Bağlantı takibi ${shortDate(o.activitySince)} tarihinden beri`,
      ],
    }),
    card({
      label: 'Depolama',
      value: bytes(s.database + s.attachments + (s.avatars ?? 0) + (s.feedback ?? 0) + (s.linkPreviews ?? 0)),
      children: h(
        'div',
        'adm-kvs',
        storageLine('Veritabanı', bytes(s.database)),
        storageLine(`Dosya ekleri (${num(s.attachmentCount)})`, bytes(s.attachments)),
        storageLine('Profil ve sunucu resimleri', bytes(s.avatars)),
        storageLine('Geri bildirim görüntüleri', bytes(s.feedback)),
        storageLine('Bağlantı önizlemeleri', bytes(s.linkPreviews)),
      ),
    }),
    card({
      label: 'Mesajlar',
      value: num(m.today),
      unit: 'bugün',
      wide: true,
      sub: `Son 24 saatte ${num(m.last24h)} · son 7 günde ${num(m.last7d)} · toplam ${num(m.total)}`,
      children: [bars, caption],
    }),
  ];
}

function avatar(user, size = 32) {
  const el = h('span', 'adm-avatar');
  el.style.width = el.style.height = `${size}px`;
  if (user?.avatarUrl) {
    append(el, [h('img', { src: user.avatarUrl, alt: '', width: size, height: size, loading: 'lazy' })]);
  } else {
    el.style.background = user?.avatarColor ?? '#5865f2';
    el.textContent = (user?.displayName ?? '?').trim().charAt(0).toLocaleUpperCase('tr') || '?';
  }
  return el;
}

const badge = (text, tone) => h('span', `adm-badge${tone ? ` adm-badge-${tone}` : ''}`, text);

function trackText(t) {
  const codec = t.mimeType ? t.mimeType.split('/')[1] : '';
  if (t.kind === 'video') return `${t.width && t.height ? `${t.width}×${t.height} ` : ''}${codec}`.trim();
  return codec;
}

function voice(d, now) {
  const v = d.voice;
  const lk = v.livekit;
  const mismatch = lk.ok && lk.participants !== v.participants;
  const cards = [
    card({
      label: 'Seste',
      value: num(v.participants),
      unit: 'kişi',
      sub: `${num(v.channels.length)} kanalda`,
      children: sparkline(series(d.system.history, 'voice'), {
        format: (x) => `${num(x)} kişi`,
        label: 'Sesteki kişi sayısı, son dakikalar',
        max: 1,
      }),
    }),
    card({ label: 'Yayında', value: num(v.streams), unit: 'ekran paylaşımı', compact: true }),
    card({
      label: 'LiveKit',
      value: lk.ok ? 'Çalışıyor' : 'Ulaşılamıyor',
      compact: true,
      tone: lk.ok ? (mismatch ? 'warn' : 'ok') : 'bad',
      sub: lk.ok
        ? [
            `${num(lk.rooms)} oda · ${num(lk.participants)} kişi · ${num(lk.tracks)} iz`,
            `Yanıt ${num(lk.latencyMs ?? 0)} ms`,
            // Ses durumu LiveKit'le 30 sn'de bir eşitlenir
            mismatch && `Uygulamadaki ses listesiyle uyuşmuyor (${num(v.participants)} kişi)`,
          ]
        : lk.error,
    }),
  ];
  if (v.channels.length === 0) {
    cards.push(h('article', 'adm-card adm-wide adm-empty', 'Şu an seste kimse yok.'));
    return cards;
  }
  for (const c of v.channels) {
    cards.push(
      h(
        'article',
        'adm-card adm-wide',
        h(
          'div',
          'adm-channel-head',
          h('span', 'adm-channel-name', `🔊 ${c.name}`),
          c.guildName && h('span', 'adm-muted', c.guildName),
          h('span', 'adm-muted adm-push', `${num(c.participants.length)} kişi`),
        ),
        h(
          'ul',
          'adm-rows',
          c.participants.map((p) => {
            const name = p.user?.displayName ?? 'Silinmiş kullanıcı';
            const screen = p.tracks?.find((t) => t.source === 'screen');
            const mic = p.tracks?.find((t) => t.source === 'microphone');
            return h(
              'li',
              'adm-row',
              avatar(p.user),
              h(
                'div',
                'adm-row-main',
                h('div', 'adm-row-title', name, p.user && h('span', 'adm-muted', ` @${p.user.username}`)),
                h(
                  'div',
                  'adm-badges',
                  badge(`${duration((now - p.joinedAt) / 1000)} seste`),
                  p.platforms.map((pl) => badge(PLATFORM[pl] ?? pl)),
                  p.streaming &&
                    badge(
                      `Yayında${p.streamStartedAt ? ` · ${duration((now - p.streamStartedAt) / 1000)}` : ''}${screen ? ` · ${trackText(screen)}` : ''}`,
                      'live',
                    ),
                  p.selfMute && badge('Mikrofon kapalı', 'muted'),
                  p.selfDeaf && badge('Sağırlaştırılmış', 'muted'),
                  p.serverMute && badge('Sunucuda susturuldu', 'warn'),
                  p.serverDeaf && badge('Sunucuda sağırlaştırıldı', 'warn'),
                  mic && !p.selfMute && badge(`Mikrofon ${mic.muted ? 'sessiz' : 'açık'}${trackText(mic) ? ` · ${trackText(mic)}` : ''}`),
                  p.tracks && p.tracks.length === 0 && badge('LiveKit: iz yok', 'muted'),
                ),
              ),
            );
          }),
        ),
      ),
    );
  }
  return cards;
}

function system(d, now) {
  const s = d.system;
  const p = s.process;
  const history = s.history;
  // Son ölçüm hesaplanamadıysa (ör. sunucu yeni başladı) geçmişteki en son değer
  const latest = (value, key) => value ?? history.findLast((x) => x[key] !== null && x[key] !== undefined)?.[key] ?? null;
  const processCard = card({
    label: 'Çalışma süresi',
    value: duration(s.hostUptimeSec ?? p.uptimeSec),
    unit: s.hostUptimeSec !== null ? 'makine' : 'API',
    compact: true,
    sub: [`API ${duration(p.uptimeSec)} · ${bytes(p.rss)} bellek`, `Node ${p.node}`],
  });
  if (!s.available) {
    return [
      card({
        label: 'Makine',
        value: 'Bilgi yok',
        tone: 'warn',
        sub: 'Makine bilgileri yalnızca Linux sunucuda (/proc) okunabilir.',
      }),
      processCard,
    ];
  }
  const mem = s.memory;
  const disk = s.disk;
  const net = s.network;
  const cards = [
    card({
      label: 'İşlemci',
      value: percent(latest(s.cpu?.usage, 'cpu')),
      sub: s.cpu?.load
        ? `Yük ${s.cpu.load.map((l) => nf2.format(l)).join(' · ')} (${num(s.cpu.cores)} çekirdek)`
        : `${num(s.cpu?.cores ?? 0)} çekirdek`,
      children: sparkline(series(history, 'cpu'), { max: 1, format: percent, label: 'İşlemci kullanımı, son dakikalar' }),
    }),
  ];
  if (mem) {
    const used = mem.total - mem.available;
    cards.push(
      card({
        label: 'Bellek',
        value: bytes(used),
        unit: `/ ${bytes(mem.total)}`,
        sub: `${bytes(mem.available)} kullanılabilir`,
        children: [
          meter(used / mem.total, 'Bellek doluluğu'),
          sparkline(series(history, 'memUsed'), { max: mem.total, format: bytes, label: 'Kullanılan bellek, son dakikalar', color: 'ok' }),
        ],
      }),
    );
  }
  if (net) {
    // Gelen ve giden aynı ölçekte (karşılaştırılabilsin)
    const top = Math.max(1, ...history.flatMap((x) => [x.rxBps ?? 0, x.txBps ?? 0]));
    const half = (arrow, name, key, value, color) =>
      h(
        'div',
        'adm-net',
        h('div', 'adm-net-head', h('span', 'adm-muted', name), h('b', null, `${arrow} ${rate(value)}`)),
        sparkline(series(history, key), { max: top, format: rate, label: `${name} trafik, son dakikalar`, color }),
      );
    cards.push(
      card({
        label: `Ağ (${net.interfaces.join(', ') || '—'})`,
        children: [half('↓', 'Gelen', 'rxBps', latest(net.rxBps, 'rxBps'), 'brand'), half('↑', 'Giden', 'txBps', latest(net.txBps, 'txBps'), 'pink')],
      }),
    );
  }
  if (disk) {
    cards.push(
      card({
        label: 'Disk (veri)',
        compact: true,
        value: bytes(disk.used),
        unit: `/ ${bytes(disk.total)}`,
        sub: `${bytes(disk.free)} boş`,
        children: meter(disk.used / Math.max(1, disk.used + disk.free), 'Disk doluluğu'),
      }),
    );
  }
  const t = s.traffic;
  if (t) {
    const total = t.rx + t.tx;
    const start = new Date(now);
    const monthStart = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1);
    const monthEnd = Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1);
    const elapsed = now - t.since;
    // Ay sonu tahmini: bu ayki ortalama hızla (en az bir günlük veri varsa)
    const projected = elapsed > 86_400_000 ? (total / elapsed) * (monthEnd - t.since) : null;
    cards.push(
      card({
        label: `Bu ayın trafiği (${t.month})`,
        value: bytes(total),
        unit: `/ ${bytes(t.quota)}`,
        tone: total / t.quota >= 0.95 ? 'bad' : total / t.quota >= 0.8 ? 'warn' : undefined,
        children: [
          meter(total / t.quota, 'Aylık trafik kotası'),
          [
            `Gelen ${bytes(t.rx)} · giden ${bytes(t.tx)}`,
            projected !== null && `Bu hızla ay sonunda ~${bytes(projected)} (%${num(Math.round((projected / t.quota) * 100))})`,
            t.since > monthStart + 60_000 && `Sayım ${dateTime(t.since)} tarihinden beri (öncesi bilinmiyor).`,
            t.history.length > 0 &&
              `Önceki aylar: ${t.history
                .slice(-3)
                .reverse()
                .map((m) => `${m.month} ${bytes(m.rx + m.tx)}`)
                .join(' · ')}`,
          ]
            .filter(Boolean)
            .map((line) => h('div', 'adm-sub', line)),
        ],
      }),
    );
  }
  cards.push(processCard);
  return cards;
}

function clients(d, now) {
  const c = d.clients;
  const cards = [
    h(
      'article',
      'adm-card adm-wide',
      h('div', 'adm-label', 'Açık bağlantılar (platforma göre)'),
      h(
        'div',
        'adm-stats',
        ['desktop', 'android', 'ios'].map((p) =>
          h(
            'div',
            'adm-stat',
            h('b', null, num(c.platforms[p])),
            h('span', null, PLATFORM[p]),
            h('span', null, c.latest[p] ? `son sürüm ${c.latest[p]}` : 'son sürüm bilinmiyor'),
          ),
        ),
      ),
    ),
  ];
  cards.push(
    h(
      'article',
      'adm-card adm-wide',
      h('div', 'adm-label', 'Bağlı sürümler'),
      c.versions.length === 0
        ? h('div', 'adm-sub', 'Şu an bağlı istemci yok.')
        : h(
            'ul',
            'adm-rows adm-rows-compact',
            c.versions.map((v) =>
              h(
                'li',
                'adm-row',
                h('span', 'adm-row-title', `${PLATFORM[v.platform]} ${v.version ?? '(sürüm bildirmiyor)'}`),
                h('span', 'adm-muted adm-push', `${num(v.sessions)} bağlantı`),
                v.current === true
                  ? badge('güncel', 'ok')
                  : v.current === false
                    ? badge(`eski · son ${c.latest[v.platform]}`, 'warn')
                    : null,
              ),
            ),
          ),
    ),
  );
  const shown = ui.allUsers ? c.users : c.users.slice(0, USERS_SHOWN);
  const more =
    c.users.length > USERS_SHOWN &&
    h(
      'button',
      {
        type: 'button',
        class: 'adm-more',
        on: {
          click: () => {
            ui.allUsers = !ui.allUsers;
            if (lastData) render(lastData);
          },
        },
      },
      ui.allUsers ? 'Daha az göster' : `Tümünü göster (${num(c.users.length)})`,
    );
  cards.push(
    h(
      'article',
      'adm-card adm-wide',
      h('div', 'adm-label', 'Hesaplar ve son görülme'),
      h(
        'ul',
        'adm-rows',
        shown.map((u) => {
          const devices = u.devices.map((x) => `${PLATFORM[x.platform]} ${x.version ?? ''}${x.idle ? ' (boşta)' : ''}`.trim());
          const last = u.lastPlatform ? `${PLATFORM[u.lastPlatform]} ${u.lastVersion ?? ''}`.trim() : null;
          return h(
            'li',
            'adm-row',
            h('span', { class: `adm-status${u.online ? ' adm-status-on' : ''}`, title: u.online ? 'Bağlı' : 'Bağlı değil' }),
            avatar(u.user, 28),
            h(
              'div',
              'adm-row-main',
              h('div', 'adm-row-title', u.user.displayName, h('span', 'adm-muted', ` @${u.user.username}`), u.user.isAdmin && badge('yönetici')),
              h('div', 'adm-sub', u.online ? devices.join(' · ') : last ? `Son: ${last}` : 'Bu takip başladığından beri bağlanmadı'),
            ),
            h('span', 'adm-muted adm-push adm-nowrap', u.online ? 'bağlı' : ago(u.lastSeen, now)),
          );
        }),
      ),
      more,
    ),
  );
  return cards;
}

function countText(c) {
  return `${num(c.last24h)}${c.capped ? '+' : ''}`;
}

function errors(d, now) {
  const e = d.errors;
  const cards = [
    card({
      label: 'İstemci hataları',
      value: countText(e.client),
      unit: 'son 24 saat',
      compact: true,
      tone: e.client.last24h > 0 ? 'warn' : undefined,
      sub: `Toplam ${num(e.client.total)}`,
    }),
    card({
      label: 'Sunucu hataları',
      value: countText(e.server),
      unit: 'son 24 saat',
      compact: true,
      tone: e.server.last24h > 0 ? 'bad' : undefined,
      sub: `Toplam ${num(e.server.total)} (5xx yanıt)`,
    }),
  ];
  const details = (key, summary, body) => {
    const el = h('details', 'adm-details', h('summary', null, summary), h('pre', null, body));
    if (ui.openErrors.has(key)) el.open = true;
    el.addEventListener('toggle', () => (el.open ? ui.openErrors.add(key) : ui.openErrors.delete(key)));
    return el;
  };
  cards.push(
    h(
      'article',
      'adm-card adm-wide',
      h('div', 'adm-label', 'Son istemci hataları'),
      e.client.recent.length === 0
        ? h('div', 'adm-sub', 'Hata yok.')
        : h(
            'ul',
            'adm-rows',
            e.client.recent.map((x) =>
              h(
                'li',
                'adm-row adm-row-top',
                h(
                  'div',
                  'adm-row-main',
                  h(
                    'div',
                    'adm-badges',
                    badge(ago(x.at, now)),
                    badge(`${PLATFORM[x.platform] ?? x.platform} ${x.version}`),
                    badge(x.where),
                    badge(x.user ? `@${x.user}` : 'oturumsuz', 'muted'),
                  ),
                  h('div', 'adm-error-msg', x.message),
                  x.stack && details(`c${x.at}${x.message}`, 'Yığın izi', x.stack),
                ),
              ),
            ),
          ),
    ),
  );
  cards.push(
    h(
      'article',
      'adm-card adm-wide',
      h('div', 'adm-label', 'Son sunucu hataları'),
      e.server.recent.length === 0
        ? h('div', 'adm-sub', 'Hata yok.')
        : h(
            'ul',
            'adm-rows',
            e.server.recent.map((x) =>
              h(
                'li',
                'adm-row adm-row-top',
                h(
                  'div',
                  'adm-row-main',
                  h('div', 'adm-badges', badge(ago(x.at, now)), badge(String(x.status), 'warn'), badge(`${x.method} ${x.route}`)),
                  x.message && h('div', 'adm-error-msg', x.message),
                ),
              ),
            ),
          ),
    ),
  );
  return cards;
}

const FEEDBACK = [
  ['yeni', 'Yeni'],
  ['incelendi', 'İncelendi'],
  ['planlandi', 'Planlandı'],
  ['tamamlandi', 'Tamamlandı'],
  ['reddedildi', 'Reddedildi'],
];

function feedback(d) {
  const f = d.feedback;
  return [
    h(
      'article',
      `adm-card adm-wide${f.counts.yeni > 0 ? ' adm-tone-accent' : ''}`,
      h('div', 'adm-label', `Durumlara göre (toplam ${num(f.total)})`),
      h(
        'div',
        'adm-stats',
        FEEDBACK.map(([key, label]) =>
          h(
            'div',
            `adm-stat${key === 'yeni' && f.counts[key] > 0 ? ' adm-stat-new' : ''}`,
            h('b', null, num(f.counts[key] ?? 0)),
            h('span', null, label),
          ),
        ),
      ),
      h(
        'div',
        'adm-sub adm-note',
        'Ayrıntılar, durum değiştirme ve not yazma masaüstü uygulamasında: ',
        h('b', null, 'Ayarlar → Geri bildirimler (yönetim)'),
        '.',
      ),
    ),
  ];
}

// ---------- Başlangıç ----------

if (token) {
  show('adm-loading');
  void refresh();
} else {
  show('adm-login');
}
