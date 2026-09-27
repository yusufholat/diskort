// İndirme sayfası: işletim sistemini algılar, en son sürüm bilgisini API'den alır.
(() => {
  const PLATFORM_INFO = {
    windows: { label: 'Windows için İndir', icon: '#i-windows', req: 'Windows 10 / 11 · 64-bit', asset: 'windows' },
    linux: { label: 'Linux için İndir', icon: '#i-linux', req: 'AppImage · 64-bit', asset: 'linux-appimage' },
    mac: { label: 'macOS için İndir', icon: '#i-mac', req: 'Apple Silicon · macOS 12 ve üzeri', asset: 'mac-arm64' },
    android: { label: 'Android için İndir', icon: '#i-phone', req: 'Android 7 ve üzeri · APK', asset: 'android' },
  };

  function detectOS() {
    const ua = navigator.userAgent || '';
    const platform = ((navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '').toLowerCase();
    if (/android/i.test(ua)) return 'android';
    // iPadOS masaüstü Safari gibi görünür ("Macintosh"); dokunmatik ekranından ayırt edilir
    if (/iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1)) return 'ios';
    if (navigator.userAgentData?.mobile) return 'mobile';
    if (platform.includes('win') || /windows/i.test(ua)) return 'windows';
    if (platform.includes('mac') || /mac os x/i.test(ua)) return 'mac';
    if (platform.includes('linux') || /linux|x11/i.test(ua)) return 'linux';
    return 'windows';
  }

  function formatSize(bytes) {
    return `${Math.round(bytes / 1024 / 1024)} MB`;
  }

  const os = detectOS();

  // Chromium tabanlı tarayıcılar Mac işlemci mimarisini söyleyebilir; Intel ise o sürümü öne çıkar.
  if (os === 'mac' && navigator.userAgentData?.getHighEntropyValues) {
    navigator.userAgentData
      .getHighEntropyValues(['architecture'])
      .then(({ architecture }) => {
        if (architecture === 'x86') {
          PLATFORM_INFO.mac.asset = 'mac-x64';
          PLATFORM_INFO.mac.req = 'Intel · macOS 12 ve üzeri';
        }
      })
      .catch(() => undefined);
  }
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
      primaryLabel.textContent = `${{ mac: 'macOS', linux: 'Linux', android: 'Android' }[key] ?? key} sürümü yakında`;
      primaryLinks.forEach((a) => {
        a.setAttribute('aria-disabled', 'true');
        a.removeAttribute('href');
      });
      primaryMeta.textContent = 'Şimdilik Windows sürümü kullanılabilir.';
    }
  }

  // iOS: kurulum bağlantısı iPhone'un "Yükle" penceresini açar (IPA'nın bildirimi sunucudan)
  const iosInstallUrl = `itms-services://?action=download-manifest&url=${encodeURIComponent(
    `${location.origin}/download/ios/manifest.plist`,
  )}`;
  document.getElementById('ios-install').href = iosInstallUrl;

  if (os === 'mobile' || os === 'ios') {
    document.getElementById('mobile-notice').hidden = false;
  } else {
    setPrimary(os, true);
  }
  document.querySelector(`.platform[data-platform="${os}"]`)?.classList.add('current');

  // Davet bağlantısı: https://<sunucu>/davet/<kod>
  const inviteMatch = /^\/davet\/([A-Za-z0-9]{4,32})\/?$/.exec(location.pathname);
  if (inviteMatch) {
    const code = inviteMatch[1].toUpperCase();
    const card = document.getElementById('invite-card');
    document.getElementById('invite-code').textContent = code;
    document.getElementById('invite-copy').addEventListener('click', (e) => {
      navigator.clipboard?.writeText(code).then(() => {
        e.target.textContent = 'Kopyalandı';
      });
    });
    // Android'de kurulu uygulama bağlantıyla açılır (katılma ekranı kodla hazır gelir)
    if (os === 'android') {
      const open = document.getElementById('invite-open');
      open.href = `diskort://davet/${code}`;
      open.hidden = false;
    }
    card.hidden = false;
    fetch(`/api/invites/${encodeURIComponent(code)}`, { headers: { Accept: 'application/json' } })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((invite) => {
        const icon = document.getElementById('invite-icon');
        if (invite.guild) {
          document.getElementById('invite-name').textContent = invite.guild.name;
          document.getElementById('invite-meta').textContent = `${invite.memberCount} üye`;
          if (invite.guild.iconUrl) {
            const img = document.createElement('img');
            img.src = invite.guild.iconUrl;
            img.alt = '';
            icon.appendChild(img);
          } else {
            icon.textContent = invite.guild.name
              .trim()
              .split(/\s+/)
              .slice(0, 3)
              .map((w) => w[0] || '')
              .join('')
              .toLocaleUpperCase('tr');
          }
        } else {
          document.getElementById('invite-label').textContent = 'Diskort hesabı daveti';
          document.getElementById('invite-name').textContent = 'Diskort';
          icon.textContent = 'D';
        }
      })
      .catch(() => {
        document.getElementById('invite-label').textContent = 'Bu davet geçersiz ya da süresi dolmuş';
        document.getElementById('invite-steps').textContent = 'Seni davet eden kişiden yeni bir davet bağlantısı iste.';
        card.classList.add('invalid');
      });
  }

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
        mac: platforms['mac-arm64']?.size ?? platforms['mac-x64']?.size,
        android: platforms.android?.size,
        ios: platforms.ios?.size,
      };
      document.querySelectorAll('[data-meta]').forEach((el) => {
        const size = sizes[el.dataset.meta];
        el.textContent = size ? `Sürüm ${latest.version} · ${formatSize(size)}` : '';
      });

      // iOS sürümü yalnızca imzalı IPA yayınlandıysa görünür
      if (platforms.ios) {
        document.getElementById('ios-card').hidden = false;
        if (os === 'ios') {
          document.getElementById('mobile-notice').hidden = true;
          primaryLinks.forEach((a) => {
            a.href = iosInstallUrl;
            a.removeAttribute('aria-disabled');
          });
          primaryIcon.setAttribute('href', '#i-phone');
          primaryLabel.textContent = 'iPhone için Yükle';
          primaryMeta.textContent = `Sürüm ${latest.version} · yalnızca kayıtlı iPhone'lar`;
        }
      }

      if (os !== 'mobile' && os !== 'ios') {
        const info = PLATFORM_INFO[os];
        const asset = platforms[info.asset];
        setPrimary(os, Boolean(asset), latest.version, asset?.size);
      }
      document.getElementById('footer-version').textContent = `Sürüm ${latest.version}`;
    })
    .catch(() => {
      // Sürüm bilgisi alınamazsa butonlar yine çalışır (sunucu doğru dosyaya yönlendirir).
    });
})();
