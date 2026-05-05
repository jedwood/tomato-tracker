#!/usr/bin/env python3
"""
Tomato Tracker GAS API client — used for smoke-testing, admin actions,
and as the basis for craig's refresh_caches.py.

Usage:
  api_call.py <action> [args-as-json] [--token-env=DEV_BYPASS_TOKEN] [--url-env=GAS_DEPLOYMENT_URL]

Examples:
  api_call.py ping
  api_call.py setupAllSheetsAction
  api_call.py listVarieties --token-env=HARVEST_BYPASS_TOKEN
  api_call.py submitHarvest '[{"harvester":"Jed","entries":[{"variety":"Cherokee Purple","quantity":2}]}]' --token-env=HARVEST_BYPASS_TOKEN

Reads tokens from `tomato-tracker/.env` by default (sister to this file).
"""
import argparse
import json
import os
import sys
import urllib.request

ENV_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '.env')


def load_env(path=ENV_PATH):
    env = dict(os.environ)
    if not os.path.exists(path):
        return env
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            k, v = line.split('=', 1)
            env.setdefault(k.strip(), v.strip())
    return env


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None  # urllib treats None as "don't redirect, just return the response"


def call(url, action, token, args=None):
    """POST to /exec, then GET the 302 Location ourselves with NO inherited
    headers (curl's -L preserves Content-Type across the redirect, which
    Google's content server rejects)."""
    body = json.dumps({'action': action, 'token': token, 'args': args or []}).encode('utf-8')
    req = urllib.request.Request(
        url, data=body, method='POST',
        headers={'Content-Type': 'text/plain;charset=utf-8'}
    )
    opener = urllib.request.build_opener(_NoRedirect())
    try:
        resp = opener.open(req, timeout=30)
        return resp.read().decode('utf-8')
    except urllib.error.HTTPError as e:
        if e.code in (301, 302, 303, 307, 308):
            location = e.headers.get('Location')
            if not location:
                raise
            return urllib.request.urlopen(location, timeout=30).read().decode('utf-8')
        if e.code == 404:
            raise SystemExit(
                'GAS deployment returned 404. Common cause: the Web App deployment '
                'was edited/redeployed via clasp `deploy -i`, which corrupts the '
                'Web App type. Have Jed open the editor → Deploy → Manage '
                'deployments → edit pencil → set Version to "New version" → Deploy '
                '(or create a fresh Web app deployment if type is no longer Web app).'
            )
        raise


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('action', help='GAS action name (e.g. ping, listVarieties)')
    p.add_argument('args', nargs='?', default='[]', help='JSON-encoded args array')
    p.add_argument('--token-env', default='DEV_BYPASS_TOKEN', help='Env var holding the bypass token')
    p.add_argument('--url-env', default='GAS_DEPLOYMENT_URL', help='Env var holding the /exec URL')
    p.add_argument('--raw', action='store_true', help='Print raw response (default: pretty JSON)')
    a = p.parse_args()

    env = load_env()
    url = env.get(a.url_env)
    token = env.get(a.token_env)
    if not url:
        print(f'error: {a.url_env} not set', file=sys.stderr)
        sys.exit(2)
    if not token:
        print(f'error: {a.token_env} not set', file=sys.stderr)
        sys.exit(2)
    try:
        args = json.loads(a.args)
    except json.JSONDecodeError as e:
        print(f'error: args must be JSON: {e}', file=sys.stderr)
        sys.exit(2)

    out = call(url, a.action, token, args)
    if a.raw:
        print(out)
        return
    try:
        print(json.dumps(json.loads(out), indent=2))
    except json.JSONDecodeError:
        print(out)


if __name__ == '__main__':
    main()
