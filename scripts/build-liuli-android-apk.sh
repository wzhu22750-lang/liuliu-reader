#!/bin/zsh
set -euo pipefail

# Offline APK integration helper. It never writes to the original APK.
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FANQIE_ROOT="${FANQIE_ROOT:-/Users/kuangqie/Documents/VibeCoding/番茄器}"
DECODED="${DECODED:-$FANQIE_ROOT/fanqie-apk/apktool_out}"
OUTPUT="${1:-$FANQIE_ROOT/番茄器-liuli-reader.apk}"
WORK="${WORK:-/private/tmp/liuli-apk-build}"
SDK="${ANDROID_BUILD_TOOLS:-/private/tmp/fanqie-build-tools/android-sdk/build-tools/35.0.0}"
KEYSTORE="${KEYSTORE:-$HOME/.android/debug.keystore}"
PACKAGE_ID="${PACKAGE_ID:-com.pofl.fanqienoveldownloader}"

for command_name in apktool "$SDK/zipalign" "$SDK/apksigner" "$SDK/aapt2"; do
  if [[ "$command_name" == /* ]]; then
    [[ -x "$command_name" ]] || { print -u2 "missing executable: $command_name"; exit 1; }
  else
    command -v "$command_name" >/dev/null || { print -u2 "missing command: $command_name"; exit 1; }
  fi
done
[[ -d "$DECODED" ]] || { print -u2 "decoded APK directory not found: $DECODED"; exit 1; }
[[ -f "$KEYSTORE" ]] || { print -u2 "keystore not found: $KEYSTORE"; exit 1; }

npm --prefix "$ROOT" run build
rm -rf "$WORK"
cp -a "$DECODED" "$WORK"
cp -R "$ROOT/dist/." "$WORK/assets/"

# The original Tauri Android shell starts WebView at http://tauri.localhost/.
# Android otherwise blocks the local origin before the Rust/WebView asset
# interception path can return the bundled React files.
python3 - "$WORK/AndroidManifest.xml" <<'PY'
from pathlib import Path
import sys
p = Path(sys.argv[1])
s = p.read_text()
s = s.replace('android:usesCleartextTraffic="false"', 'android:usesCleartextTraffic="true"', 1)
p.write_text(s)
PY

python3 - "$WORK/smali/com/pofl/fanqienoveldownloader/RustWebViewClient.smali" <<'PY'
from pathlib import Path
import sys
p = Path(sys.argv[1])
s = p.read_text()
old = '''    invoke-static {v0}, Lcom/pofl/fanqienoveldownloader/Rust;->withAssetLoader(Ljava/lang/String;)Z\n\n    move-result v0\n\n    if-eqz v0, :cond_1\n'''
new = '''    # Serve the replacement React bundle from APK assets; keep Rust JNI/IPC intact.\n    const/4 v0, 0x1\n\n    if-eqz v0, :cond_1\n'''
if old not in s:
    raise SystemExit('asset-loader patch point not found')
p.write_text(s.replace(old, new, 1))
PY

python3 - "$WORK/apktool.yml" <<'PY'
from pathlib import Path
import sys
p = Path(sys.argv[1])
s = p.read_text().replace('versionCode: 100634', 'versionCode: 100635').replace('versionName: 2026.7.26-709', 'versionName: 2026.7.26-709-liuli')
p.write_text(s)
PY

if [[ "$PACKAGE_ID" != "com.pofl.fanqienoveldownloader" ]]; then
  python3 - "$WORK/AndroidManifest.xml" "$PACKAGE_ID" <<'PY'
from pathlib import Path
import sys
p = Path(sys.argv[1])
package_id = sys.argv[2]
s = p.read_text()
s = s.replace('package="com.pofl.fanqienoveldownloader"', f'package="{package_id}"', 1)
s = s.replace('com.pofl.fanqienoveldownloader.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION', f'{package_id}.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION')
s = s.replace('com.pofl.fanqienoveldownloader.fileprovider', f'{package_id}.fileprovider')
s = s.replace('com.pofl.fanqienoveldownloader.androidx-startup', f'{package_id}.androidx-startup')
p.write_text(s)
PY
fi

UNSIGNED="$WORK/unsigned.apk"
ALIGNED="$WORK/aligned.apk"
apktool b "$WORK" -o "$UNSIGNED"
"$SDK/zipalign" -p -f 4 "$UNSIGNED" "$ALIGNED"
mkdir -p "$(dirname "$OUTPUT")"
"$SDK/apksigner" sign --ks "$KEYSTORE" --ks-pass pass:android --ks-key-alias androiddebugkey --out "$OUTPUT" "$ALIGNED"
"$SDK/apksigner" verify --verbose --print-certs "$OUTPUT"
"$SDK/aapt2" dump badging "$OUTPUT" | sed -n '1,3p'
print "Wrote $OUTPUT"
