#!/usr/bin/env bash
set -euo pipefail
project_dir="$(cd "$(dirname "$0")/.." && pwd)"
source_apk="${FANQIE_APK:-$project_dir/../番茄器/番茄器.apk}"
android_sdk="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Library/Android/sdk}}"
build_tools="${ANDROID_BUILD_TOOLS:-$android_sdk/build-tools/36.0.0}"
android_jar="$android_sdk/platforms/android-36/android.jar"
keystore="${LIULI_KEYSTORE:-$HOME/.android/debug.keystore}"
output="${1:-$project_dir/溜溜读书-整合版.apk}"
debug="${DEBUG_WEBVIEW:-0}"
if [[ -z "${JAVA_HOME:-}" ]]; then export JAVA_HOME="$(/usr/libexec/java_home -v 21)"; fi
for tool in apktool python3 npm; do command -v "$tool" >/dev/null; done
for file in "$source_apk" "$android_jar" "$keystore"; do [[ -f "$file" ]] || { echo "Missing: $file" >&2; exit 1; }; done
for tool in d8 zipalign apksigner; do [[ -x "$build_tools/$tool" ]] || { echo "Missing: $build_tools/$tool" >&2; exit 1; }; done
work="$(mktemp -d "${TMPDIR:-/tmp}/liuli-integrated-build.XXXXXX")"
echo "Build workspace: $work"
cd "$project_dir"
npm run build
apktool d "$source_apk" -o "$work/decoded" > "$work/decode.log" 2>&1
cp -R dist/. "$work/decoded/assets/"
python3 scripts/patch-integrated-apk.py "$work/decoded" "$debug"
mkdir -p "$work/classes" "$work/dex"
"$JAVA_HOME/bin/javac" -encoding UTF-8 -source 8 -target 8 -bootclasspath "$android_jar" -d "$work/classes" native/integrated/LiuliReaderBridge.java
"$build_tools/d8" --lib "$android_jar" --min-api 24 --output "$work/dex" "$work/classes/com/liuli/reader/bridge/"*.class
apktool b "$work/decoded" -o "$work/unsigned.apk" > "$work/build.log" 2>&1
python3 - "$source_apk" "$work/unsigned.apk" "$work/dex/classes.dex" <<'PY'
import hashlib, re, sys, zipfile
source, output, dex = sys.argv[1:]
with zipfile.ZipFile(source) as original, zipfile.ZipFile(output, 'a') as rebuilt:
    native = [name for name in original.namelist() if name.startswith('lib/') and name.endswith('.so')]
    if not native: raise SystemExit('Source APK has no native engine')
    for name in native:
        if hashlib.sha256(original.read(name)).digest() != hashlib.sha256(rebuilt.read(name)).digest():
            raise SystemExit(f'Native library changed: {name}')
    count = max([int(re.fullmatch(r'classes(\d*)\.dex', n).group(1) or '1') for n in rebuilt.namelist() if re.fullmatch(r'classes\d*\.dex', n)]) + 1
    rebuilt.write(dex, f'classes{count}.dex', compress_type=zipfile.ZIP_DEFLATED)
    print(f'Verified {len(native)} original native libraries unchanged; added file bridge')
PY
"$build_tools/zipalign" -P 16 -f 4 "$work/unsigned.apk" "$work/aligned.apk"
"$build_tools/apksigner" sign --ks "$keystore" --ks-key-alias androiddebugkey --ks-pass pass:android --out "$work/signed.apk" "$work/aligned.apk"
"$build_tools/apksigner" verify --verbose "$work/signed.apk"
mkdir -p "$(dirname "$output")"
cp "$work/signed.apk" "$output"
"$build_tools/aapt2" dump badging "$output" | sed -n '1,3p'
shasum -a 256 "$output"
echo "APK: $output"
