/**
 * Tomato Tracker — JSON API
 *
 * doPost entrypoint for the harvest + claim forms (tomato-tracker/spa/) and
 * for craig agent reads. Deployed as a GAS Web App ("Execute as: me",
 * "Access: Anyone"). Authorization is enforced by bypass tokens, each
 * mapped to a constrained action allowlist — pattern ported from
 * .claude/agents/sam-bot/scripts/ward-sheets/api.gs (the music identity).
 *
 * Protocol:
 *   POST <deployment>/exec
 *   Content-Type: text/plain;charset=utf-8     // simple CORS, no preflight
 *   Body: {"action": "<name>", "token": "<bypass>", "args": [...]}
 *
 * Response:
 *   200 {"ok": true, "result": <any>}
 *   200 {"ok": false, "error": "<message>", "code": "<CODE>"}
 *
 * CORS gotcha: GAS /exec replies with a 302 to googleusercontent.com.
 * Browsers follow it transparently only when the original request is a
 * CORS "simple request" — POST with Content-Type text/plain and no custom
 * headers. Do NOT send Authorization headers or application/json.
 */

const HARVEST_BYPASS_TOKEN = PropertiesService.getScriptProperties().getProperty('HARVEST_BYPASS_TOKEN');
const HARVEST_IDENTITY = 'harvest@tomato.local';
const CLAIMS_BYPASS_TOKEN = PropertiesService.getScriptProperties().getProperty('CLAIMS_BYPASS_TOKEN');
const CLAIMS_IDENTITY = 'claims@tomato.local';
const DEV_BYPASS_TOKEN = PropertiesService.getScriptProperties().getProperty('DEV_BYPASS_TOKEN');
const DEV_IDENTITY = 'jed@limechile.com';

const HARVEST_ALLOWED = new Set(['ping', 'listVarieties', 'submitHarvest']);
const CLAIMS_ALLOWED  = new Set(['ping', 'getInventory', 'submitClaim']);
// DEV identity has no restriction (admin).

// Default year for listVarieties / getInventory joins — bump on year rollover.
const CURRENT_YEAR = 2026;

// ============================================================
// ENTRYPOINTS
// ============================================================

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const { action, token, args } = body;

    if (!action) return fail_('BAD_REQUEST', 'missing action');
    if (!ACTIONS[action]) return fail_('UNKNOWN_ACTION', 'no such action: ' + action);

    const identity = identifyToken_(token);
    if (!identity) return fail_('NO_ACCESS', 'invalid token', 403);

    if (identity === HARVEST_IDENTITY && !HARVEST_ALLOWED.has(action)) {
      return fail_('NO_ACCESS', 'harvest identity may not call ' + action, 403);
    }
    if (identity === CLAIMS_IDENTITY && !CLAIMS_ALLOWED.has(action)) {
      return fail_('NO_ACCESS', 'claims identity may not call ' + action, 403);
    }

    const result = ACTIONS[action](identity, ...(args || []));
    return ok_(result);
  } catch (err) {
    if (err && err.code) return fail_(err.code, err.message || String(err));
    return fail_('SERVER_ERROR', err && err.message ? err.message : String(err));
  }
}

// Health page so opening the URL in a browser isn't scary.
//
// Special: GET ?bootstrap=1 is a one-shot first-run hook. If none of the
// bypass-token Script Properties are set, generate three random tokens,
// save them to Script Properties, and return them in the response (this is
// the only time they're ever exposed). On every call after that, refuse.
function doGet(e) {
  const props = PropertiesService.getScriptProperties();
  if (e && e.parameter && e.parameter.bootstrap === '1') {
    const existing = props.getProperty('HARVEST_BYPASS_TOKEN')
      || props.getProperty('CLAIMS_BYPASS_TOKEN')
      || props.getProperty('DEV_BYPASS_TOKEN');
    if (existing) {
      return ContentService.createTextOutput(JSON.stringify({
        ok: false, code: 'ALREADY_BOOTSTRAPPED',
        error: 'Script Properties already set. Reset via the Apps Script editor to re-bootstrap.'
      })).setMimeType(ContentService.MimeType.JSON);
    }
    const tokens = {
      HARVEST_BYPASS_TOKEN: randomToken_(),
      CLAIMS_BYPASS_TOKEN: randomToken_(),
      DEV_BYPASS_TOKEN: randomToken_()
    };
    props.setProperties(tokens);
    return ContentService.createTextOutput(JSON.stringify({
      ok: true,
      result: {
        tokens,
        message: 'Save these in tomato-tracker/.env and $JEDOS_VAULT/_config/craig.env. They will not be shown again.'
      }
    })).setMimeType(ContentService.MimeType.JSON);
  }
  return ContentService
    .createTextOutput(JSON.stringify({ ok: true, service: 'tomato-tracker-api', ts: new Date().toISOString() }))
    .setMimeType(ContentService.MimeType.JSON);
}

