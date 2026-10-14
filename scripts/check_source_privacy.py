"""Fail publication if source identifiers or private files appear in public content."""
import argparse
import base64
import json
from pathlib import Path
import subprocess
import sys
import urllib.parse
from catalog import load_source

ROOT = Path(__file__).resolve().parents[1]


def forbidden_patterns(source):
    values = set(source.fragments)
    for part in source.fragments:
        values.update((urllib.parse.quote(part, safe=''), urllib.parse.quote_plus(part),
                       base64.b64encode(part.encode()).decode()))
    return [value.lower().encode() for value in values]


def check(root, source, history=False):
    patterns = forbidden_patterns(source)
    def safe(data): return not any(pattern in data.lower() for pattern in patterns)
    tracked = subprocess.check_output(['git', 'ls-files', '-z'], cwd=root).decode().split('\0')
    count = 0
    for name in filter(None, tracked):
        if (name.startswith(('private/', 'qa/', 'dist/')) or '.sqlite3' in name
                or name.startswith('.env') or name.startswith('JobDating-投递记录-')):
            raise ValueError('Private file is tracked; publication refused')
        if not safe((root/name).read_bytes()):
            raise ValueError('Tracked file contains a private source identifier; publication refused')
        count += 1
    for file in (root/'dist').rglob('*'):
        if file.is_file() and not safe(file.read_bytes()):
            raise ValueError('Built artifact contains a private source identifier; publication refused')
    metadata = json.loads((root/'data/catalog.json').read_text(encoding='utf-8'))['metadata']
    if any(key in metadata for key in ('source_url', 'table_id', 'view_id', 'source')):
        raise ValueError('Source metadata must not be published')
    if history:
        for oid in subprocess.check_output(['git', 'rev-list', '--objects', '--all'], cwd=root).decode().splitlines():
            oid = oid.split(' ', 1)[0]
            data = subprocess.check_output(['git', 'cat-file', '-p', oid], cwd=root)
            if not safe(data): raise ValueError('Git history contains a private source identifier; publication refused')
    return count


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--history', action='store_true')
    args = parser.parse_args()
    try:
        count = check(ROOT, load_source(ROOT), args.history)
        print(f'Privacy check passed: {count} tracked files, build artifacts'+(' and Git history' if args.history else ''))
    except Exception:
        print('Privacy check failed; publication stopped. Check private configuration and public content.', file=sys.stderr)
        raise SystemExit(1) from None
