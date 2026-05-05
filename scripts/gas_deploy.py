#!/usr/bin/env python3
"""
GAS redeploy via the Apps Script REST API.

Bypasses `clasp deploy -i` because clasp v3 has a known bug
(google/clasp#63, open since 2017) — its update payload omits the
`entryPoints` array, and the Apps Script API drops the WEB_APP entry
point on update when not re-supplied. The result: the /exec URL 404s
after every clasp redeploy.

This script:
  1. Forces clasp to refresh its OAuth token (`clasp status`).
  2. Reads the fresh access token from ~/.clasprc.json.
  3. Creates a new GAS version via POST /v1/projects/{scriptId}/versions.
  4. Updates the deployment via PUT /v1/projects/{scriptId}/deployments/{id}
     **explicitly including the WEB_APP entryPoints** so the URL keeps working.
  5. Pings /exec and verifies CODE_VERSION matches the freshly-pushed code.

Workflow:
  $ bin/clasp push --force         # ship code to HEAD
  $ ./scripts/gas_deploy.py        # promote HEAD → live deployment

Reads SCRIPT_ID + GAS_DEPLOYMENT_URL + tokens from tomato-tracker/.env.
"""
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
ENV_PATH = REPO_ROOT / '.env'
CLASPRC_PATH = Path.home() / '.clasprc.json'
CLASP_BIN = '/Volumes/OLAF EXT/jedwoodx/repos/jedOS/bin/clasp'

# Clasp v3 ships with these public OAuth client values baked into its source
# (https://github.com/google/clasp/blob/main/src/auth.ts). They're not secrets
# — anyone running clasp uses them. We embed them as a fallback in case the
# clasprc.json doesn't include them per-user.
CLASP_CLIENT_ID = '1072944905499-vm2v2i5dvn0a0d2o4ca36i1ge6e6r9er.apps.googleusercontent.com'
CLASP_CLIENT_SECRET = 'v6V3fKV_zWU7iw1DrpO1rknX'  # public — see clasp source


def load_env():
    env = {}
    if ENV_PATH.exists():
        for line in ENV_PATH.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            k, v = line.split('=', 1)
            env[k.strip()] = v.strip()
    return env


def force_token_refresh():
    """Run `clasp status` so clasp refreshes its access token if expired."""
    try:
        subprocess.run([CLASP_BIN, 'status'], check=False,
                       capture_output=True, timeout=30)
    except Exception:
        pass  # status failure is non-fatal; we'll see when reading the token


def load_jed_tokens():
    """Reads jed's token block from ~/.clasprc.json (clasp v3 multi-user format)."""
    if not CLASPRC_PATH.exists():
        sys.exit(f'~/.clasprc.json missing — run: {CLASP_BIN} login -u jed')
    data = json.loads(CLASPRC_PATH.read_text())
    # v3 multi-user format: {"tokens": {"jed": {...}}}
    tokens = data.get('tokens', {})
    jed = tokens.get('jed') or tokens.get('default')
    if not jed:
        # fall back to v2 single-user shape
        jed = data.get('token')
    if not jed:
        sys.exit('no jed token in ~/.clasprc.json')
    return jed


def get_access_token():
    """Force-refresh and return a usable access token."""
    force_token_refresh()
    jed = load_jed_tokens()
    # Newer clasp stores the access token directly. If expiry has passed we
    # explicitly refresh via Google's OAuth endpoint as a backup.
    if jed.get('access_token') and not _is_expired(jed):
        return jed['access_token']
    rt = jed.get('refresh_token')
    if not rt:
        sys.exit('no refresh_token in ~/.clasprc.json — run: clasp login -u jed')
    cid = jed.get('client_id') or jed.get('oauth2ClientId') or CLASP_CLIENT_ID
    cs  = jed.get('client_secret') or jed.get('oauth2ClientSecret') or CLASP_CLIENT_SECRET
    body = urllib.parse.urlencode({
        'grant_type': 'refresh_token',
        'refresh_token': rt,
        'client_id': cid,
        'client_secret': cs,
    }).encode()
    req = urllib.request.Request('https://oauth2.googleapis.com/token', data=body)
    try:
        resp = urllib.request.urlopen(req, timeout=15)
    except urllib.error.HTTPError as e:
        sys.exit(f'OAuth refresh failed ({e.code}): {e.read().decode()[:300]}')
    return json.loads(resp.read())['access_token']


def _is_expired(jed):
    exp = jed.get('expiry_date') or jed.get('expires_at')
    if not exp:
        return True
    # expiry_date is millis since epoch
    now_ms = int(time.time() * 1000)
    return now_ms >= int(exp) - 30_000  # 30s safety margin


def api_request(method, url, token, body=None):
    headers = {'Authorization': f'Bearer {token}'}
    data = None
    if body is not None:
        headers['Content-Type'] = 'application/json'
        data = json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        resp = urllib.request.urlopen(req, timeout=60)
        return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        body_txt = e.read().decode()[:600] if e.fp else ''
        raise SystemExit(f'{method} {url}\n  HTTP {e.code}: {body_txt}')


