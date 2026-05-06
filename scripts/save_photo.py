#!/usr/bin/env python3
"""
Download a variety photo and self-host it on GitHub Pages.

Usage:
    ./scripts/save_photo.py "Dwarf Sonrojo (straw bale)" --url https://.../image.jpg
    ./scripts/save_photo.py "Cherokee Purple" --page https://victoryseeds.com/...
    ./scripts/save_photo.py --migrate-existing
    ./scripts/save_photo.py --commit
    ./scripts/save_photo.py --commit --push

Modes:
    --url  <direct image URL>     Download + save + sheet-update.
    --page <page URL>             Open page (playwright), pull og:image, download.
    --migrate-existing            Walk Varieties, replace remote photo URLs (sheetsz, wikipedia)
                                  with self-hosted GitHub Pages URLs. Skips n/a and blank.
    --commit / --push             Stage `photos/`, commit, optionally push (the SPA's
                                  index.html lives in repo root, so any commit is a deploy).

Convention:
    Image saved to `tomato-tracker/photos/<slug>.<ext>`.
    Sheet's `Photo URL` set to `https://jedwood.github.io/tomato-tracker/photos/<slug>.<ext>`.

Extension is sniffed from Content-Type header (image/jpeg → .jpg, image/png → .png, etc).
Slug is the variety name lowercased, non-word characters → '-', collapsed dashes.
"""
import argparse
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
PHOTOS_DIR = REPO_ROOT / 'photos'
PHOTO_BASE_URL = 'https://jedwood.github.io/tomato-tracker/photos'
USER_AGENT = (
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
    '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
)

EXT_BY_MIME = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/avif': 'avif',
}


def slugify(s):
    s = re.sub(r'[‘’‚]', "'", s)  # normalize curly quotes
    s = s.lower()
    s = re.sub(r"[\(\)\[\]]", '', s)            # drop brackets
    s = re.sub(r"[^a-z0-9]+", '-', s)
    s = re.sub(r'-+', '-', s).strip('-')
    return s


def fetch_bytes(url, timeout=45):
    """GET a URL with a real-browser UA, return (content_bytes, content_type)."""
    req = urllib.request.Request(url, headers={
        'User-Agent': USER_AGENT,
        'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
    })
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read(), resp.headers.get('Content-Type', '').lower().split(';')[0].strip()


def extract_og_image_via_playwright(page_url):
    """
    Open the page in headless Chromium and read `og:image` from <head>.
    Falls back to the first <img> with naturalWidth > 200.
    Returns None if page doesn't load (anti-bot blocks etc.).
    """
    js = (
        '() => { '
        '  const og = document.querySelector("meta[property=\\"og:image\\"]"); '
        '  if (og && og.content) return og.content; '
        '  const tw = document.querySelector("meta[name=\\"twitter:image\\"]"); '
        '  if (tw && tw.content) return tw.content; '
        '  const big = Array.from(document.querySelectorAll("img")) '
        '    .filter(i => i.naturalWidth > 200).sort((a,b)=>b.naturalWidth-a.naturalWidth)[0]; '
        '  return big ? big.src : null; '
        '}'
    )
    nvm_use = 'source ~/.nvm/nvm.sh && nvm use 22 >/dev/null 2>&1'
    subprocess.run(f'{nvm_use} && npx @playwright/cli close', shell=True, capture_output=True)
    subprocess.run(f'{nvm_use} && npx @playwright/cli open {shquote(page_url)}',
                   shell=True, capture_output=True, timeout=60)
    time.sleep(3)
    out = subprocess.run(f'{nvm_use} && npx @playwright/cli eval {shquote(js)}',
                         shell=True, capture_output=True, text=True, timeout=60).stdout
    m = re.search(r'### Result\n(.+)', out)
    if not m:
        return None
    raw = m.group(1).strip()
    if raw in ('null', 'undefined', '"null"', '""'):
        return None
    if raw.startswith('"') and raw.endswith('"'):
        return json.loads(raw)
    return raw


def shquote(s):
    return "'" + s.replace("'", "'\"'\"'") + "'"


def save_image(variety, image_bytes, content_type):
    """Save `image_bytes` to photos/<slug>.<ext>, return public URL."""
    PHOTOS_DIR.mkdir(parents=True, exist_ok=True)
    ext = EXT_BY_MIME.get(content_type, 'jpg')
    slug = slugify(variety)
    if not slug:
        raise ValueError(f'cannot slugify variety: {variety!r}')
    out = PHOTOS_DIR / f'{slug}.{ext}'
    out.write_bytes(image_bytes)
    print(f'  → {out.relative_to(REPO_ROOT)}  ({len(image_bytes)} bytes, {content_type})')
    return f'{PHOTO_BASE_URL}/{slug}.{ext}'


