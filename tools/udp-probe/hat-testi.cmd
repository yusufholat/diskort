@echo off
rem Diskort hat testi: cift tikla, test kodunu ve adini yaz. (probe.mjs ile ayni klasorde olmali; yoksa indirilir)
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo  Diskort hat testi (yaklasik 2-3 dakika surer; Wi-Fi yerine kablo daha iyi, test surerken indirme/video acma)
echo.
set /p KOD= Yoneticiden aldigin test kodu:
set /p AD= Adin:
if not exist probe.mjs powershell -NoProfile -Command "Invoke-WebRequest https://raw.githubusercontent.com/yusufholat/diskort/main/tools/udp-probe/probe.mjs -OutFile probe.mjs"
where node >nul 2>nul
if %errorlevel%==0 (
  node probe.mjs --kod %KOD% --ad "%AD%" %*
) else (
  rem Node yoksa Diskort uygulamasinin kendi Node'u kullanilir
  set ELECTRON_RUN_AS_NODE=1
  "%LOCALAPPDATA%\Programs\Diskort\Diskort.exe" probe.mjs --kod %KOD% --ad "%AD%" %*
)
echo.
pause