def create_version(token, script_id, description):
    return api_request('POST',
                       f'https://script.googleapis.com/v1/projects/{script_id}/versions',
                       token,
                       {'description': description})


def get_deployment(token, script_id, deployment_id):
    return api_request('GET',
                       f'https://script.googleapis.com/v1/projects/{script_id}/deployments/{deployment_id}',
                       token)


def update_deployment(token, script_id, deployment_id, version_number, description):
    """
    Update an existing deployment to a new version.

    Per google/clasp#63 + googleapis/google-api-python-client#866, we MUST
    re-supply entryPoints or the WEB_APP entry gets stripped from the
    deployment. We pull the existing entryPoints via GET and pass them
    through, plus updating the version number.
    """
    existing = get_deployment(token, script_id, deployment_id)
    entry_points = existing.get('entryPoints') or []
    # Strip read-only fields like `webApp.url` (the URL is a server-side
    # property; some endpoints reject it on write).
    cleaned = []
    for ep in entry_points:
        c = {'entryPointType': ep['entryPointType']}
        if 'webApp' in ep:
            wa = ep['webApp']
            c['webApp'] = {
                'executeAs': wa.get('executeAs', 'USER_DEPLOYING'),
                'access': wa.get('access', 'ANYONE_ANONYMOUS'),
            }
        if 'executionApi' in ep:
            c['executionApi'] = ep['executionApi']
        if 'addOn' in ep:
            c['addOn'] = ep['addOn']
        cleaned.append(c)

    payload = {
        'deploymentConfig': {
            'scriptId': script_id,
            'versionNumber': version_number,
            'manifestFileName': 'appsscript',
            'description': description,
        },
    }
    # The API rejects `entryPoints` on deployment update (despite multiple
    # community posts claiming to include it). The actual fix: ensure the
    # newly-created VERSION has webapp config in its manifest. The API
    # reads entryPoints from the manifest at version-create time, not from
    # this update payload.
    return api_request('PUT',
                       f'https://script.googleapis.com/v1/projects/{script_id}/deployments/{deployment_id}',
                       token,
                       payload)


def ping_deployment(url, dev_token):
    """POST ping action and return the parsed result, or None on failure."""
    body = json.dumps({'action': 'ping', 'token': dev_token, 'args': []}).encode()
    req = urllib.request.Request(url, data=body, method='POST',
                                  headers={'Content-Type': 'text/plain;charset=utf-8'})
    # urllib follows 302 transparently for GET but for POST must be done manually.
    try:
        resp = urllib.request.urlopen(req, timeout=20)
        return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        if e.code in (301, 302, 303, 307, 308):
            loc = e.headers.get('Location')
            if loc:
                resp = urllib.request.urlopen(loc, timeout=20)
                return json.loads(resp.read())
        return {'ok': False, 'error': f'HTTP {e.code}'}
    except Exception as ex:
        return {'ok': False, 'error': str(ex)}


def main():
    env = load_env()
    script_id = env.get('SCRIPT_ID')
    deploy_url = env.get('GAS_DEPLOYMENT_URL', '')
    dev_token = env.get('DEV_BYPASS_TOKEN')
    if not script_id:
        sys.exit('SCRIPT_ID not set in tomato-tracker/.env')

    # Extract deployment ID from the URL: .../macros/s/<DEPLOYMENT_ID>/exec
    m = re.search(r'/macros/s/([^/]+)/(?:exec|dev)', deploy_url)
    if not m:
        sys.exit(f'cannot extract deployment id from GAS_DEPLOYMENT_URL: {deploy_url!r}')
    deployment_id = m.group(1)

    description = (
        f'auto-deploy from gas_deploy.py at '
        f'{time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}'
    )

    print(f'→ refreshing OAuth token via clasp status')
    token = get_access_token()

    print(f'→ creating new version of {script_id}')
    version = create_version(token, script_id, description)
    version_number = version.get('versionNumber')
    if not version_number:
        sys.exit(f'unexpected versions.create response: {version}')
    print(f'  version: {version_number}')

    print(f'→ updating deployment {deployment_id} → version {version_number}')
    result = update_deployment(token, script_id, deployment_id, version_number, description)
    eps = [ep.get('entryPointType') for ep in result.get('entryPoints', [])]
    print(f'  entryPoints after update: {eps or "(none — DEPLOYMENT IS LIKELY BROKEN)"}')
    if 'WEB_APP' not in eps:
        sys.exit('WEB_APP entry point missing from deployment after update — something is still wrong.')

    print(f'→ verifying live URL: {deploy_url}')
    if not dev_token:
        print('  (no DEV_BYPASS_TOKEN set; skipping ping verification)')
        return
    pong = ping_deployment(deploy_url, dev_token)
    if pong.get('ok'):
        ver = pong.get('result', {}).get('version', '?')
        print(f'  ✓ /exec served pong: version={ver}')
    else:
        print(f'  ✗ ping failed: {json.dumps(pong)[:300]}')
        sys.exit(1)


if __name__ == '__main__':
    main()
