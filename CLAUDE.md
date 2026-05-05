# tomato-tracker

The app/forms/sheet workspace for Jed's tomato season tracking. Sister to the `craig` agent in jedOS (which owns the *knowledge* surface — blog, notes, playbooks). This repo owns the **data surface**: Google Sheet, Apps Script web app, two Vite + Svelte forms.

If a Claude session is opened directly in this repo, this file is the load-bearing context. Read it first.

## What lives here

```
tomato-tracker/
  CLAUDE.md            # this file
  README.md            # human-facing readme
  gas/                 # clasp project — Apps Script web app bound to the tomato sheet
    Code.js            # TABLES schema + setupAllSheets + addMissingColumns + onEdit
    api.gs             # doPost JSON API
    appsscript.json    # webapp config + OAuth scopes
    .clasp.json        # scriptId
    DEPLOY.md          # web-app deployment workflow
  spa/                 # Vite + Svelte SPA — harvest + claim forms
    src/
      Harvest.svelte
      Claim.svelte
      lib/api.js       # fetch wrapper for /exec
      lib/poll.js      # visibility-aware polling helper
    ...
  scripts/             # CLI helpers (Python under .venv/bin/python3)
    seed_2026_seedlings.py
    find_variety_photos.py
    sync_variety_photos.py
    deploy-firebase.mjs
  archive/             # the original 2024 single-page form, preserved for reference
  demos/               # Showboat verification demos (one per checkpoint)
  .env.example
```

## Sheet

| Property | Value |
|---|---|
| Sheet ID | `1Fukctm2sh8TekisGromdCbFpKYeGzOVq1aIyG8NbdZE` |
| Open | https://docs.google.com/spreadsheets/d/1Fukctm2sh8TekisGromdCbFpKYeGzOVq1aIyG8NbdZE/edit |
| Reference (older Seeds/2024 Seedlings tabs we modeled the new tab on) | `1Ec9tTJacA8lHKGjv-pBvD30LkzOpXJgdTMvlZX-RzzA` |

### Tabs (declared in `gas/Code.js` `TABLES`)

| Tab | Headers | Notes |
|---|---|---|
| `Harvest Data` | Date, Time, Harvester, Tomato Variety, Quantity | Pre-existing; append-only |
| `2026 Seedlings` | Variety, Available, Photo URL, Photo Slug, Description, Days to Maturity, Color, Type, Source, Notes | Year-current source of truth. `Type` validated to Cherry/Plum/Slicing/Beefsteak/Paste/Other. |
| `Seedling Claims` | Timestamp, Name, Variety, Quantity, Notes, User Token Hash | Append-only; written by atomic `submitClaim` |
| `Dashboard` | _(broken chart — leave alone, not declared in `TABLES`)_ | Rebuild is a follow-up |

### Migrations

- **Add a column to an existing tab:** edit `TABLES[name].headers` in `Code.js`, push, then run `addMissingColumns()` from the Apps Script editor. **Idempotent and additive only** — never touches existing data.
- **Bootstrap fresh tabs:** `setupAllSheets()` is **destructive** (`sheet.clear()` on every declared tab). Dialog-guarded. First-time setup only.
- **Year rollover:** `copySeedlingsToNewYear(2026, 2027)` duplicates the `2026 Seedlings` tab, clears `Available`, preserves variety rows.

If something breaks: Google Sheets keeps full revision history at File → Version history (⌘+Opt+Shift+H). Restore the revision immediately before the bad operation.

## GAS web app — `gas/`

The Apps Script project is the **only** authorized read/write surface for the sheet. Both forms and the `craig` agent (in jedOS) talk to it via `doPost`.

### Endpoint

`POST <GAS_DEPLOYMENT_URL>/exec`

- `Content-Type: text/plain;charset=utf-8` — keeps the request a CORS "simple request" so the GAS 302 redirect to googleusercontent.com works in browsers. Never use `application/json`.
- Body: `{"action": "<name>", "token": "<bypass>", "args": [...]}`
- Response: `{"ok": true, "result": <any>}` or `{"ok": false, "error": "<message>", "code": "<CODE>"}`

### Identities (Script Properties)

| Property | Identity | Allowed actions |
|---|---|---|
| `HARVEST_BYPASS_TOKEN` | `harvest@tomato.local` | `submitHarvest`, `listVarieties`, `ping` |
| `CLAIMS_BYPASS_TOKEN`  | `claims@tomato.local`  | `getInventory`, `submitClaim`, `ping` |
| `DEV_BYPASS_TOKEN`     | `jed@limechile.com`   | all (admin; used by craig for read access) |

Each identity is constrained by an action allowlist set in `api.gs` (pattern mirrors `MUSIC_ALLOWED_ACTIONS` in `.claude/agents/sam-bot/scripts/ward-sheets/api.gs`). A leaked claim-form token can only call `getInventory` / `submitClaim` / `ping` — it can't dump the harvest log or modify schema.

### Actions

| Action | Args | Result | Notes |
|---|---|---|---|
| `ping` | none | `{user, ts}` | Health check |
| `listVarieties` | none | array of variety rows | Used by harvest form autocomplete |
| `getInventory` | none | `{[variety]: available}` | Used by claim form; only varieties with `Available > 1` |
| `submitHarvest` | `{harvester, entries: [{variety, quantity}]}` | `{rowsAdded}` | Append-only |
| `submitClaim` | `{name, entries: [{variety, quantity}], notes?}` | `{claimId}` | **Atomic** — see below |
| `addMissingColumnsAction` | none | `{added: [...]}` | Admin only |
| `copySeedlingsToNewYearAction` | `{fromYear, toYear}` | `{tab}` | Admin only |