function randomToken_() {
  // 32 bytes → 64 hex chars. Plenty for our threat model.
  const bytes = new Array(32);
  for (let i = 0; i < 32; i++) bytes[i] = Math.floor(Math.random() * 256);
  return bytes.map(b => b.toString(16).padStart(2, '0')).join('');
}

// ============================================================
// AUTH
// ============================================================

/**
 * Constant-time-ish bypass token check using SHA-256 digests. Returns the
 * mapped identity string or null if no token matches.
 */
function identifyToken_(token) {
  if (!token) return null;
  if (matchToken_(token, DEV_BYPASS_TOKEN)) return DEV_IDENTITY;
  if (matchToken_(token, HARVEST_BYPASS_TOKEN)) return HARVEST_IDENTITY;
  if (matchToken_(token, CLAIMS_BYPASS_TOKEN)) return CLAIMS_IDENTITY;
  return null;
}

function matchToken_(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  const ah = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, a).toString();
  const bh = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, b).toString();
  return ah === bh;
}

// ============================================================
// ACTION DISPATCH
// ============================================================

// Bump on every code change that affects setup/migration semantics — used by
// the api_call.py smoke tests to confirm a redeploy actually shipped before
// any potentially-destructive admin action runs.
// IMPORTANT: this code is intended to be FROZEN after the initial deploy.
// Every conceivable schema/data operation is exposed as a generic admin
// action below so we never have to push new GAS code again. If you find
// yourself wanting to add an action, first see whether it can be
// expressed as a sequence of calls to the existing generic primitives
// (readTab, addRows, upsertRows, setCell, importTabFromSheet).
const CODE_VERSION = 'v4-frozen-comprehensive-2026-05-05';

const ACTIONS = {
  ping: (identity) => ({ user: identity, ts: new Date().toISOString(), version: CODE_VERSION }),

  // Lists all varieties from the Varieties master, joined with the current
  // year's Available count (and Year Notes). Used by harvest form
  // autocomplete and by craig agent for variety questions.
  listVarieties: (identity, year) => listVarietiesJoined_(year || CURRENT_YEAR),

  // Slim `[{variety, available, photoUrl, description, color, type}]`
  // shape for the claim form. Only varieties with available > 1 are
  // included — server-side filter so leaked CLAIMS token can't enumerate
  // sold-out varieties.
  getInventory: (identity, year) => getInventoryJoined_(year || CURRENT_YEAR),

  submitHarvest: (identity, payload) => appendHarvest_(payload, identity),

  submitClaim: (identity, payload) => appendClaimAtomic_(payload, identity, CURRENT_YEAR),

  // ------------------------------------------------------------------
  // ADMIN — generic primitives. DEV identity only.
  // ------------------------------------------------------------------

  // Returns `{tabs: [{name, headers, rowCount}], spreadsheetUrl}` for our
  // sheet. Use this to inspect state from CLI without opening the editor.
  getSheetMetadata: (identity) => {
    requireAdmin_(identity);
    return getSheetMetadata_();
  },

  // Reads any tab and returns rows as objects keyed by header. Optional
  // `range` arg (e.g. `{startRow, numRows}`) lets you page large tabs.
  readTab: (identity, tabName, range) => {
    requireAdmin_(identity);
    return readTab_(tabName, range || {});
  },

  // Reads ANOTHER spreadsheet's tab (Jed's account must have access).
  // Used to import the legacy Seeds tab from Jed's reference sheet.
  // Returns `{headers, rows, photoFormulas}` where photoFormulas is
  // `{rowIndex: {colName: formulaText}}` for cells with =IMAGE() formulas.
  readForeignSheet: (identity, sourceSheetId, sourceTabName) => {
    requireAdmin_(identity);
    return readForeignSheet_(sourceSheetId, sourceTabName);
  },

  // Extract URLs from cells with embedded "Insert Image in Cell" images
  // (CellImage objects). Returns `{[keyValue]: {url, altText}}` keyed by
  // the value of `keyColumn`. Use to pull photos out of a foreign sheet
  // where the image was uploaded inline rather than referenced via IMAGE().
  extractForeignSheetImages: (identity, sourceSheetId, sourceTabName, keyColumn, imageColumn) => {
    requireAdmin_(identity);
    return extractForeignSheetImages_(sourceSheetId, sourceTabName, keyColumn, imageColumn);
  },

  // Append rows to ANY of our tabs. `rows` is array of objects keyed by
  // header. Missing keys → blank. Extra keys → ignored.
  addRows: (identity, tabName, rows) => {
    requireAdmin_(identity);
    return addRows_(tabName, rows || []);
  },

  // Upsert rows by a key column. e.g. upsertRows("Varieties", "Variety", [...])
  // replaces any existing row whose Variety matches (case-insensitive
  // trim), appends otherwise. Existing values that aren't in the patch
  // are preserved (PATCH semantics, not PUT).
  upsertRows: (identity, tabName, keyColumn, rows) => {
    requireAdmin_(identity);
    return upsertRows_(tabName, keyColumn, rows || []);
  },

  // Sets a single cell value. `range` is A1 notation, e.g. "Varieties!B12".
  setCell: (identity, range, value) => {
    requireAdmin_(identity);
    return setCell_(range, value);
  },

  // Clears data validations on an entire column of a tab. Use when a
  // column's controlled-vocab list is too restrictive for incoming data.
  clearColumnValidation: (identity, tabName, columnName) => {
    requireAdmin_(identity);
    return clearColumnValidation_(tabName, columnName);
  },

  // Removes columns from a tab (header + all data). Refuses to remove a
  // column that has any non-blank cell unless `force: true`. Returns
  // `{removed, kept, refused}`.
  removeColumns: (identity, tabName, columnNames, opts) => {
    requireAdmin_(identity);
    return removeColumns_(tabName, columnNames || [], opts || {});
  },

  // Delete rows by key value (case-insensitive trim match on the key column).
  // `keyValues` is an array. Returns `{deleted, notFound}`.
  deleteRowsByKey: (identity, tabName, keyColumn, keyValues) => {
    requireAdmin_(identity);
    return deleteRowsByKey_(tabName, keyColumn, keyValues || []);
  },

  // High-level: imports a foreign-sheet tab into our Varieties master,
  // upserting by Variety (case-insensitive trim). Auto-extracts IMAGE()
  // formula URLs into Photo URL. Returns `{added, updated, skipped}`.
  importVarietiesFromSheet: (identity, sourceSheetId, sourceTabName) => {
    requireAdmin_(identity);
    return importVarietiesFromSheet_(sourceSheetId, sourceTabName);
  },

  // Ensures each variety name is in Varieties (creates blank rows if
  // missing) and writes them as the contents of `<year> Seedlings`.
  // Idempotent: re-running with the same list is a no-op.
  // `mode`: "merge" (default) keeps existing seedling rows + appends new
  //         ones; "replace" wipes the year tab and writes fresh.
  seedYearFromList: (identity, year, varietyNames, mode) => {
    requireAdmin_(identity);
    return seedYearFromList_(year, varietyNames || [], mode || 'merge');
  },

  // Wraps the schema-aware idempotent setup. Safe to re-run; never
  // touches populated tabs.
  setupAllSheetsAction: (identity) => {
    requireAdmin_(identity);
    return setupAllSheetsHeadless();
  },

  addMissingColumnsAction: (identity) => {
    requireAdmin_(identity);
    addMissingColumns();
    return { ok: true };
  },

  copySeedlingsToNewYearAction: (identity, fromYear, toYear) => {
    requireAdmin_(identity);
    copySeedlingsToNewYear(fromYear, toYear);
    return { from: fromYear, to: toYear };
  }
};

