# Sunucudaki en son Diskort veritabanı yedeğini bu bilgisayara (varsayılan: OneDrive klasörü) indirir.
# Böylece sunucu tamamen kaybolsa bile yedek bulutta kalır. Windows Görev Zamanlayıcı her gün çalıştırır.
# Elle çalıştırmak için: powershell -ExecutionPolicy Bypass -File scripts\pull-db-backups.ps1
param(
  [string]$Server = 'root@185.92.0.242',
  [string]$Key = "$env:USERPROFILE\.ssh\diskort_vps",
  [string]$Destination = "$(if ($env:OneDrive) { $env:OneDrive } else { $env:USERPROFILE })\Yedekler\Diskort",
  [int]$KeepDays = 60
)

$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force $Destination | Out-Null
$log = Join-Path $Destination 'yedek-gunlugu.txt'

try {
  $name = & ssh -i $Key -o BatchMode=yes -o ConnectTimeout=20 $Server 'readlink /var/backups/diskort/latest.db.gz'
  if ($LASTEXITCODE -ne 0 -or -not $name) { throw "Sunucuya bağlanılamadı veya yedek yok (ssh kodu $LASTEXITCODE)" }
  $name = "$name".Trim()

  $target = Join-Path $Destination $name
  if (Test-Path $target) {
    $status = "zaten var"
  } else {
    & scp -i $Key -o BatchMode=yes -q "${Server}:/var/backups/diskort/$name" $target
    if ($LASTEXITCODE -ne 0) { throw "İndirme başarısız (scp kodu $LASTEXITCODE)" }
    $status = "indirildi ($([math]::Round((Get-Item $target).Length / 1KB, 1)) KB)"
  }

  Get-ChildItem $Destination -Filter 'diskort-*.db.gz' |
    Where-Object LastWriteTime -lt (Get-Date).AddDays(-$KeepDays) |
    Remove-Item -Force

  "$(Get-Date -Format 'yyyy-MM-dd HH:mm') TAMAM  $name $status" | Add-Content -Encoding UTF8 $log
} catch {
  "$(Get-Date -Format 'yyyy-MM-dd HH:mm') HATA   $($_.Exception.Message)" | Add-Content -Encoding UTF8 $log
  exit 1
}
