// İndirme sayfası: işletim sistemini algılar, en son sürüm bilgisini API'den alır.
(() => {
  const PLATFORM_INFO = {
    windows: { label: 'Windows için İndir', icon: '#i-windows', req: 'Windows 10 / 11 · 64-bit', asset: 'windows' },
    linux: { label: 'Linux için İndir', icon: '#i-linux', req: 'AppImage · 64-bit', asset: 'linux-appimage' },
    mac: { label: 'macOS için İndir', icon: '#i-mac', req: 'macOS 12 ve üzeri', asset: 'mac' },
  };

  function detectOS() {
    const ua = navigator.userAgent || '';
    const platform = ((navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '').toLowerCase();
    if (/android|iphone|ipad|ipod/i.test(ua) || navigator.userAgentData?.mobile) return 'mobile';
    if (platform.includes('win') || /windows/i.test(ua)) return 'windows';
    if (platform.includes('mac') || /mac os x/i.test(ua)) return 'mac';
    if (platform.includes('linux') || /linux|x11/i.test(ua)) return 'linux';
    return 'windows';
  }

  function formatSize(bytes) {
    return `${Math.round(bytes / 1024 / 1024)} MB`;
  }

  const os = detectOS();
  const primaryLinks = document.querySelectorAll('[data-primary-download]');
  const primaryLabel = document.getElementById('primary-label');
  const primaryIcon = document.getElementById('primary-icon');
  const primaryMeta = document.getElementById('primary-meta');

  function setPrimary(key, available, version, size) {
    const info = PLATFORM_INFO[key];
    primaryLinks.forEach((a) => {
      a.href = `/download/${info.asset}`;
      a.removeAttribute('aria-disabled');
    });
    primaryIcon.setAttribute('href', info.icon);
    if (available) {
      primaryLabel.textContent = info.label;
      primaryMeta.textContent = [version && `Sürüm ${version}`, size && formatSize(size), info.req].filter(Boolean).join(' · ');
    } else {
      // Bu platform henüz yok: Windows sürümüne yönlendir, durumu açıkça yaz.
      primaryLabel.textContent = `${key === 'mac' ? 'macOS' : 'Linux'} sürümü yakında`;
      primaryLinks.forEach((a) => {
        a.setAttribute('aria-disabled', 'true');
        a.removeAttribute('href');
      });
      primaryMeta.textContent = 'Şimdilik Windows sürümü kullanılabilir.';
    }
  }

  if (os === 'mobile') {
    document.getElementById('mobile-notice').hidden = false;
  } else {
    setPrimary(os, true);
  }
  document.querySelector(`.platform[data-platform="${os}"]`)?.classList.add('current');

  fetch('/api/download/latest', { headers: { Accept: 'application/json' } })
    .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
    .then((latest) => {
      const platforms = latest.platforms || {};

      // Platform kartlarındaki butonları mevcut dosyalara göre güncelle
      document.querySelectorAll('[data-asset]').forEach((a) => {
        const asset = platforms[a.dataset.asset];
        if (!asset) {
          a.setAttribute('aria-disabled', 'true');
          a.removeAttribute('href');
          a.textContent = 'Yakında';
        }
      });
      const sizes = {
        windows: platforms.windows?.size,
        linux: platforms['linux-appimage']?.size ?? platforms['linux-deb']?.size,
        mac: platforms.mac?.size,
      };
      document.querySelectorAll('[data-meta]').forEach((el) => {
        const size = sizes[el.dataset.meta];
        el.textContent = size ? `Sürüm ${latest.version} · ${formatSize(size)}` : '';
      });

      if (os !== 'mobile') {
        const info = PLATFORM_INFO[os];
        const asset = platforms[info.asset];
        setPrimary(os, Boolean(asset), latest.version, asset?.size);
      }
      document.getElementById('footer-version').textContent = `Masaüstü uygulaması · Sürüm ${latest.version}`;
    })
    .catch(() => {
      // Sürüm bilgisi alınamazsa butonlar yine çalışır (sunucu doğru dosyaya yönlendirir).
    });
})();
