# Sunucudaki Diskort yedeklerini bu bilgisayara (varsayılan: OneDrive klasörü) indirir: en son veritabanı
# yedeğini ve dosya eklerinin (mesajlardaki resim/dosyalar) aynasını. Böylece sunucu tamamen kaybolsa bile
# yedek bulutta kalır. Windows Görev Zamanlayıcı her gün çalıştırır.
# Elle çalıştırmak için: powershell -ExecutionPolicy Bypass -File scripts\pull-db-backups.ps1
param(
  [string]$Server = 'root@185.92.0.242',
  [string]$Key = "$env:USERPROFILE\.ssh\diskort_vps",
  [string]$Destination = "$(if ($env:OneDrive) { $env:OneDrive } else { $env:USERPROFILE })\Yedekler\Diskort",
  # Dosya ekleri (boşsa: <Destination>\ekler)
  [string]$AttachmentsDestination = '',
  [int]$KeepDays = 60
)

$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force $Destination | Out-Null
$log = Join-Path $Destination 'yedek-gunlugu.txt'
$sshArgs = @('-i', $Key, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=20')
$remoteAttachments = '/var/backups/diskort/attachments'

function Invoke-Remote([string]$Command) {
  $output = & ssh @sshArgs $Server $Command
  if ($LASTEXITCODE -ne 0) { throw "Sunucu komutu başarısız (ssh kodu $LASTEXITCODE): $Command" }
  return $output
}

try {
  # 1) Veritabanı: en son yedek
  $name = & ssh @sshArgs $Server 'readlink /var/backups/diskort/latest.db.gz'
  if ($LASTEXITCODE -ne 0 -or -not $name) { throw "Sunucuya bağlanılamadı veya yedek yok (ssh kodu $LASTEXITCODE)" }
  $name = "$name".Trim()

  $target = Join-Path $Destination $name
  if (Test-Path $target) {
    $status = "zaten var"
  } else {
    & scp @sshArgs -q "${Server}:/var/backups/diskort/$name" $target
    if ($LASTEXITCODE -ne 0) { throw "İndirme başarısız (scp kodu $LASTEXITCODE)" }
    $status = "indirildi ($([math]::Round((Get-Item $target).Length / 1KB, 1)) KB)"
  }

  Get-ChildItem $Destination -Filter 'diskort-*.db.gz' |
    Where-Object LastWriteTime -lt (Get-Date).AddDays(-$KeepDays) |
    Remove-Item -Force

  # 2) Dosya ekleri: sunucudaki günlük kopyanın aynası (infra/backup-attachments.sh). Dosyalar hiç
  # değişmediği için yalnızca eksik olanlar indirilir.
  $attachments = if ($AttachmentsDestination) { $AttachmentsDestination } else { Join-Path $Destination 'ekler' }
  New-Item -ItemType Directory -Force $attachments | Out-Null
  $listing = Invoke-Remote "test -d $remoteAttachments && ls -1 $remoteAttachments"
  $remote = [System.Collections.Generic.HashSet[string]]::new()
  foreach ($line in @($listing)) { if ("$line" -match '^[0-9a-f]{32}$') { [void]$remote.Add("$line") } }
  $local = @(Get-ChildItem $attachments -File | Where-Object Name -Match '^[0-9a-f]{32}$' | Select-Object -ExpandProperty Name)
  $localSet = [System.Collections.Generic.HashSet[string]]::new([string[]]$local)
  $missing = @($remote | Where-Object { -not $localSet.Contains($_) })

  # Toplu indirme: sunucuda tar paketi yapılır, tek seferde indirilip açılır (komut satırı sınırı için 400'erli)
  $tempTar = Join-Path $env:TEMP 'diskort-ekler.tar'
  for ($i = 0; $i -lt $missing.Count; $i += 400) {
    $batch = $missing[$i..([math]::Min($i + 399, $missing.Count - 1))]
    $remoteTar = "/tmp/diskort-ekler-$PID.tar"
    Invoke-Remote "cd $remoteAttachments && tar -cf $remoteTar $($batch -join ' ')" | Out-Null
    try {
      & scp @sshArgs -q "${Server}:$remoteTar" $tempTar
      if ($LASTEXITCODE -ne 0) { throw "Ek indirme başarısız (scp kodu $LASTEXITCODE)" }
    } finally {
      & ssh @sshArgs $Server "rm -f $remoteTar" | Out-Null
    }
    & tar -xf $tempTar -C $attachments
    if ($LASTEXITCODE -ne 0) { throw "Ek paketi açılamadı (tar kodu $LASTEXITCODE)" }
    Remove-Item $tempTar -Force
  }

  # Sunucudaki kopyada süresi dolup silinenler (silinen mesajların dosyaları, 30 gün sonra) buradan da silinir.
  # Sunucu hiç dosya bildirmediyse (beklenmedik durum) hiçbir şey silinmez.
  $removed = 0
  if ($remote.Count -gt 0) {
    foreach ($file in $local) {
      if (-not $remote.Contains($file)) {
        Remove-Item (Join-Path $attachments $file) -Force
        $removed++
      }
    }
  }
  $attachmentStatus = "ekler: $($remote.Count) dosya, yeni $($missing.Count), silinen $removed"

  "$(Get-Date -Format 'yyyy-MM-dd HH:mm') TAMAM  $name $status; $attachmentStatus" | Add-Content -Encoding UTF8 $log
} catch {
  "$(Get-Date -Format 'yyyy-MM-dd HH:mm') HATA   $($_.Exception.Message)" | Add-Content -Encoding UTF8 $log
  exit 1
}
