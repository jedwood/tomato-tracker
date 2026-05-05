#!/usr/bin/env bash
# One-shot: push GAS source + promote to live deployment.
# Bypasses clasp's broken `deploy -i` (google/clasp#63) by calling the
# Apps Script REST API directly — see gas_deploy.py for details.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLASP="/Volumes/OLAF EXT/jedwoodx/repos/jedOS/bin/clasp"

cd "$REPO_ROOT/gas"
"$CLASP" push --force

cd "$REPO_ROOT"
./scripts/gas_deploy.py