function requireAdmin_(identity) {
  if (identity !== DEV_IDENTITY) {
    throw withCode_('NO_ACCESS', 'admin only');
  }
}

// ============================================================
// READS — generic
// ============================================================

function tabOrFail_(tabName) {
  const sheet = getSheet_().getSheetByName(tabName);
  if (!sheet) throw withCode_('NOT_FOUND', "tab '" + tabName + "' missing");
  return sheet;
}

/**
 * Reads any tab and returns `{headers, rows}` where rows is an array of
 * objects keyed by header. Optional range = {startRow, numRows} (1-indexed
 * from the data, not from the sheet).
 */
function readTab_(tabName, range) {
  const sheet = tabOrFail_(tabName);
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 1 || lastCol < 1) return { headers: [], rows: [] };

  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  if (lastRow < 2) return { headers, rows: [] };

  const startRow = Math.max(1, range.startRow || 1);  // data row index
  const wantRows = range.numRows ? range.numRows : (lastRow - 1 - (startRow - 1));
  const numRows = Math.min(wantRows, lastRow - 1 - (startRow - 1));
  if (numRows <= 0) return { headers, rows: [] };

  const values = sheet.getRange(1 + startRow, 1, numRows, lastCol).getValues();
  const rows = values.map(row => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = row[i]; });
    return obj;
  });
  return { headers, rows };
}

/**
 * Reads a tab from a foreign spreadsheet. Returns `{headers, rows,
 * photoFormulas}` where photoFormulas[rowIndex][colName] = "=IMAGE(...)"
 * formula text for cells with image formulas (extracted URLs preserved).
 *
 * Inline images inserted via Insert→Image (cell-anchored) are NOT
 * accessible via the standard Sheets API; they're surfaced as empty
 * cells. Caller has to handle those with photo URLs separately.
 */