### How `submitClaim` prevents overselling

The entire critical section runs inside `LockService.getScriptLock()` with a ~5s timeout:

1. Re-read `Available` for each requested variety.
2. If any `requested > available`, throw `{code: "STOCK_CHANGED", current: {...}}`. Don't append a partial row.
3. Otherwise append the claim row + decrement each `Available` cell.
4. Release the lock.

Two simultaneous claims for the last unit can't both succeed; the loser gets `STOCK_CHANGED` and the SPA re-renders.

## clasp workflow

This host has clasp v3.x. **Every command needs `-u jed`.** Use the wrapper that bakes it in:

```bash
/Volumes/OLAF EXT/jedwoodx/repos/jedOS/bin/clasp push --force      # push local → Apps Script
/Volumes/OLAF EXT/jedwoodx/repos/jedOS/bin/clasp pull              # pull Apps Script → local
/Volumes/OLAF EXT/jedwoodx/repos/jedOS/bin/clasp open              # open the editor in browser
/Volumes/OLAF EXT/jedwoodx/repos/jedOS/bin/clasp deploy --description "v1 tomato api"
```

(The wrapper resolves to `clasp -u jed <args>`.)

Why `--force` on push: clasp v3 skips by default if remote changed since last push. If editing via the Apps Script web editor is possible, treat the local repo as source of truth and force-push.

If push returns `invalid_grant / invalid_rapt`: only Jed can recover via `clasp login -u jed` (opens a browser).

## Forms — `spa/`

Vite + Svelte, deployed to **GitHub Pages** at https://jedwood.github.io/tomato-tracker/.

### Pages

- **`index.html`** — harvest form. This is the canonical bookmarked URL (https://jedwood.github.io/tomato-tracker/). Bundled `HARVEST_BYPASS_TOKEN`. On mount → `listVarieties` autocomplete; submit → `submitHarvest`.
- **`claim.html`** — claim form. URL Jed sends to family: https://jedwood.github.io/tomato-tracker/claim.html. Bundled `CLAIMS_BYPASS_TOKEN`. On mount → `getInventory`; polls every 150s + on `visibilitychange === 'visible'`. Renders varieties with `Available > 1`. Form: name only, variety+quantity steppers. **No email, no pickup field, no per-person cap** — coordination is out-of-band. Submit → `submitClaim`; on `STOCK_CHANGED` re-fetch and highlight conflicts.

Vite multi-page build via `rollupOptions.input` produces both HTML files at `dist/` root.

### Build / deploy

```bash
cd spa
npm install         # first time
npm run dev         # local
npm run build       # outputs to spa/dist/
node ../scripts/deploy-ghpages.mjs   # copies dist/* to repo root, commits, pushes
```

GitHub Pages serves from `master` branch root, so `deploy-ghpages.mjs`:
1. Builds the SPA into `spa/dist/`.
2. Copies built `index.html`, `claim.html`, and assets/ into the repo root.
3. Stages, commits, and pushes — Pages picks up the change within ~1 minute.

The build artifacts (root `index.html`, `claim.html`, `assets/`) are committed to master; they're the deployed site. **Don't edit them by hand** — always re-run the build/deploy script. Source of truth is `spa/src/`.

### GitHub Pages config

```bash
gh api repos/jedwood/tomato-tracker/pages   # current config
# source: master branch, path: /
```

The bookmarked URL (https://jedwood.github.io/tomato-tracker/) is **overwritten in place** when the new SPA deploys. No redirect needed; the new harvest form replaces the old single-page form transparently.

## Photos

Public Drive folder, anyone-with-link sharing. `sync_variety_photos.py` uploads local jpgs from `$JEDOS_VAULT/_state/craig/photos/varieties/<slug>.jpg`, sets the share, and writes the resulting URL into the `Photo URL` column on `2026 Seedlings`.

If Drive's anonymous hotlink starts rate-limiting in real use, migrate to Firebase Storage with public-read on `tomato-photos/`. Same project as the SPA. Document the cutover here when it happens.

## Verification (Showboat)

Each meaningful checkpoint produces a `demos/NN-<name>.md` Showboat demo with shell + DOM + screenshot evidence. Committed alongside the code change. Demo numbers map to the build-sequence step from the plan:

- `04-setup-sheets.md` — tabs created with correct headers; Dashboard untouched
- `05-gas-deploy.md` — `/exec` ping + auth-boundary checks
- `09-harvest-spa.md` — `/harvest` Rodney load, dropdown populated, test submit
- `09b-old-url-redirect.md` — old `/exec` URL meta-refreshes to new SPA
- `10-photos.md` — sample Drive image URLs return 200 + valid JPEG
- `11-claim-spa.md` — two-session conflict; `STOCK_CHANGED` UX; polling visible

## Pointers

- **Knowledge & curation** (Craig's blog, varieties, playbooks, season retros) → `craig` agent in `/Volumes/OLAF EXT/jedwoodx/repos/jedOS/.claude/agents/craig/`
- **Reference for GAS pattern** → `.claude/agents/sam-bot/scripts/ward-sheets/` in jedOS (Code.js, api.gs, CLAUDE.md, DEPLOY.md). This repo's `gas/` is a deliberate port of that pattern.
- **Reference for SPA pattern** → `spa/ward-music/` in jedOS

## Don'ts

- Don't run `setupAllSheets()` on a populated sheet. Use `addMissingColumns()` for column additions.
- Don't use `application/json` Content-Type when calling `/exec` — breaks CORS.
- Don't put bypass tokens in commit history. They live in Script Properties + the local `.env` (gitignored).
- Don't touch the `Dashboard` tab — rebuilding it is a separate task.
- Don't delete the old `archive/` form code; the redirect lives there.
