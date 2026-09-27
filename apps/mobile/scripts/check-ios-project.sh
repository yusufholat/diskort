#!/usr/bin/env bash
# `expo prebuild --platform ios` sonrası (apps/mobile/ios içinde, macOS'ta) çalışır: eklentilerin iOS
# ayarlarını gerçekten yazdığını denetler (bkz. plugins/withIos.js). Bir şey eksikse CI'ı durdurur.
set -euo pipefail

info=Diskort/Info.plist
expo=Diskort/Supporting/Expo.plist
pb=/usr/libexec/PlistBuddy
fail=0

check() {
  local what=$1 actual=$2 pattern=$3
  if [[ "$actual" =~ $pattern ]]; then
    echo "✓ $what: $actual"
  else
    echo "::error::$what beklenmedik: '$actual' (beklenen: $pattern)"
    fail=1
  fi
}

check "Arka plan kipleri" "$($pb -c 'Print :UIBackgroundModes' "$info" | tr -d '\n' | tr -s ' ')" 'audio'
check "VoIP arka plan kipi" "$($pb -c 'Print :UIBackgroundModes' "$info" | tr -d '\n' | tr -s ' ')" 'voip'
check "Mikrofon izni metni" "$($pb -c 'Print :NSMicrophoneUsageDescription' "$info")" '^Diskort '
check "Kamera izni metni" "$($pb -c 'Print :NSCameraUsageDescription' "$info")" '^Diskort '
check "Fotoğraf izni metni" "$($pb -c 'Print :NSPhotoLibraryUsageDescription' "$info")" '^Diskort '
check "Şifreleme beyanı" "$($pb -c 'Print :ITSAppUsesNonExemptEncryption' "$info")" '^false$'
check "OTA adresi" "$($pb -c 'Print :EXUpdatesURL' "$expo")" '/updates/expo/ios$'
check "OTA runtimeVersion" "$($pb -c 'Print :EXUpdatesRuntimeVersion' "$expo")" '^native-'
check "Paket kimliği" "$(grep -m1 'PRODUCT_BUNDLE_IDENTIFIER' Diskort.xcodeproj/project.pbxproj)" 'com\.diskort\.app'
check "Bildirim yetkisi" "$($pb -c 'Print :aps-environment' Diskort/Diskort.entitlements)" '^production$'

exit $fail
