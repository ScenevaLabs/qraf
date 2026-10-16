#!/bin/sh
# icon.svg (Windows .ico) ve icon-mac.svg (macOS .icns) → çoklu boyut PNG,
# sonra make-ico.js / make-icns.js. Chrome headless ile çizilir; eski
# render-icon.js (Electron capturePage) alt kenarı kırpıp kaydırma
# çubuklarını da görüntüye katıyordu (13 Ekim 2026).
# Kullanım: sh desktop/build-assets/render-icon.sh
set -e
cd "$(dirname "$0")"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
TMP=$(mktemp -d)

shot() { # svg boyut çıktı
  printf '<html><body style="margin:0;background:transparent"><img src="%s" style="display:block;width:%spx;height:%spx"></body></html>' \
    "file://$PWD/$1" "$2" "$2" > "$TMP/page.html"
  "$CHROME" --headless --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
    --default-background-color=00000000 --window-size="$2,$2" \
    --screenshot="$3" "file://$TMP/page.html" >/dev/null 2>&1
}

for s in 16 32 48 64 128 256 512 1024; do shot icon.svg "$s" "icon-$s.png"; done
node make-ico.js
for s in 16 32 64 128 256 512 1024; do shot icon-mac.svg "$s" "icon-$s.png"; done
node make-icns.js
# Depodaki PNG'ler Windows (tam dolu) sürümü kalsın
for s in 16 32 64 128 256 512 1024; do shot icon.svg "$s" "icon-$s.png"; done
rm -rf "$TMP"
