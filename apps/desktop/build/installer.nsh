; Diskort Windows kurulumu (electron-builder nsis.include)
;
; Kurulum düzeni (Discord'daki gibi yönetici izni istemez, kullanıcıya özel):
;   Uygulama         %LOCALAPPDATA%\Programs\diskort\Diskort.exe
;   Ayarlar/oturum   %APPDATA%\Diskort              (kaldırınca silinmez)
;   Günlükler        %APPDATA%\Diskort\logs
;   Güncelleme önb.  %LOCALAPPDATA%\diskort-updater
;   Kayıt defteri    HKCU\Software\921913cc-d4e1-5f2f-9679-952e9a2927d6 ve ...\Uninstall\<aynı GUID>
;   Bağlantılar      HKCU\Software\Classes\diskort (diskort://davet/<kod>; uygulama da açılışta yazar)

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

  ; Davet bağlantıları (diskort://davet/<kod>) uygulamayı açsın, ilk açılışı beklemeden. Uygulama da
  ; açılışta aynı komutu yazar (app.setAsDefaultProtocolClient).
  WriteRegStr HKCU "Software\Classes\diskort" "" "URL:Diskort"
  WriteRegStr HKCU "Software\Classes\diskort" "URL Protocol" ""
  WriteRegStr HKCU "Software\Classes\diskort\shell\open\command" "" '"$appExe" "%1"'

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
    ; Bağlantı kaydı artık olmayan uygulamayı göstermesin
    DeleteRegKey HKCU "Software\Classes\diskort"
  ${endIf}
!macroend
