#!/usr/bin/env python3
"""Patch only the Android host/asset loader; preserve all original native engine bytes."""
from pathlib import Path
import re
import sys

root = Path(sys.argv[1])
debug = sys.argv[2] == '1'
old_id = 'com.pofl.fanqienoveldownloader'
new_id = 'com.liuli.reader.integrated'


def replace_once(path, old, new):
    text = path.read_text()
    if text.count(old) != 1:
        raise SystemExit(f'Expected exactly one integration patch point: {path.name}: {old[:80]}')
    path.write_text(text.replace(old, new, 1))

# This supplied APK has an injected promotional dialog in MainActivity.onCreate.
# Disable only that startup hook; the original Tauri/Rust invocation remains untouched.
main_activity = root / 'smali/com/pofl/fanqienoveldownloader/MainActivity.smali'
replace_once(main_activity,
    '    invoke-static/range {p0 .. p0}, Lcom/google/android/exoplayer2/video/sphericat;->context(Landroid/content/Context;)V\n',
    '    # Reader integration: omit third-party promotional startup dialog.\n')

webview = root / 'smali/com/pofl/fanqienoveldownloader/RustWebView.smali'
replace_once(webview,
    '    invoke-direct {p0, p1}, Landroid/webkit/WebView;-><init>(Landroid/content/Context;)V\n',
    '    invoke-direct {p0, p1}, Landroid/webkit/WebView;-><init>(Landroid/content/Context;)V\n\n'
    f'    const/4 v0, 0x{1 if debug else 0}\n\n'
    '    invoke-static {p0, p1, v0}, Lcom/liuli/reader/bridge/LiuliReaderBridge;->install(Landroid/webkit/WebView;Landroid/content/Context;Z)V\n')

client = root / 'smali/com/pofl/fanqienoveldownloader/RustWebViewClient.smali'
replace_once(client, '''    invoke-virtual {p1}, Lcom/pofl/fanqienoveldownloader/RustWebView;->getId()Ljava/lang/String;

    move-result-object p1

    invoke-static {p1}, Lcom/pofl/fanqienoveldownloader/Rust;->assetLoaderDomain(Ljava/lang/String;)Ljava/lang/String;

    move-result-object p1
''', '    const-string p1, "tauri.localhost"\n')
replace_once(client, '''    invoke-static {v0}, Lcom/pofl/fanqienoveldownloader/Rust;->withAssetLoader(Ljava/lang/String;)Z

    move-result v0

    if-eqz v0, :cond_1
''', '''    const/4 v0, 0x1

    if-eqz v0, :cond_1
''')

# The native host can reset debugging during initialization; enforce the build choice after page load.
replace_once(client,
    '    invoke-static {p1, p2}, Lcom/pofl/fanqienoveldownloader/Rust;->onPageLoaded(Ljava/lang/String;Ljava/lang/String;)V\n',
    '    invoke-static {p1, p2}, Lcom/pofl/fanqienoveldownloader/Rust;->onPageLoaded(Ljava/lang/String;Ljava/lang/String;)V\n\n'
    f'    const/4 v0, 0x{1 if debug else 0}\n\n'
    '    invoke-static {v0}, Landroid/webkit/WebView;->setWebContentsDebuggingEnabled(Z)V\n')

# The original runtime starts on HTTP; load the bundled UI at a secure local HTTPS origin.
for overload, parameter in [('', 'p1'), ('Ljava/util/Map;', 'p2')]:
    signature = f'.method public loadUrl(Ljava/lang/String;{overload})V\n    .locals 1\n'
    replace_once(webview, signature, signature.replace('.locals 1', '.locals 2'))
    if parameter == 'p1':
        needle = '''    invoke-static {p1, v0}, Lkotlin/jvm/internal/Intrinsics;->checkNotNullParameter(Ljava/lang/Object;Ljava/lang/String;)V

    .line 55
'''
    else:
        needle = '''    invoke-static {p2, v0}, Lkotlin/jvm/internal/Intrinsics;->checkNotNullParameter(Ljava/lang/Object;Ljava/lang/String;)V

    .line 61
'''
    replacement = needle.split('\n\n')[0] + '''

    const-string v0, "http://tauri.localhost/"
    const-string v1, "https://tauri.localhost/index.html"
    invoke-virtual {p1, v0, v1}, Ljava/lang/String;->replace(Ljava/lang/CharSequence;Ljava/lang/CharSequence;)Ljava/lang/String;
    move-result-object p1

''' + needle.split('\n\n')[1]
    replace_once(webview, needle, replacement)

manifest = root / 'AndroidManifest.xml'
text = manifest.read_text().replace(f'package="{old_id}"', f'package="{new_id}"')
for suffix in ['.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION', '.fileprovider', '.androidx-startup']:
    text = text.replace(old_id + suffix, new_id + suffix)
text = text.replace('android:icon="@mipmap/ic_launcher"', 'android:icon="@drawable/liuli_reader_icon"')
text = text.replace('android:label="@string/app_name"', 'android:label="溜溜读书·整合版"').replace('android:label="@string/main_activity_title"', 'android:label="溜溜读书·整合版"')
text = text.replace('<application ', f'<application android:debuggable="{str(debug).lower()}" ', 1)
manifest.write_text(text)
yaml = root / 'apktool.yml'
text = re.sub(r'versionCode: .*', 'versionCode: 100650', yaml.read_text())
text = re.sub(r'versionName: .*', 'versionName: 1.0-integrated', text)
yaml.write_text(text)
strings = root / 'res/values/strings.xml'
text = strings.read_text()
for key in ['app_name', 'main_activity_title']:
    text = re.sub(rf'(<string name="{key}">).*?(</string>)', r'\g<1>溜溜读书·整合版\2', text)
strings.write_text(text)

(root / 'res/drawable/liuli_reader_icon.xml').write_text((Path(__file__).resolve().parent.parent / 'native/integrated/ic_launcher.xml').read_text())