def update_sheet(variety, public_url):
    """Push the new Photo URL into the Varieties tab."""
    args = json.dumps(['Varieties', 'Variety', [{'Variety': variety, 'Photo URL': public_url}]])
    out = subprocess.run(['./scripts/api_call.py', 'upsertRows', args],
                         cwd=REPO_ROOT, capture_output=True, text=True, timeout=60).stdout
    parsed = json.loads(out)
    if not parsed.get('ok'):
        raise SystemExit(f'sheet update failed: {parsed}')
    return parsed['result']


def cmd_url(variety, url):
    print(f'fetching {url[:80]}...')
    body, ct = fetch_bytes(url)
    if not ct.startswith('image/'):
        # Maybe a page URL that snuck in here. Try og:image via playwright.
        print(f'  not an image ({ct}); trying as page')
        return cmd_page(variety, url)
    public_url = save_image(variety, body, ct)
    print(f'  sheet: {update_sheet(variety, public_url)}')


def cmd_page(variety, page_url):
    print(f'opening {page_url[:80]} in playwright')
    img_url = extract_og_image_via_playwright(page_url)
    if not img_url:
        sys.exit(f'  could not extract image URL from page (anti-bot or empty page). '
                 f'Open in your browser, right-click → Copy Image Address, run with --url instead.')
    print(f'  found image: {img_url[:120]}')
    body, ct = fetch_bytes(img_url)
    if not ct.startswith('image/'):
        sys.exit(f'  fetched URL is not an image ({ct})')
    public_url = save_image(variety, body, ct)
    print(f'  sheet: {update_sheet(variety, public_url)}')


def list_varieties():
    out = subprocess.run(['./scripts/api_call.py', 'readTab', '["Varieties"]'],
                         cwd=REPO_ROOT, capture_output=True, text=True, timeout=60).stdout
    return json.loads(out)['result']['rows']


def cmd_migrate_existing():
    rows = list_varieties()
    todo = []
    for r in rows:
        url = (r.get('Photo URL') or '').strip()
        if not url or url.lower() == 'n/a':
            continue
        if url.startswith(PHOTO_BASE_URL):
            continue  # already self-hosted
        todo.append((r['Variety'], url))
    print(f'migrating {len(todo)} photos to self-hosted')
    for v, u in todo:
        slug = slugify(v)
        out_path = PHOTOS_DIR / f'{slug}.jpg'  # default; will be fixed if content-type differs
        try:
            print(f'\n[{v}]')
            body, ct = fetch_bytes(u)
            if not ct.startswith('image/'):
                print(f'  skipped: content-type={ct}')
                continue
            public_url = save_image(v, body, ct)
            update_sheet(v, public_url)
        except Exception as e:
            print(f'  ✗ failed: {e}')


def cmd_commit(do_push=False):
    subprocess.run(['git', 'add', 'photos/'], cwd=REPO_ROOT, check=True)
    has_staged = subprocess.run(
        ['git', 'diff', '--cached', '--quiet'], cwd=REPO_ROOT
    ).returncode != 0
    if not has_staged:
        print('nothing to commit')
        return
    msg = f'photos: add/update variety images ({time.strftime("%Y-%m-%d %H:%M")})'
    subprocess.run(['git', 'commit', '-m', msg], cwd=REPO_ROOT, check=True)
    if do_push:
        subprocess.run(['git', 'push', 'origin', 'master'], cwd=REPO_ROOT, check=True)
    else:
        print('(skip push; pass --push to ship to GH Pages)')


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('variety', nargs='?')
    p.add_argument('--url', help='Direct image URL to download.')
    p.add_argument('--page', help='Page URL; pull og:image via playwright, then download.')
    p.add_argument('--migrate-existing', action='store_true',
                   help='Re-download every non-n/a non-self-hosted Photo URL into photos/ and update the sheet.')
    p.add_argument('--commit', action='store_true', help='Stage photos/ and commit.')
    p.add_argument('--push', action='store_true', help='With --commit: push to origin master.')
    a = p.parse_args()

    if a.migrate_existing:
        cmd_migrate_existing()
    elif a.url:
        if not a.variety: p.error('variety name required with --url')
        cmd_url(a.variety, a.url)
    elif a.page:
        if not a.variety: p.error('variety name required with --page')
        cmd_page(a.variety, a.page)

    if a.commit:
        cmd_commit(do_push=a.push)


if __name__ == '__main__':
    main()