function readForeignSheet_(sourceSheetId, sourceTabName) {
  const ss = SpreadsheetApp.openById(sourceSheetId);
  const sheet = ss.getSheetByName(sourceTabName);
  if (!sheet) throw withCode_('NOT_FOUND', "foreign tab '" + sourceTabName + "' missing");
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 1) return { headers: [], rows: [], photoFormulas: {} };
  const range = sheet.getRange(1, 1, lastRow, lastCol);
  const values = range.getValues();
  const formulas = range.getFormulas();
  const headers = values[0];

  const rows = [];
  const photoFormulas = {};
  for (let r = 1; r < values.length; r++) {
    const obj = {};
    let imageHere = null;
    headers.forEach((h, i) => {
      obj[h] = values[r][i];
      const f = formulas[r][i];
      if (f && /^=IMAGE\(/i.test(f)) {
        // Extract URL out of =IMAGE("https://...") or =IMAGE("...",...).
        const m = f.match(/=IMAGE\s*\(\s*["']([^"']+)["']/i);
        if (m) {
          imageHere = imageHere || {};
          imageHere[h] = m[1];
        }
      }
    });
    rows.push(obj);
    if (imageHere) photoFormulas[r - 1] = imageHere;
  }
  return { headers, rows, photoFormulas };
}

/**
 * Pull URLs from "Insert Image in Cell" embedded images in a foreign
 * spreadsheet. Returns `{rows: [{key, url, altText}], failures: []}`.
 *
 * For each non-empty row, we read the imageColumn cell as a CellImage
 * object (sheet.getRange(...).getValue() returns a CellImage when the
 * cell has an inline image). CellImage exposes:
 *   - getUrl()         → original source URL if the image was inserted
 *                        from a URL; null for uploads.
 *   - getContentUrl()  → temporary Google-hosted URL (short-lived).
 *   - getAltTextDescription() / getAltTextTitle()
 *
 * For uploads (the common case in Jed's source sheet), getUrl() returns
 * null, so we fall back to getContentUrl() and the caller is responsible
 * for either using the temp URL while it's fresh, or rehosting elsewhere.
 */
function extractForeignSheetImages_(sourceSheetId, sourceTabName, keyColumn, imageColumn) {
  const ss = SpreadsheetApp.openById(sourceSheetId);
  const sheet = ss.getSheetByName(sourceTabName);
  if (!sheet) throw withCode_('NOT_FOUND', "foreign tab '" + sourceTabName + "' missing");

  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 2) return { rows: [], failures: [] };

  const headerRange = sheet.getRange(1, 1, 1, lastCol);
  const headers = headerRange.getValues()[0];
  const keyIdx = headers.indexOf(keyColumn);
  const imgIdx = headers.indexOf(imageColumn);
  if (keyIdx < 0) throw withCode_('NOT_FOUND', "key column '" + keyColumn + "' not in source");
  if (imgIdx < 0) throw withCode_('NOT_FOUND', "image column '" + imageColumn + "' not in source");

  const rows = [];
  const failures = [];
  for (let r = 2; r <= lastRow; r++) {
    const keyVal = String(sheet.getRange(r, keyIdx + 1).getValue() || '').trim();
    if (!keyVal) continue;
    const imgCell = sheet.getRange(r, imgIdx + 1);
    const imgVal = imgCell.getValue();
    if (!imgVal || typeof imgVal !== 'object') {
      // Empty cell or plain text — skip silently.
      continue;
    }
    try {
      // CellImage methods. Try original URL first, fall back to content URL.
      let url = null, altText = '';
      if (typeof imgVal.getUrl === 'function') url = imgVal.getUrl();
      if (!url && typeof imgVal.getContentUrl === 'function') url = imgVal.getContentUrl();
      if (typeof imgVal.getAltTextDescription === 'function') {
        altText = imgVal.getAltTextDescription() || '';
      }
      if (url) {
        rows.push({ key: keyVal, url, altText });
      } else {
        failures.push({ key: keyVal, reason: 'no URL accessible from CellImage' });
      }
    } catch (err) {
      failures.push({ key: keyVal, reason: String(err) });
    }
  }
  return { rows, failures };
}

/**
 * Returns metadata for every tab in our spreadsheet:
 * `{spreadsheetUrl, tabs: [{name, headers, rowCount, columnCount}]}`.
 */
function getSheetMetadata_() {
  const ss = getSheet_();
  const tabs = ss.getSheets().map(s => {
    const lastRow = s.getLastRow();
    const lastCol = s.getLastColumn();
    const headers = lastCol > 0 ? s.getRange(1, 1, 1, lastCol).getValues()[0] : [];
    return {
      name: s.getName(),
      headers,
      rowCount: Math.max(0, lastRow - (lastRow > 0 ? 1 : 0)),
      columnCount: lastCol
    };
  });
  return { spreadsheetUrl: ss.getUrl(), tabs };
}

// ============================================================
// READS — domain
// ============================================================

/**
 * Joins Varieties (master) with `<year> Seedlings` (Available + Year
 * Notes). Returns one row per variety in Varieties, with seedling
 * fields merged in (or 0 / blank if no seedling row).
 *
 * Stable shape — fed to harvest autocomplete (just needs Variety) AND
 * to the claim form (needs photo + description). Ordered alphabetically
 * by Variety.
 */
