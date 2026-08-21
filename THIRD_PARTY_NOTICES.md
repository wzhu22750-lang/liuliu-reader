# Third-party notices

## Tomato/Fanqie obfuscation mapping

`src/parsers/tomatoMappings.ts` contains a versioned character mapping adapted from the public mapping data in `ying-ck/fanqienovel-downloader`.

Source project: https://github.com/ying-ck/fanqienovel-downloader
License: AGPL-3.0

The mapping is used only to restore the private-use Unicode characters emitted by the source platform before local TXT/EPUB export. Review the AGPL-3.0 obligations before distributing this project or offering it as a hosted service.

## Local Tomato Novel Downloader sidecar

The optional local provider installed by `npm run provider:install` downloads the official release binary of `zhongbai2333/Tomato-Novel-Downloader` version 2.4.13 into the ignored `.local/` directory.

Source project: https://github.com/zhongbai2333/Tomato-Novel-Downloader
License: MIT
Release: https://github.com/zhongbai2333/Tomato-Novel-Downloader/releases/tag/v2.4.13

The binary is not committed to this repository. The installer verifies its SHA-256 digest against the digest published by GitHub Releases before making it executable. It is bound to localhost and used only as a chapter download sidecar.
