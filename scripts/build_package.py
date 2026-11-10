#!/usr/bin/env python3
"""Build a deterministic, allowlisted unpacked-extension ZIP using only stdlib."""

import hashlib
import json
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parent.parent
FILES = (
    'manifest.json', 'background.js', 'content.js', 'popup.html',
    'icon16.png', 'icon48.png', 'icon128.png',
    'LICENSE.txt', 'README.md', 'CHANGELOG.md',
)


def main():
    manifest = json.loads((ROOT / 'manifest.json').read_text(encoding='utf-8'))
    required = {manifest['background']['service_worker'], manifest['action']['default_popup']}
    required.update(manifest['icons'].values())
    for script in manifest['content_scripts']:
        required.update(script.get('js', []))
        required.update(script.get('css', []))
    for resource in manifest.get('web_accessible_resources', []):
        required.update(resource['resources'])
    if required - set(FILES):
        raise SystemExit('Manifest references unpackaged files: ' + ', '.join(sorted(required - set(FILES))))
    for name in FILES:
        if not (ROOT / name).is_file():
            raise SystemExit('Missing package file: ' + name)

    output = ROOT / 'dist'
    output.mkdir(exist_ok=True)
    archive_path = output / ('bilibili-live-extension-v' + manifest['version'] + '.zip')
    with zipfile.ZipFile(archive_path, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name in sorted(FILES):
            info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            archive.writestr(info, (ROOT / name).read_bytes(), compresslevel=9)
    with zipfile.ZipFile(archive_path) as archive:
        if archive.testzip() is not None or set(archive.namelist()) != set(FILES):
            raise SystemExit('ZIP validation failed')
        for name in FILES:
            if archive.read(name) != (ROOT / name).read_bytes():
                raise SystemExit('ZIP content mismatch: ' + name)
    digest = hashlib.sha256(archive_path.read_bytes()).hexdigest()
    (output / 'SHA256SUMS').write_text(digest + '  ' + archive_path.name + '\n', encoding='ascii')
    print(str(archive_path))
    print(digest + '  ' + archive_path.name)


if __name__ == '__main__':
    main()