function listVarietiesJoined_(year) {
  const ss = getSheet_();
  const masterSheet = ss.getSheetByName('Varieties');
  if (!masterSheet) return [];  // no master yet — empty list (form falls back to free text)
  const seedlingTab = String(year) + ' Seedlings';
  const seedSheet = ss.getSheetByName(seedlingTab);

  const master = readTab_('Varieties', {});
  const seedling = seedSheet ? readTab_(seedlingTab, {}) : { rows: [] };

  // Build availability map from the seedling tab.
  const seedMap = {};
  seedling.rows.forEach(r => {
    const name = String(r['Variety'] || '').trim();
    if (!name) return;
    seedMap[name.toLowerCase()] = {
      available: Number(r['Available']) || 0,
      yearNotes: r['Year Notes'] || ''
    };
  });

  return master.rows
    .filter(r => String(r['Variety'] || '').trim())
    .map(r => {
      const name = String(r['Variety']).trim();
      const seed = seedMap[name.toLowerCase()] || { available: 0, yearNotes: '' };
      return {
        Variety: name,
        Type: r['Type'] || '',
        Color: r['Color'] || '',
        DaysToMaturity: r['Days to Maturity'] || '',
        Source: r['Source'] || '',
        Description: r['Description'] || '',
        PhotoURL: r['Photo URL'] || '',
        YearsGrown: r['Years Grown'] || '',
        LastGrown: r['Last Grown'] || '',
        Notes: r['Notes'] || '',
        ExternalNotes: r['External Notes'] || '',
        Available: seed.available,
        YearNotes: seed.yearNotes
      };
    })
    .sort((a, b) => a.Variety.localeCompare(b.Variety));
}

function getInventoryJoined_(year) {
  return listVarietiesJoined_(year)
    .filter(v => v.Available > 0)
    .map(v => ({
      variety: v.Variety,
      available: v.Available,
      photoUrl: v.PhotoURL,
      description: v.Description,
      type: v.Type,
      color: v.Color
    }));
}

// ============================================================
// WRITES — generic admin
// ============================================================

/**
 * Append rows to any tab. `rows` is an array of plain objects keyed by
 * header name. Missing keys → blank cells. Extra keys → silently ignored.
 * Returns `{rowsAdded}`.
 */
function addRows_(tabName, rows) {
  if (!Array.isArray(rows) || !rows.length) return { rowsAdded: 0 };
  const sheet = tabOrFail_(tabName);
  const lastCol = sheet.getLastColumn();
  if (lastCol < 1) throw withCode_('NOT_INITIALIZED', "tab '" + tabName + "' has no headers");
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];

  const matrix = rows.map(obj => headers.map(h => (h in obj ? obj[h] : '')));
  const startRow = Math.max(2, sheet.getLastRow() + 1);
  sheet.getRange(startRow, 1, matrix.length, headers.length).setValues(matrix);
  return { rowsAdded: matrix.length };
}

/**
 * Upsert rows by a key column. Existing rows whose `keyColumn` value
 * matches (case-insensitive trim) are PATCHED — only the keys present in
 * the patch object are changed; other cells in the row are preserved.
 * Non-matching rows are appended.
 *
 * Returns `{added, updated, skipped}` (skipped = rows with empty key).
 */
function upsertRows_(tabName, keyColumn, rows) {
  if (!Array.isArray(rows) || !rows.length) return { added: 0, updated: 0, skipped: 0 };
  const sheet = tabOrFail_(tabName);
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, Math.max(1, lastCol)).getValues()[0];
  const keyIdx = headers.indexOf(keyColumn);
  if (keyIdx < 0) throw withCode_('BAD_REQUEST', "tab '" + tabName + "' has no '" + keyColumn + "' column");

  // Existing rows by lowercase key.
  const existingValues = lastRow > 1
    ? sheet.getRange(2, 1, lastRow - 1, lastCol).getValues()
    : [];
  const existingMap = {};
  existingValues.forEach((row, i) => {
    const k = String(row[keyIdx] || '').trim().toLowerCase();
    if (k) existingMap[k] = { rowNum: i + 2, values: row };
  });

  let updated = 0, added = 0, skipped = 0;
  const toAppend = [];
  rows.forEach(patch => {
    const keyVal = String(patch[keyColumn] || '').trim();
    if (!keyVal) { skipped++; return; }
    const lowerKey = keyVal.toLowerCase();
    const hit = existingMap[lowerKey];
    if (hit) {
      // PATCH semantics: update only the cells that have a key in patch.
      headers.forEach((h, i) => {
        if (h in patch) hit.values[i] = patch[h];
      });
      sheet.getRange(hit.rowNum, 1, 1, headers.length).setValues([hit.values]);
      updated++;
    } else {
      const newRow = headers.map(h => (h in patch ? patch[h] : ''));
      toAppend.push(newRow);
      added++;
      // Track in map so a later patch in the same call upserts cleanly.
      existingMap[lowerKey] = { rowNum: lastRow + toAppend.length, values: newRow };
    }
  });
  if (toAppend.length) {
    const startRow = Math.max(2, sheet.getLastRow() + 1);
    sheet.getRange(startRow, 1, toAppend.length, headers.length).setValues(toAppend);
  }
  return { added, updated, skipped };
}

