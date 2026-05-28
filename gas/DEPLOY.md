# Deploying the Tomato Tracker GAS web app

The deploy/redeploy workflow, clasp-v3 trap, manifest invariants, and auth-recovery
notes all live in **[`../CLAUDE.md`](../CLAUDE.md)** under "clasp workflow + auto-redeploy".
The canonical jedOS-wide pattern (CORS shape, `doPost` dispatch, why `clasp run`
doesn't work, REST-API redeploy) is at
`/Volumes/OLAF-EXT/jedwoodx/repos/jedOS/.claude/skills/gas-clasp/SKILL.md`.
Read those first; what's below is only the project-specific bits that aren't covered there.

## Project facts

- Script ID: `1Cw1Y1GR65_CUDzFpvP72GeCr9MREBY8Lf_St2gqokph-CvY_94woTqS4`
- **Standalone** script — reaches the live sheet via `SpreadsheetApp.openById(SHEET_ID)`.
  A bound spreadsheet (`1Y5mjMs…`) that clasp accidentally created when the project was
  first scaffolded is unused and safe to trash in Drive.
- Bypass-token Script Properties: `HARVEST_BYPASS_TOKEN`, `CLAIMS_BYPASS_TOKEN`,
  `DEV_BYPASS_TOKEN`. Each is bound to an action allowlist in `api.gs` (see CLAUDE.md
  "Identities" table).

## One-time bootstrap

Tokens are self-minted by `doGet?bootstrap=1`. After the first `clasp push` + REST
deploy:

```bash
curl -s "$GAS_DEPLOYMENT_URL?bootstrap=1"
# → {"ok":true,"result":{"tokens":{HARVEST_BYPASS_TOKEN,CLAIMS_BYPASS_TOKEN,DEV_BYPASS_TOKEN},...}}
```

Tokens are returned exactly once. Save them into `tomato-tracker/.env` and
`$JEDOS_VAULT/_config/craig.env`. Subsequent calls to `?bootstrap=1` refuse with
`ALREADY_BOOTSTRAPPED`. (The existing `.env` was generated this way — see
the `# Generated 2026-05-05 via /exec?bootstrap=1` comment.)

No editor visit is needed for token setup. The only manual step the first deploy
ever requires is the one-time OAuth consent click that Google forces on the
unverified-app screen.

## Smoke tests

Use `scripts/api_call.py` — it follows the 302 from `/exec` correctly (curl `-L`
forwards `Content-Type` to the content server and gets rejected; see SKILL.md
"CORS + the 302 redirect"):

```bash
./scripts/api_call.py ping
# → {"ok":true,"result":{"user":"jed@limechile.com","ts":"..."}}

# auth boundary: harvest token can't call submitClaim
./scripts/api_call.py submitClaim '[{"name":"X","entries":[]}]' --token-env=HARVEST_BYPASS_TOKEN
# → {"ok":false,"code":"NO_ACCESS","error":"harvest identity may not call submitClaim"}
```

## Schema bootstrap + migrations

Three entry points sit in front of the same underlying logic:

| Function | Surface | Behavior |
|---|---|---|
| `setupAllSheetsWithPrompt` | Apps Script editor (UI) | Shows a `YES_NO` dialog before clearing every declared tab. First-time setup. |
| `setupAllSheetsHeadless`   | Internal               | Same destructive `sheet.clear()` work, no dialog. Called by the doPost dispatch. |
| `setupAllSheetsAction`     | `doPost` action         | Admin-only (`DEV_BYPASS_TOKEN`) dispatch that invokes `setupAllSheetsHeadless`. |

Run **once**, on an empty sheet. After that:

- **Add a column** → edit `TABLES[name].headers` in `Code.js`, push, then
  `./scripts/api_call.py addMissingColumnsAction` (or run `addMissingColumns()`
  from the editor). Additive and idempotent — never touches existing data.
- **Year rollover** → `./scripts/api_call.py copySeedlingsToNewYearAction '[{"fromYear":2026,"toYear":2027}]'`.
- **Never** re-run `setupAllSheets*` against a populated sheet — it wipes every
  declared tab. If it does run by accident, restore via Sheets → File → Version history
  (⌘+Opt+Shift+H).
