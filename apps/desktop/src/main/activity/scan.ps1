# Oyun algılamanın Windows yardımcısı (bkz. scanner.ts). Uzun ömürlü, gizli tek bir süreçtir:
#  - her taramada (~15 sn) görünür penceresi olan süreçleri tek satır JSON olarak yazar,
#  - stdin'den gelen satırları işler: "scan" (hemen tara) ya da {"t":"icon","id":1,"path":"..."} (exe ikonu).
# stdin kapanınca (Diskort kapandı) kendiliğinden çıkar. Yerel modül gerekmez: Win32 çağrıları Add-Type ile.
# $stdin okuyucusunu önyükleyici (scanner.ts) kurar; betik aynı kapsamda çalışır.

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$out = New-Object System.IO.StreamWriter([Console]::OpenStandardOutput(), (New-Object System.Text.UTF8Encoding($false)))
$out.AutoFlush = $true
# Oyunun işlemcisini çalmasın
try { [System.Diagnostics.Process]::GetCurrentProcess().PriorityClass = 'Idle' } catch {}

$IntervalMs = 15000
$MaxProcs = 200
$IconMaxSize = 128
$IconMaxBytes = 65536

function Emit($obj) { $out.WriteLine((ConvertTo-Json -InputObject $obj -Compress -Depth 4)) }

function Cut($s, $n) {
  if ($null -eq $s) { return $null }
  $t = ([string]$s).Trim()
  if ($t.Length -eq 0) { return $null }
  if ($t.Length -gt $n) { return $t.Substring(0, $n) }
  return $t
}