/**
 * Set a single cell. `range` is A1 notation including tab name,
 * e.g. "Varieties!B12". Returns the new value (after Sheets coercion).
 */
function setCell_(range, value) {
  const ss = getSheet_();
  const r = ss.getRange(range);
  r.setValue(value);
  return { range, value: r.getValue() };
}

/**
 * Remove columns from a tab. Safety: refuses to remove a column with any
 * non-blank value unless `opts.force === true`. Removes from rightmost
 * to leftmost so column indexes stay stable across deletions.
 */
function removeColumns_(tabName, columnNames, opts) {
  const sheet = tabOrFail_(tabName);
  const lastCol = sheet.getLastColumn();
  const lastRow = sheet.getLastRow();
  if (lastCol < 1) return { removed: [], kept: [], refused: [] };
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];

  // Build list of (header, colIndex) for every column to remove that exists.
  const targets = [];
  const refused = [];
  const kept = [];
  columnNames.forEach(name => {
    const idx = headers.indexOf(name);
    if (idx < 0) {
      kept.push({ name, reason: 'not present' });
      return;
    }
    if (!opts.force && lastRow > 1) {
      const colData = sheet.getRange(2, idx + 1, lastRow - 1, 1).getValues();
      const hasData = colData.some(r => r[0] !== '' && r[0] != null);
      if (hasData) {
        refused.push({ name, reason: 'column has non-blank cells; pass force:true to override' });
        return;
      }
    }
    targets.push({ name, colIndex: idx + 1 });
  });

  // Delete rightmost-to-leftmost so column indexes don't shift under us.
  targets.sort((a, b) => b.colIndex - a.colIndex);
  const removed = [];
  targets.forEach(t => {
    sheet.deleteColumn(t.colIndex);
    removed.push(t.name);
  });
  return { removed, kept, refused };
}

/**
 * Delete data rows whose key column matches any of `keyValues`
 * (case-insensitive trim). Iterates rightmost-first so row indices stay
 * stable. Returns `{deleted: [string], notFound: [string]}`.
 */
function deleteRowsByKey_(tabName, keyColumn, keyValues) {
  const sheet = tabOrFail_(tabName);
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 2) return { deleted: [], notFound: keyValues.slice() };
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const keyIdx = headers.indexOf(keyColumn);
  if (keyIdx < 0) throw withCode_('NOT_FOUND', "key column '" + keyColumn + "' not on " + tabName);

  // Wanted set, lowercased.
  const wanted = {};
  keyValues.forEach(k => {
    const norm = String(k || '').trim().toLowerCase();
    if (norm) wanted[norm] = k;
  });

  // Walk data rows; collect rownums of matches.
  const data = sheet.getRange(2, keyIdx + 1, lastRow - 1, 1).getValues();
  const matches = [];
  data.forEach((r, i) => {
    const norm = String(r[0] || '').trim().toLowerCase();
    if (norm && norm in wanted) {
      matches.push({ rowNum: i + 2, original: wanted[norm] });
      delete wanted[norm];
    }
  });
  // Delete bottom-up.
  matches.sort((a, b) => b.rowNum - a.rowNum);
  matches.forEach(m => sheet.deleteRow(m.rowNum));
  return {
    deleted: matches.map(m => m.original),
    notFound: Object.values(wanted)
  };
}

function clearColumnValidation_(tabName, columnName) {
  const sheet = tabOrFail_(tabName);
  const lastCol = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const colIdx = headers.indexOf(columnName);
  if (colIdx < 0) throw withCode_('NOT_FOUND', "column '" + columnName + "' not on " + tabName);
  const maxRows = sheet.getMaxRows();
  if (maxRows < 2) return { cleared: 0 };
  sheet.getRange(2, colIdx + 1, maxRows - 1, 1).clearDataValidations();
  return { cleared: maxRows - 1, tab: tabName, column: columnName };
}

/**
 * Import a foreign-sheet tab into our `Varieties` master, upserting by
 * Variety name. Maps source columns to our schema by name (case- and
 * whitespace-insensitive). Auto-fills `Photo URL` from any IMAGE()
 * formula found in the source row, and stamps `Imported From` with the
 * source sheet ID + tab.
 *
 * Returns `{added, updated, sample, sourceColumns}`.
 */
