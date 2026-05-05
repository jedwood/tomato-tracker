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
const CODE_VERSION = 'v2-safe-setup-2026-05-05';

const ACTIONS = {
  ping: (identity) => ({ user: identity, ts: new Date().toISOString(), version: CODE_VERSION }),

  listVarieties: () => readVarieties_(),

  // Returns a slim `{[variety]: available}` map. Only varieties with
  // available > 1 are included; the claim form filters its own UI off
  // this anyway, but we filter server-side too so a leaked CLAIMS token
  // can't enumerate sold-out varieties.
  getInventory: () => {
    const rows = readVarieties_();
    const out = {};
    rows.forEach(r => {
      const a = Number(r['Available']) || 0;
      if (a > 1) out[r['Variety']] = a;
    });
    return out;
  },

  submitHarvest: (identity, payload) => appendHarvest_(payload, identity),

  submitClaim: (identity, payload) => appendClaimAtomic_(payload, identity),

  // Admin-only.
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
// READS
// ============================================================

function readVarieties_() {
  const sheet = getSheet_().getSheetByName('2026 Seedlings');
  if (!sheet) throw withCode_('SERVER_MISCONFIGURED', '2026 Seedlings tab missing');
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const lastCol = sheet.getLastColumn();
  const values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  const headers = values[0];
  return values.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = row[i]; });
    return obj;
  });
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
