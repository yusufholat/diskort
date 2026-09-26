// Uygulamanın resmi dağıtım adresi: güncellemeler (/updates) ve indirme sayfası (/download).
// Sohbet sunucusu adresinden bağımsızdır (kullanıcı giriş ekranında başka sunucu seçse bile
// uygulama güncellemeleri buradan gelir). Sunucu tarafı: apps/server/src/routes/updates.ts
export const DISTRIBUTION_URL = 'https://diskort.ziroo.net';
export const UPDATE_FEED_URL = `${DISTRIBUTION_URL}/updates`;
export const DOWNLOAD_PAGE_URL = `${DISTRIBUTION_URL}/download`;
