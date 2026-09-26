#!/usr/bin/env bash
# Diskort veritabanının tutarlı bir kopyasını alır (uygulama çalışırken güvenlidir),
# bütünlüğünü doğrular, sıkıştırır ve KEEP_DAYS günden eski yedekleri siler.
# Günlük olarak systemd zamanlayıcısı çalıştırır (infra/systemd/diskort-backup.timer).
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/diskort}"
KEEP_DAYS="${KEEP_DAYS:-14}"
cd "$(dirname "$0")"

stamp="$(date +%F_%H%M)"
tmp="/data/backup-${stamp}.db"
out="${BACKUP_DIR}/diskort-${stamp}.db"
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

# VACUUM INTO: yazma işlemleri sürerken bile tutarlı tek dosyalık kopya üretir.
summary="$(docker compose exec -T api node --no-warnings -e "
const { DatabaseSync } = require('node:sqlite');
const src = new DatabaseSync('/data/diskort.db');
src.exec(\"VACUUM INTO '${tmp}'\");
src.close();
const copy = new DatabaseSync('${tmp}', { readOnly: true });
const check = copy.prepare('PRAGMA integrity_check').get().integrity_check;
const users = copy.prepare('SELECT COUNT(*) AS n FROM users').get().n;
const invites = copy.prepare('SELECT COUNT(*) AS n FROM invites').get().n;
copy.close();
if (check !== 'ok') { console.error('bütünlük kontrolü başarısız: ' + check); process.exit(1); }
console.log('kullanıcı=' + users + ' davet=' + invites);
")"

docker compose cp "api:${tmp}" "$out" >/dev/null
docker compose exec -T api rm -f "$tmp"
gzip -9 -f "$out"
chmod 600 "${out}.gz"
ln -sfn "$(basename "${out}.gz")" "${BACKUP_DIR}/latest.db.gz"
find "$BACKUP_DIR" -name 'diskort-*.db.gz' -mtime "+${KEEP_DAYS}" -delete

echo "Yedek alındı: ${out}.gz ($(du -h "${out}.gz" | cut -f1), ${summary})"
