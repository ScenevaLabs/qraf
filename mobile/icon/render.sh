#!/bin/sh
# qRaf mobil ikonlarını SVG'lerden üretir (Chrome headless ile).
# Kullanım: sh mobile/icon/render.sh
set -e
cd "$(dirname "$0")"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
RES=../android/app/src/main/res
TMP=$(mktemp -d)

shot() { # svg genişlik yükseklik çıktı
  printf '<html><body style="margin:0;background:transparent"><img src="%s" style="display:block;width:%spx;height:%spx"></body></html>' \
    "file://$PWD/$1" "$2" "$3" > "$TMP/page.html"
  "$CHROME" --headless --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
    --default-background-color=00000000 --window-size="$2,$3" \
    --screenshot="$4" "file://$TMP/page.html" >/dev/null 2>&1
}

for pair in mdpi:48:108 hdpi:72:162 xhdpi:96:216 xxhdpi:144:324 xxxhdpi:192:432; do
  d=${pair%%:*}; rest=${pair#*:}; s=${rest%%:*}; f=${rest#*:}
  shot legacy.svg "$s" "$s" "$RES/mipmap-$d/ic_launcher.png"
  shot round.svg "$s" "$s" "$RES/mipmap-$d/ic_launcher_round.png"
  shot foreground.svg "$f" "$f" "$RES/mipmap-$d/ic_launcher_foreground.png"
done
mkdir -p ../src/assets
shot logo.svg 660 540 ../src/assets/logo.png
rm -rf "$TMP"
