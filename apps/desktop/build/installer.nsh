; Diskort Windows kurulumu (electron-builder nsis.include)
;
; Kurulum düzeni (Discord'daki gibi yönetici izni istemez, kullanıcıya özel):
;   Uygulama         %LOCALAPPDATA%\Programs\diskort\Diskort.exe
;   Ayarlar/oturum   %APPDATA%\Diskort              (kaldırınca silinmez)
;   Günlükler        %APPDATA%\Diskort\logs
;   Güncelleme önb.  %LOCALAPPDATA%\diskort-updater
;   Kayıt defteri    HKCU\Software\921913cc-d4e1-5f2f-9679-952e9a2927d6 ve ...\Uninstall\<aynı GUID>

!macro customInit
  ; Kurulum klasörü her zaman aynıdır. Önceki sürüm başka bir klasördeyse (0.1.2 ve öncesi:
  ; Programs\@diskortdesktop) kurulum onu kendi klasöründen kaldırır, yenisini buraya kurar.
  StrCpy $INSTDIR "$LOCALAPPDATA\Programs\${APP_FILENAME}"
!macroend

!macro customInstall
  !if "${APP_ID}" == "com.diskort.app"
    ; 0.1.2 ve öncesinden kalan klasörler (paket adı "@diskort/desktop" iken kullanılan adlar)
    RMDir /r "$LOCALAPPDATA\Programs\@diskortdesktop"
    RMDir /r "$LOCALAPPDATA\@diskortdesktop-updater"
  !endif

  ; Görev çubuğuna sabitlenmiş kısayol varsa yeni konumu göstersin
  StrCpy $0 "$APPDATA\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar\${SHORTCUT_NAME}.lnk"
  ${If} ${FileExists} "$0"
    CreateShortCut "$0" "$appExe" "" "$appExe" 0
    ClearErrors
    WinShell::SetLnkAUMI "$0" "${APP_ID}"
  ${EndIf}
!macroend

!macro customUnInstall
  ${ifNot} ${isUpdated}
    ; Tamamen kaldırılırken indirilmiş güncellemeleri de sil (ayarlar ve oturum kalır)
    RMDir /r "$LOCALAPPDATA\${APP_FILENAME}-updater"
  ${endIf}
!macroend
