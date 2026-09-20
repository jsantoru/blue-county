"""Restore or verify the pinned, CC0 offline texture pack using Python 3.

python scripts/fetch-textures.py --verify-only
python scripts/fetch-textures.py

Downloads are made only during explicit preparation, never during gameplay.
The manifest pins original provider URLs, dimensions, and SHA-256 checksums.
"""
from pathlib import Path
from urllib.request import Request, urlopen
import argparse
import hashlib
import io
import json
import re
import struct
import zipfile

ROOT = Path(__file__).resolve().parents[1]


def dimensions(data: bytes, suffix: str):
    if suffix == '.hdr':
        result = re.search(rb'\n-Y (\d+) \+X (\d+)\n', data[:4096])
        if not result:
            raise ValueError('Missing Radiance HDR dimensions')
        return [int(result[2]), int(result[1])]
    if not data.startswith(b'\xff\xd8'):
        raise ValueError('Expected JPEG image')
    offset = 2
    while offset < len(data):
        while data[offset] == 0xff:
            offset += 1
        marker = data[offset]
        offset += 1
        if marker in (0xd8, 0xd9) or 0xd0 <= marker <= 0xd7:
            continue
        length = struct.unpack_from('>H', data, offset)[0]
        if marker in (0xc0, 0xc1, 0xc2):
            height, width = struct.unpack_from('>HH', data, offset + 3)
            return [width, height]
        offset += length
    raise ValueError('Missing JPEG dimensions')


def verify(data, entry, resolution):
    if len(data) != entry['bytes']:
        raise ValueError('File size differs from manifest')
    if hashlib.sha256(data).hexdigest() != entry['sha256']:
        raise ValueError('SHA-256 differs from manifest')
    if dimensions(data, Path(entry['file']).suffix) != resolution:
        raise ValueError('Image dimensions differ from manifest')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--verify-only', action='store_true', help='No network or writes')
    parser.add_argument('--output-directory', type=Path, default=ROOT / 'public' / 'textures')
    args = parser.parse_args()
    manifest = json.loads((ROOT / 'public' / 'textures' / 'manifest.json').read_text(encoding='utf-8-sig'))
    jobs = [(entry, asset['resolution']) for asset in manifest['assets'] for entry in asset['maps'].values()]
    environment = manifest.get('environment')
    if environment:
        jobs.append((environment, environment['resolution']))
    destination = args.output_directory.resolve()
    if not args.verify_only:
        destination.mkdir(parents=True, exist_ok=True)
    print('Textures from Poly Haven and ambientCG (CC0); pinned offline asset pack.')
    total = 0
    archives = {}
    for entry, resolution in jobs:
        if Path(entry['file']).name != entry['file']:
            raise ValueError('Manifest entries must be simple filenames')
        path = destination / entry['file']
        valid = False
        if path.exists():
            try:
                verify(path.read_bytes(), entry, resolution)
                valid = True
            except ValueError:
                if args.verify_only:
                    raise
        if not valid:
            if args.verify_only:
                raise FileNotFoundError(path)
            url = entry.get('sourceFileUrl', entry.get('sourceUrl'))
            if not url.startswith(('https://dl.polyhaven.org/', 'https://ambientcg.com/get?file=')):
                raise ValueError('Expected an original provider download URL')
            archive_entry = entry.get('sourceArchiveEntry')
            if archive_entry and url in archives:
                data = archives[url]
            else:
                request = Request(url, headers={'User-Agent': 'BlueCounty-AssetPrep/1.0'})
                with urlopen(request, timeout=60) as response:
                    data = response.read()
            if archive_entry:
                if len(data) != entry['sourceArchiveBytes'] or hashlib.sha256(data).hexdigest() != entry['sourceArchiveSha256']:
                    raise ValueError('Provider ZIP differs from the pinned source archive')
                archives[url] = data
                # Read only the named member into memory; never extract archive paths.
                with zipfile.ZipFile(io.BytesIO(data)) as archive:
                    data = archive.read(archive_entry)
            verify(data, entry, resolution)
            temporary = path.with_suffix(path.suffix + '.download')
            temporary.write_bytes(data)
            temporary.replace(path)
        total += entry['bytes']
        print('OK', entry['file'], 'x'.join(map(str, resolution)))
    print(f'Verified {len(jobs)} images, {total / 1048576:.2f} MiB')


if __name__ == '__main__':
    main()
