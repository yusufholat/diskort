#!/usr/bin/env bash
# Dosya eklerinin (mesajlardaki resim/dosyalar) günlük anlık kopyası: BACKUP_DIR/attachments.
# Ekler hiç değişmez (adları rastgele kimlik), bu yüzden kopya "sabit bağlantı" (hard link) ile alınır:
# diskte ek yer kaplamaz. Mesaj silinip dosya uygulamadan kalkınca kopyadaki bağlantı tek başına kalır
# ve KEEP_DAYS gün sonra silinir; yanlışlıkla silinenler bu süre içinde geri getirilebilir.
# Bilgisayardaki yedek (scripts/pull-db-backups.ps1) bu klasörü aynalar.
# Günlük olarak systemd zamanlayıcısı çalıştırır (infra/systemd/diskort-backup.service).
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/diskort}"
KEEP_DAYS="${KEEP_DAYS:-30}"
cd "$(dirname "$0")"

# api kapsayıcısındaki /data'nın sunucudaki yeri (Docker birimi)
container="$(docker compose ps -q api)"
data="$(docker inspect "$container" --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Source}}{{end}}{{end}}')"
src="${data}/attachments"
dst="${BACKUP_DIR}/attachments"
mkdir -p "$dst"
chmod 700 "$BACKUP_DIR" "$dst"

added=0
if [ -d "$src" ]; then
  # Yalnızca tamamlanmış ekler (32 onaltılık karakterlik ad); yarım yüklemeler (.part) alınmaz
  while IFS= read -r -d '' file; do
    name="$(basename "$file")"
    if [ ! -e "${dst}/${name}" ]; then
      ln "$file" "${dst}/${name}"
      added=$((added + 1))
    fi
  done < <(find "$src" -maxdepth 1 -type f -regextype posix-egrep -regex '.*/[0-9a-f]{32}' -print0)
fi

# Uygulamadan silinmiş (bağlantı sayısı 1'e düşmüş) ve KEEP_DAYS günü geçmiş kopyalar. Bağlantı sayısı
# değişince dosyanın ctime'ı güncellenir; yani süre silinme anından itibaren sayılır.
removed="$(find "$dst" -maxdepth 1 -type f -links 1 -ctime "+${KEEP_DAYS}" -print -delete | wc -l)"

count="$(find "$dst" -maxdepth 1 -type f | wc -l)"
size="$(du -sh "$dst" | cut -f1)"
echo "Ek yedeği: ${count} dosya (${size}), yeni ${added}, süresi dolup silinen ${removed}"
