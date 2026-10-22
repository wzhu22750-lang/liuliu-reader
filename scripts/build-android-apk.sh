#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "$0")/.." && pwd)"
cd "$project_dir"

if [[ -z "${JAVA_HOME:-}" && -x /usr/libexec/java_home ]]; then
  export JAVA_HOME="$(/usr/libexec/java_home -v 21)"
fi
android_sdk="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Library/Android/sdk}}"
if [[ ! -d "$android_sdk/platforms/android-36" ]]; then
  echo "Android SDK 36 is required. Set ANDROID_HOME to your SDK directory." >&2
  exit 1
fi

npm run build
npx cap sync android

# Build in an ASCII path so AAPT/Gradle also work when the source path contains Chinese characters.
android_work="$(mktemp -d "${TMPDIR:-/tmp}/liuli-android-build.XXXXXX")"
export LIULI_ANDROID_BUILD_WORK="$android_work"
export LIULI_ANDROID_PROJECT="$project_dir"
export LIULI_ANDROID_SDK="$android_sdk"
node --input-type=module <<'NODE'
import fs from 'node:fs';
import path from 'node:path';
const root = process.env.LIULI_ANDROID_PROJECT;
const work = process.env.LIULI_ANDROID_BUILD_WORK;
fs.cpSync(path.join(root, 'android'), path.join(work, 'android'), {
  recursive: true,
  filter: file => !file.split(path.sep).some(part => ['build', '.gradle', '.idea'].includes(part)) && path.basename(file) !== 'local.properties',
});
fs.symlinkSync(path.join(root, 'node_modules'), path.join(work, 'node_modules'), 'dir');
fs.writeFileSync(path.join(work, 'android', 'local.properties'), `sdk.dir=${process.env.LIULI_ANDROID_SDK.replaceAll('\\', '\\\\')}\n`);
NODE

cd "$android_work/android"
./gradlew --no-daemon --console=plain :app:assembleDebug
apk_output="$project_dir/溜溜读书-debug.apk"
cp app/build/outputs/apk/debug/app-debug.apk "$apk_output"
echo "APK: $apk_output"
echo "Build workspace: $android_work"