function importVarietiesFromSheet_(sourceSheetId, sourceTabName) {
  const foreign = readForeignSheet_(sourceSheetId, sourceTabName);
  if (!foreign.rows.length) return { added: 0, updated: 0, sample: [], sourceColumns: foreign.headers };

  const ourHeaders = TABLES['Varieties'].headers;
  const headerMap = {};  // lowercased our-header → foreign-header
  ourHeaders.forEach(h => {
    const norm = h.toLowerCase().replace(/\s+/g, '');
    foreign.headers.forEach(fh => {
      const fnorm = String(fh || '').toLowerCase().replace(/\s+/g, '');
      if (fnorm === norm && !(h in headerMap)) headerMap[h] = fh;
    });
  });
  // Specific aliases the source sheet often uses
  const aliases = {
    'Variety':           ['variety', 'name', 'tomato', 'tomatovariety'],
    'Type':              ['type', 'category'],
    'Color':             ['color', 'colour'],
    'Days to Maturity':  ['daystomaturity', 'days', 'dtm', 'maturity'],
    'Source':            ['source', 'seedsource', 'breeder', 'origin'],
    'Description':       ['description', 'notes', 'desc'],
    'Photo URL':         ['photourl', 'photo', 'image', 'imageurl', 'picture'],
    'External Notes':    ['externalnotes', 'externalnote', 'reference']
  };
  Object.keys(aliases).forEach(h => {
    if (h in headerMap) return;
    const choices = aliases[h];
    foreign.headers.forEach(fh => {
      if (h in headerMap) return;
      const fnorm = String(fh || '').toLowerCase().replace(/\s+/g, '');
      if (choices.indexOf(fnorm) >= 0) headerMap[h] = fh;
    });
  });

  const sourceTag = sourceSheetId + ':' + sourceTabName;
  const patches = [];
  foreign.rows.forEach((srcRow, idx) => {
    const variety = String(srcRow[headerMap['Variety']] || '').trim();
    if (!variety) return;
    const patch = { 'Variety': variety, 'Imported From': sourceTag };
    Object.keys(headerMap).forEach(ourH => {
      if (ourH === 'Variety') return;
      const v = srcRow[headerMap[ourH]];
      // Skip empty / null / non-primitive values. CellImage objects from
      // "Insert Image in Cell" come through as objects and aren't writable
      // via setValues — they need separate handling (see below).
      if (v === '' || v == null) return;
      const t = typeof v;
      if (t !== 'string' && t !== 'number' && t !== 'boolean' && !(v instanceof Date)) return;
      patch[ourH] = v;
    });
    // Photos: in the source sheet they're cell-anchored uploads (CellImage
    // objects). We can't trivially turn those into public URLs, so we
    // record a marker note and leave Photo URL blank for the photo-sync
    // pass to populate.
    const photo = srcRow[headerMap['Photo URL']] || srcRow['Photo'];
    if (photo && typeof photo === 'object') {
      patch['Notes'] = ((patch['Notes'] || '') + ' [photo in source sheet]').trim();
    }
    // If source row has IMAGE() formulas, prefer those URLs.
    const imgs = foreign.photoFormulas[idx];
    if (imgs) {
      const firstUrl = Object.keys(imgs).map(k => imgs[k]).find(u => u);
      if (firstUrl && !patch['Photo URL']) patch['Photo URL'] = firstUrl;
    }
    patches.push(patch);
  });

  const result = upsertRows_('Varieties', 'Variety', patches);
  return Object.assign(result, {
    sourceColumns: foreign.headers,
    headerMap,
    sample: patches.slice(0, 3)
  });
}

/**
 * Ensure each variety name is present in the `Varieties` master, then
 * write the list as the contents of `<year> Seedlings`. Modes:
 *   - merge (default): existing seedling rows preserved; new varieties appended.
 *   - replace: wipes the year-tab data rows and writes fresh.
 *
 * Idempotent in merge mode.
 */
function seedYearFromList_(year, varietyNames, mode) {
  const ss = getSheet_();
  const seedTab = String(year) + ' Seedlings';
  const sheet = ss.getSheetByName(seedTab);
  if (!sheet) throw withCode_('NOT_FOUND', "tab '" + seedTab + "' missing — run setupAllSheetsAction first");

  // Ensure every name exists in master.
  const masterPatches = (varietyNames || [])
    .map(n => String(n || '').trim())
    .filter(Boolean)
    .map(n => ({ 'Variety': n }));
  const masterResult = upsertRows_('Varieties', 'Variety', masterPatches);

  if (mode === 'replace' && sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).clearContent();
  }

  // Existing seedling tab keys.
  const existingNames = new Set();
  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues()
      .forEach(r => { const v = String(r[0] || '').trim().toLowerCase(); if (v) existingNames.add(v); });
  }

  const toAdd = [];
  (varietyNames || []).forEach(n => {
    const name = String(n || '').trim();
    if (!name) return;
    if (existingNames.has(name.toLowerCase())) return;
    toAdd.push({ 'Variety': name });
    existingNames.add(name.toLowerCase());
  });

  const seedResult = addRows_(seedTab, toAdd);
  return {
    masterUpsert: masterResult,
    seedlingAdded: seedResult.rowsAdded,
    yearTab: seedTab
  };
}