$native = $false
try {
  Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

public static class DiskortScan {
  delegate bool EnumProc(IntPtr hwnd, IntPtr lparam);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr lparam);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr hwnd, uint cmd);
  [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr hwnd);
  [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr hwnd, int index);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll")] static extern bool DestroyIcon(IntPtr hicon);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr hwnd, int attr, out int value, int size);
  [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool QueryFullProcessImageName(IntPtr h, uint flags, StringBuilder name, ref uint size);
  [DllImport("kernel32.dll")] static extern bool GetProcessTimes(IntPtr h, out long creation, out long exit, out long kernel, out long user);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);

  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct SHFILEINFO {
    public IntPtr hIcon; public int iIcon; public uint dwAttributes;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string szDisplayName;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 80)] public string szTypeName;
  }
  [DllImport("shell32.dll", CharSet = CharSet.Unicode)] static extern IntPtr SHGetFileInfo(string path, uint attrs, ref SHFILEINFO info, uint size, uint flags);
  [DllImport("shell32.dll", EntryPoint = "#727")] static extern int SHGetImageList(int list, ref Guid riid, out IImageList ppv);

  // Yalnızca GetIcon çağrılır; öncekiler sanal tablodaki sırayı tutmak için
  [ComImport, Guid("46EB5926-582E-4017-9FDF-E8998DAA0950"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IImageList {
    [PreserveSig] int Add(IntPtr image, IntPtr mask, ref int index);
    [PreserveSig] int ReplaceIcon(int index, IntPtr hicon, ref int result);
    [PreserveSig] int SetOverlayImage(int image, int overlay);
    [PreserveSig] int Replace(int index, IntPtr image, IntPtr mask);
    [PreserveSig] int AddMasked(IntPtr image, int mask, ref int index);
    [PreserveSig] int Draw(IntPtr parameters);
    [PreserveSig] int Remove(int index);
    [PreserveSig] int GetIcon(int index, int flags, ref IntPtr hicon);
  }

  // Yükseltilmiş (yönetici) süreçlerde de verilir; Get-Process'in yolu onlarda boş kalır
  const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
  const long UNIX_EPOCH_FILETIME = 116444736000000000L;

  // Görünür, sahipsiz, başlığı olan üst düzey pencerelerin süreçleri: "pid<TAB>başlangıç (ms)<TAB>yol".
  // Yol ya da başlangıç okunamadıysa boş / 0 kalır.
  public static string[] Scan() {
    var pids = new HashSet<uint>();
    EnumWindows((hwnd, l) => {
      if (!IsWindowVisible(hwnd)) return true;
      if (GetWindow(hwnd, 4) != IntPtr.Zero) return true;            // GW_OWNER
      if ((GetWindowLong(hwnd, -20) & 0x80) != 0) return true;       // WS_EX_TOOLWINDOW
      if (GetWindowTextLength(hwnd) == 0) return true;
      int cloaked;                                                   // askıdaki mağaza uygulamaları
      if (DwmGetWindowAttribute(hwnd, 14, out cloaked, 4) == 0 && cloaked != 0) return true;
      uint pid;
      GetWindowThreadProcessId(hwnd, out pid);
      if (pid != 0) pids.Add(pid);
      return true;
    }, IntPtr.Zero);

    var lines = new List<string>();
    var sb = new StringBuilder(1024);
    foreach (uint pid in pids) {
      string path = "";
      long start = 0;
      IntPtr h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
      if (h != IntPtr.Zero) {
        try {
          uint size = (uint)sb.Capacity;
          if (QueryFullProcessImageName(h, 0, sb, ref size)) path = sb.ToString(0, (int)size);
          long c, e, k, u;
          if (GetProcessTimes(h, out c, out e, out k, out u)) start = (c - UNIX_EPOCH_FILETIME) / 10000;
        } finally { CloseHandle(h); }
      }
      lines.Add(pid + "\t" + start + "\t" + path);
    }
    return lines.ToArray();
  }

  static Bitmap Render(Bitmap source, Rectangle area, int size) {
    var target = new Bitmap(size, size, PixelFormat.Format32bppArgb);
    using (var g = Graphics.FromImage(target)) {
      g.InterpolationMode = InterpolationMode.HighQualityBicubic;
      g.PixelOffsetMode = PixelOffsetMode.HighQuality;
      g.CompositingQuality = CompositingQuality.HighQuality;
      using (var attrs = new ImageAttributes()) {
        attrs.SetWrapMode(WrapMode.TileFlipXY);                      // kenarlarda saydam saçak olmasın
        g.DrawImage(source, new Rectangle(0, 0, size, size), area.X, area.Y, area.Width, area.Height, GraphicsUnit.Pixel, attrs);
      }
    }
    return target;
  }

  // Saydam olmayan piksellerin çerçevesi (hiç yoksa boş)
  static Rectangle Opaque(Bitmap bitmap) {
    int w = bitmap.Width, h = bitmap.Height, minX = w, minY = h, maxX = -1, maxY = -1;
    var data = bitmap.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
    try {
      var row = new byte[w * 4];
      for (int y = 0; y < h; y++) {
        Marshal.Copy(IntPtr.Add(data.Scan0, y * data.Stride), row, 0, row.Length);
        for (int x = 0; x < w; x++) {
          if (row[x * 4 + 3] < 8) continue;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    } finally { bitmap.UnlockBits(data); }
    return maxX < 0 ? Rectangle.Empty : Rectangle.FromLTRB(minX, minY, maxX + 1, maxY + 1);
  }

  static readonly int[] ICON_SIZES = { 16, 20, 24, 32, 40, 48, 64, 72, 96, 128 };

  // Dosyanın kabuk ikonu, kare PNG olarak (kenar <= maxSize, boyut <= maxBytes). null yalnızca exe'nin kendi
  // ikonu yoksa döner; ikon varken çıkarılamazsa (kabuk ya da çizim hatası) istisna atılır ki ana süreç başka
  // yoldan denesin. En büyük (256) görüntü listesinden alınır. Dosyada büyük ikon yoksa kabuk küçük ikonu 256'lık tuvalin
  // sol üst köşesine çizer: o durumda yalnızca o köşe kırpılır (büyütülmez).
  public static byte[] Icon(string path, int maxSize, int maxBytes) {
    var info = new SHFILEINFO();
    if (SHGetFileInfo(path, 0, ref info, (uint)Marshal.SizeOf(info), 0x4000) == IntPtr.Zero)             // SHGFI_SYSICONINDEX
      throw new InvalidOperationException("SHGetFileInfo");
    // Kendi ikonu olmayan exe: Windows'un genel uygulama ikonu yüklenmez (SHGFI_USEFILEATTRIBUTES ile sorulur)
    var generic = new SHFILEINFO();
    if (SHGetFileInfo(".exe", 0x80, ref generic, (uint)Marshal.SizeOf(generic), 0x4010) != IntPtr.Zero && generic.iIcon == info.iIcon) return null;
    foreach (int list in new[] { 4, 2 }) {                           // SHIL_JUMBO, SHIL_EXTRALARGE
      var iid = new Guid("46EB5926-582E-4017-9FDF-E8998DAA0950");
      IImageList images;
      if (SHGetImageList(list, ref iid, out images) != 0 || images == null) continue;
      IntPtr hicon = IntPtr.Zero;
      if (images.GetIcon(info.iIcon, 1, ref hicon) != 0 || hicon == IntPtr.Zero) continue; // ILD_TRANSPARENT
      try {
        using (var icon = System.Drawing.Icon.FromHandle(hicon))
        using (var full = icon.ToBitmap()) {
          var box = Opaque(full);
          if (box.Width == 0) continue;
          var area = new Rectangle(0, 0, full.Width, full.Height);
          int extent = Math.Max(box.Right, box.Bottom);
          if (extent <= full.Width / 2) {
            int side = extent;
            foreach (int s in ICON_SIZES) { if (s >= extent) { side = s; break; } }
            area = new Rectangle(0, 0, side, side);
          }
          for (int size = Math.Min(maxSize, area.Width); size >= 16; size = size * 3 / 4) {
            using (var scaled = Render(full, area, size))
            using (var stream = new MemoryStream()) {
              scaled.Save(stream, ImageFormat.Png);
              if (stream.Length <= maxBytes) return stream.ToArray();
            }
          }
        }
      } catch {
      } finally { DestroyIcon(hicon); }
    }
    throw new InvalidOperationException("icon");
  }
}
'@
  $native = $true
} catch {}

# Steam'in kurulu olduğu klasör (kitaplıklar ana süreçte libraryfolders.vdf'den okunur)
$steam = $null
foreach ($key in 'HKCU:\Software\Valve\Steam', 'HKLM:\SOFTWARE\WOW6432Node\Valve\Steam', 'HKLM:\SOFTWARE\Valve\Steam') {
  try {
    $p = Get-ItemProperty -Path $key
    $v = if ($p.SteamPath) { $p.SteamPath } else { $p.InstallPath }
    if ($v) { $steam = [string]$v; break }
  } catch {}
}
Emit @{ t = 'hello'; native = $native; steam = $steam }

$versions = @{}
$cimInfo = @{}
$epoch = New-Object DateTime(1970, 1, 1, 0, 0, 0, [DateTimeKind]::Utc)

function Get-Rows {
  if ($native) {
    foreach ($line in [DiskortScan]::Scan()) {
      $f = $line.Split([char]9)
      @{ pid = [int]$f[0]; start = [long]$f[1]; path = $f[2] }
    }
    return
  }
  # Add-Type başarısız oldu (ör. C# derleyicisi engellendi): daha yavaş ve yükseltilmiş süreçlerde yolu
  # veremeyen yol. (Kısıtlı dil kipinde önyükleyici de çalışamaz; o durumda ana süreç birkaç denemeden sonra
  # vazgeçer.)
  foreach ($p in Get-Process) {
    try {
      if ($p.MainWindowHandle -eq 0) { continue }
      $start = 0
      try { $start = [long]($p.StartTime.ToUniversalTime() - $epoch).TotalMilliseconds } catch {}
      $path = ''
      try { $path = [string]$p.Path } catch {}
      @{ pid = $p.Id; start = $start; path = $path }
    } catch {}
  }
}

function Scan {
  $procs = New-Object System.Collections.ArrayList
  $alive = @{}
  foreach ($row in @(Get-Rows)) {
    if ($procs.Count -ge $MaxProcs) { break }
    $id = $row.pid
    $path = $row.path
    $start = $row.start
    if (-not $path -or $start -le 0) {
      # Yol okunamadı (korunan süreç): CIM'den denenir, süreç başına yalnızca bir kez
      $alive[$id] = $true
      if (-not $cimInfo.ContainsKey($id)) {
        $entry = @{ path = ''; start = 0 }
        try {
          $c = Get-CimInstance Win32_Process -Filter "ProcessId=$([int]$id)" -Property ExecutablePath, CreationDate
          if ($c) {
            if ($c.ExecutablePath) { $entry.path = [string]$c.ExecutablePath }
            if ($c.CreationDate) { $entry.start = [long]($c.CreationDate.ToUniversalTime() - $epoch).TotalMilliseconds }
          }
        } catch {}
        $cimInfo[$id] = $entry
      }
      if (-not $path) { $path = $cimInfo[$id].path }
      if ($start -le 0) { $start = $cimInfo[$id].start }
    }
    if (-not $path) { continue }
    # Sürüm bilgisi (ürün adı, açıklama) yol başına bir kez okunur
    if (-not $versions.ContainsKey($path)) {
      $entry = @{ product = $null; desc = $null }
      try {
        $v = [System.Diagnostics.FileVersionInfo]::GetVersionInfo($path)
        $entry.product = Cut $v.ProductName 128
        $entry.desc = Cut $v.FileDescription 128
      } catch {}
      if ($versions.Count -gt 2000) { $versions.Clear() }
      $versions[$path] = $entry
    }
    $info = $versions[$path]
    [void]$procs.Add(@{ pid = $id; path = $path; start = $start; product = $info.product; desc = $info.desc })
  }
  foreach ($id in @($cimInfo.Keys)) { if (-not $alive.ContainsKey($id)) { $cimInfo.Remove($id) } }
  Emit @{ t = 'scan'; procs = $procs.ToArray() }
}

function Handle($line) {
  $cmd = $null
  try { $cmd = ConvertFrom-Json -InputObject $line } catch { return }
  if ($cmd.t -eq 'icon') {
    # ok: yanıt kesin (png null ise exe'nin kendi ikonu yok). ok değil: çıkarılamadı (Win32 yardımcıları yok
    # ya da hata); ana süreç başka yoldan dener
    $png = $null
    $ok = $false
    if ($native) {
      try {
        $bytes = [DiskortScan]::Icon([string]$cmd.path, $IconMaxSize, $IconMaxBytes)
        if ($bytes) { $png = [Convert]::ToBase64String($bytes) }
        $ok = $true
      } catch {}
    }
    Emit @{ t = 'icon'; id = [int]$cmd.id; png = $png; ok = $ok }
  }
}

$pending = $stdin.ReadLineAsync()
while ($true) {
  try { Scan } catch { Emit @{ t = 'error'; message = (Cut $_.Exception.Message 200) } }
  $deadline = [DateTime]::UtcNow.AddMilliseconds($IntervalMs)
  while ($true) {
    $left = [int]($deadline - [DateTime]::UtcNow).TotalMilliseconds
    if ($left -le 0) { break }
    if (-not $pending.Wait($left)) { break }
    $line = $pending.Result
    if ($null -eq $line) { exit 0 }  # ana süreç kapandı
    $pending = $stdin.ReadLineAsync()
    if ($line -eq 'scan') { break }
    Handle $line
  }
}
