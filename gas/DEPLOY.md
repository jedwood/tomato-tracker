# Deploying the Tomato Tracker GAS web app

This script project (id `1Cw1Y1GR65_CUDzFpvP72GeCr9MREBY8Lf_St2gqokph-CvY_94woTqS4`) is **standalone**, but reads/writes the live Tomato Tracker spreadsheet via `SpreadsheetApp.openById(SHEET_ID)`. The bound spreadsheet that clasp accidentally created (`1Y5mjMs…`) is unused and can be trashed in Drive.

## Prerequisites

- clasp v3 installed (`/Volumes/OLAF EXT/jedwoodx/repos/jedOS/bin/clasp` baked in `-u jed`)
- Logged in as Jed (`clasp login -u jed` if `invalid_grant`)

## First-time setup

1. **Push code** to the script project:

   ```bash
   cd tomato-tracker/gas
   /Volumes/OLAF\ EXT/jedwoodx/repos/jedOS/bin/clasp push --force
   ```

2. **Set Script Properties** for the bypass tokens. From the Apps Script editor → Project Settings → Script Properties → Add property. Generate long random strings (e.g. `openssl rand -hex 32`):

   | Property | Value |
   |---|---|
   | `HARVEST_BYPASS_TOKEN` | (32+ char random) — bundled into `spa/index.html` build |
   | `CLAIMS_BYPASS_TOKEN`  | (32+ char random) — bundled into `spa/claim.html` build |
   | `DEV_BYPASS_TOKEN`     | (32+ char random) — used by craig and admin actions |

   Save these into `tomato-tracker/.env` (gitignored) and `$JEDOS_VAULT/_config/craig.env`.

3. **Run `setupAllSheets`** once via the Apps Script editor:
   - `bin/clasp open` (opens the editor in browser)
   - Select `setupAllSheets` from the function dropdown
   - Click Run; approve the scope grant on first invocation
   - Confirm the destructive dialog
   - Verify in the spreadsheet that `Harvest Data`, `2026 Seedlings`, `Seedling Claims` are populated with headers; `Dashboard` is untouched

4. **Deploy as Web App**:

   ```bash
   /Volumes/OLAF\ EXT/jedwoodx/repos/jedOS/bin/clasp deploy --description "v1 tomato api"
   ```

   The deploy URL is `https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec`. Save it in `tomato-tracker/.env` as `GAS_DEPLOYMENT_URL` and in `$JEDOS_VAULT/_config/craig.env` as `GAS_DEPLOYMENT_URL`.

5. **Smoke-test ping**:

   ```bash
   curl -s -X POST "$GAS_DEPLOYMENT_URL" \
     -H "Content-Type: text/plain;charset=utf-8" \
     -d '{"action":"ping","token":"'"$DEV_BYPASS_TOKEN"'"}'
   # → {"ok":true,"result":{"user":"jed@limechile.com","ts":"..."}}
   ```

   And verify auth boundary:
   ```bash
   curl -s -X POST "$GAS_DEPLOYMENT_URL" \
     -H "Content-Type: text/plain;charset=utf-8" \
     -d '{"action":"submitClaim","token":"'"$HARVEST_BYPASS_TOKEN"'","args":[{"name":"X","entries":[]}]}'
   # → {"ok":false,"code":"NO_ACCESS","error":"harvest identity may not call submitClaim"}
   ```

## Re-deploys

After editing `Code.js` or `api.gs`:

```bash
cd tomato-tracker/gas
/Volumes/OLAF\ EXT/jedwoodx/repos/jedOS/bin/clasp push --force
/Volumes/OLAF\ EXT/jedwoodx/repos/jedOS/bin/clasp deploy --description "<change summary>"
```

The deployment URL stays the same (clasp updates the `HEAD` deployment in place). Previous deployment IDs are preserved for rollback in the Apps Script editor → Manage Deployments.

## Schema migrations

- Adding a column: edit `TABLES[name].headers` in `Code.js`, push, run `addMissingColumns()` from the editor (additive, idempotent, never destroys data).
- **Don't run `setupAllSheets()` on a populated sheet** — it clears every declared tab.
- Year rollover: `copySeedlingsToNewYear(2026, 2027)` from the editor.

## Recovery

If something goes wrong on the spreadsheet, Google Sheets keeps full revision history at File → Version history (⌘+Opt+Shift+H). Restore the version immediately before the bad operation.

If `clasp push` returns `invalid_grant / invalid_rapt`, only Jed can recover via `clasp login -u jed` (opens a browser).