// ============================================================
// WRITES
// ============================================================

function appendHarvest_(payload, identity) {
  if (!payload || !payload.harvester) throw withCode_('BAD_REQUEST', 'missing harvester');
  const entries = (payload.entries || []).filter(e => e && e.variety && Number(e.quantity) > 0);
  if (!entries.length) throw withCode_('BAD_REQUEST', 'no valid entries');

  const sheet = getSheet_().getSheetByName('Harvest Data');
  if (!sheet) throw withCode_('SERVER_MISCONFIGURED', 'Harvest Data tab missing');

  const tz = Session.getScriptTimeZone();
  const now = new Date();
  const date = Utilities.formatDate(now, tz, 'yyyy-MM-dd');
  const time = Utilities.formatDate(now, tz, 'HH:mm:ss');

  const rows = entries.map(e => [date, time, payload.harvester, e.variety, Number(e.quantity)]);
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 5).setValues(rows);

  return { rowsAdded: rows.length };
}

/**
 * Atomic claim submit. Inside a script lock, re-read available counts; if
 * any requested quantity exceeds availability, throw STOCK_CHANGED with
 * current counts and append nothing. Otherwise append claim rows and
 * decrement the Available cells.
 */
function appendClaimAtomic_(payload, identity) {
  if (!payload || !payload.name) throw withCode_('BAD_REQUEST', 'missing name');
  const entries = (payload.entries || []).filter(e => e && e.variety && Number(e.quantity) > 0);
  if (!entries.length) throw withCode_('BAD_REQUEST', 'no valid entries');

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) throw withCode_('LOCK_TIMEOUT', 'could not acquire script lock');
  try {
    const ss = getSheet_();
    const seedlings = ss.getSheetByName('2026 Seedlings');
    const claims = ss.getSheetByName('Seedling Claims');
    if (!seedlings || !claims) throw withCode_('SERVER_MISCONFIGURED', 'required tab missing');

    const lastRow = seedlings.getLastRow();
    const lastCol = seedlings.getLastColumn();
    const values = seedlings.getRange(1, 1, lastRow, lastCol).getValues();
    const headers = values[0];
    const varietyCol = headers.indexOf('Variety');
    const availCol   = headers.indexOf('Available');
    if (varietyCol < 0 || availCol < 0) throw withCode_('SERVER_MISCONFIGURED', 'sheet headers missing Variety/Available');

    // Build a map of variety → {row, available}
    const map = {};
    for (let r = 1; r < values.length; r++) {
      const v = values[r][varietyCol];
      if (!v) continue;
      map[v] = { rowNum: r + 1, available: Number(values[r][availCol]) || 0 };
    }

    // Validate every requested entry against the live counts.
    const conflicts = {};
    entries.forEach(e => {
      const m = map[e.variety];
      const avail = m ? m.available : 0;
      if (Number(e.quantity) > avail) conflicts[e.variety] = avail;
    });
    if (Object.keys(conflicts).length) {
      throw Object.assign(new Error('stock changed'), {
        code: 'STOCK_CHANGED',
        current: conflicts
      });
    }

    // Append claim rows and decrement Available.
    const tz = Session.getScriptTimeZone();
    const ts = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm:ss');
    const tokenHash = hashIdentity_(identity);
    const notes = String(payload.notes || '').slice(0, 500);

    const claimRows = entries.map(e => [
      ts, payload.name, e.variety, Number(e.quantity), notes, tokenHash
    ]);
    claims.getRange(claims.getLastRow() + 1, 1, claimRows.length, 6).setValues(claimRows);

    entries.forEach(e => {
      const m = map[e.variety];
      const newAvail = m.available - Number(e.quantity);
      seedlings.getRange(m.rowNum, availCol + 1).setValue(newAvail);
      m.available = newAvail;  // keep map current within this batch
    });

    return { claimId: ts + ':' + payload.name, rowsAdded: claimRows.length };
  } finally {
    lock.releaseLock();
  }
}

function hashIdentity_(identity) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, identity)
    .map(b => (b < 0 ? b + 256 : b).toString(16).padStart(2, '0'))
    .join('').slice(0, 16);
}

// ============================================================
// HELPERS
// ============================================================

function ok_(result) {
  return ContentService
    .createTextOutput(JSON.stringify({ ok: true, result }))
    .setMimeType(ContentService.MimeType.JSON);
}

function fail_(code, message) {
  return ContentService
    .createTextOutput(JSON.stringify({ ok: false, code, error: message }))
    .setMimeType(ContentService.MimeType.JSON);
}

function withCode_(code, message) {
  return Object.assign(new Error(message), { code });
}
