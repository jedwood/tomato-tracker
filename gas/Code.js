/**
 * Tomato Tracker — Schema & Migrations
 *
 * Standalone Apps Script. Targets the live Tomato Tracker spreadsheet via
 * SpreadsheetApp.openById(SHEET_ID); the script's own bound spreadsheet
 * (created accidentally by `clasp create --type sheets`) is unused and
 * should be trashed in Drive.
 *
 * Pattern ported from .claude/agents/sam-bot/scripts/ward-sheets/Code.js.
 * All sheet writes go through the api.gs doPost surface — this file is
 * schema + migrations only.
 *
 * Run setupAllSheets() ONCE to bootstrap missing tabs. After that, use
 * addMissingColumns() for any non-destructive additions.
 */

// ============================================================
// CONFIG
// ============================================================

const SHEET_ID = '1Fukctm2sh8TekisGromdCbFpKYeGzOVq1aIyG8NbdZE';

const TABLES = {
  // Pre-existing tab — declared here so addMissingColumns() is a no-op.
  // setupAllSheets() will recreate headers if the tab is empty; if it has
  // data, the destructive call needs operator confirmation anyway.
  'Harvest Data': {
    headers: ['Date', 'Time', 'Harvester', 'Tomato Variety', 'Quantity'],
    colWidths: {
      'Date': 110, 'Time': 90, 'Harvester': 100,
      'Tomato Variety': 200, 'Quantity': 80
    }
  },

  // Year-current source of truth for available seedlings + variety metadata.
  // Year rollover next season: copySeedlingsToNewYear(2026, 2027) duplicates
  // this tab and clears Available.
  '2026 Seedlings': {
    headers: [
      'Variety', 'Available', 'Photo URL', 'Photo Slug', 'Description',
      'Days to Maturity', 'Color', 'Type', 'Source', 'Notes'
    ],
    colWidths: {
      'Variety': 200, 'Available': 90, 'Photo URL': 280, 'Photo Slug': 160,
      'Description': 360, 'Days to Maturity': 130, 'Color': 110,
      'Type': 110, 'Source': 160, 'Notes': 320
    },
    validations: {
      'Type': ['Cherry', 'Plum', 'Slicing', 'Beefsteak', 'Paste', 'Other']
    }
  },

  // Append-only log of who took which seedlings. Written by submitClaim
  // (see api.gs) under a script lock so simultaneous claims for the last
  // unit can't both succeed.
  'Seedling Claims': {
    headers: [
      'Timestamp', 'Name', 'Variety', 'Quantity', 'Notes', 'User Token Hash'
    ],
    colWidths: {
      'Timestamp': 160, 'Name': 160, 'Variety': 200, 'Quantity': 90,
      'Notes': 320, 'User Token Hash': 200
    },
    hiddenColumns: ['User Token Hash']
  }

  // Note: 'Dashboard' tab is intentionally NOT declared. It exists in the
  // sheet with a broken chart and will be rebuilt as a separate task.
};

function getSheet_() {
  return SpreadsheetApp.openById(SHEET_ID);
}

// ============================================================
// BOOTSTRAP — run once
// ============================================================

/**
 * DESTRUCTIVE. Wipes every declared tab and re-writes headers + formatting.
 * Dialog-guarded. First-time setup only — for column additions on a
 * populated sheet, use addMissingColumns() below.
 */
/**
 * UI-driven destructive setup. Asks for confirmation, then resets every
 * declared tab. Use this when running from the Apps Script editor with the
 * spreadsheet open. For first-time setup from the API path, use
 * setupAllSheetsHeadless (no underscore — appears in editor dropdown too).
 */
function setupAllSheetsWithPrompt() {
  let ui = null;
  try { ui = SpreadsheetApp.getUi(); } catch (e) { ui = null; }
  if (ui) {
    const resp = ui.alert(
      'DESTRUCTIVE: wipe declared tabs?',
      'setupAllSheets() will clear ' + Object.keys(TABLES).join(', ') +
        ' and re-write headers. Row data on those tabs will be lost. ' +
        'Use addMissingColumns() instead if you only need to add columns.',
      ui.ButtonSet.YES_NO
    );
    if (resp !== ui.Button.YES) { Logger.log('aborted'); return; }
  }
  const result = setupAllSheetsHeadless();
  Logger.log('setupAllSheets done.');
  if (ui) {
    try { ui.alert('Tomato Tracker tabs ready:\n' + result.tabs.join('\n')); } catch (e) {}
  }
  return result;
}

/**
 * No-UI variant — safe first-time setup. Only creates tabs that don't exist
 * yet, and only writes headers if the tab is empty (last row 0). Existing
 * tabs with data are left ENTIRELY ALONE. Use addMissingColumns() to
 * additively migrate columns, and setupAllSheetsWithPrompt() (UI dialog) for
 * the rare destructive reset.
 *
 * This is the function the doPost setupAllSheetsAction calls — by design it
 * cannot wipe live data even if the caller has a valid DEV token.
 */
function setupAllSheetsHeadless() {
  const ss = getSheet_();
  const log = [];
  Object.keys(TABLES).forEach(name => {
    let sheet = ss.getSheetByName(name);
    if (!sheet) {
      sheet = ss.insertSheet(name);
      setupSheet_(sheet, TABLES[name]);
      log.push('create ' + name);
      return;
    }
    if (sheet.getLastRow() === 0) {
      // Empty tab — safe to write headers + formatting.
      setupSheet_(sheet, TABLES[name]);
      log.push('init   ' + name);
      return;
    }
    // Tab exists with data — leave alone. Caller can run addMissingColumns()
    // for additive schema work, or setupAllSheetsWithPrompt() (UI-gated)
    // for the destructive reset.
    log.push('keep   ' + name);
  });
  Logger.log('Tabs: ' + log.join(', '));
  return { tabs: log };
}

/**
 * Non-destructive. For each table in TABLES, append any headers from the
 * config that aren't already on the live sheet. Preserves all existing
 * data; never reorders or deletes columns.
 */
function addMissingColumns() {
  const ss = getSheet_();
  const log = [];
  Object.keys(TABLES).forEach(name => {
    const sheet = ss.getSheetByName(name);
    if (!sheet) { log.push('skip ' + name + ' (tab missing)'); return; }
    const cfg = TABLES[name];
    const wanted = cfg.headers;
    const lastCol = sheet.getLastColumn();
    const existing = lastCol > 0
      ? sheet.getRange(1, 1, 1, lastCol).getValues()[0]
      : [];
    const missing = wanted.filter(h => !existing.includes(h));
    if (!missing.length) { log.push('ok   ' + name); return; }
    let nextCol = Math.max(lastCol, existing.length) + 1;
    missing.forEach(h => {
      const cell = sheet.getRange(1, nextCol);
      cell.setValue(h);
      cell.setFontWeight('bold').setBackground('#4CAF50').setFontColor('#FFFFFF').setFontSize(10);
      if (cfg.colWidths && cfg.colWidths[h]) sheet.setColumnWidth(nextCol, cfg.colWidths[h]);
      if (h.toLowerCase().includes('date') || h === 'Timestamp') {
        sheet.getRange(2, nextCol, Math.max(1, sheet.getMaxRows() - 1)).setNumberFormat('yyyy-mm-dd');
      }
      if (cfg.validations && cfg.validations[h]) {
        const rule = SpreadsheetApp.newDataValidation()
          .requireValueInList(cfg.validations[h], true)
          .setAllowInvalid(true)
          .build();
        sheet.getRange(2, nextCol, Math.max(1, sheet.getMaxRows() - 1)).setDataValidation(rule);
      }
      if ((cfg.hiddenColumns || []).includes(h)) sheet.hideColumns(nextCol);
      nextCol++;
    });
    log.push('add  ' + name + ': ' + missing.join(', '));
  });
  const summary = log.join('\n');
  Logger.log(summary);
  try { SpreadsheetApp.getUi().alert('addMissingColumns done:\n\n' + summary); } catch (e) {}
}

function setupSheet_(sheet, config) {
  const headers = config.headers;
  const numCols = headers.length;

  // Tear down prior state so setupAllSheets() is idempotent.
  sheet.clearConditionalFormatRules();
  sheet.getBandings().forEach(b => b.remove());
  sheet.clear();

  const headerRange = sheet.getRange(1, 1, 1, numCols);
  headerRange.setValues([headers]);
  headerRange.setFontWeight('bold').setBackground('#4CAF50').setFontColor('#FFFFFF').setFontSize(10);
  sheet.setFrozenRows(1);

  if (config.colWidths) {
    headers.forEach((h, i) => {
      if (config.colWidths[h]) sheet.setColumnWidth(i + 1, config.colWidths[h]);
    });
  }

  // Date / timestamp formatting
  headers.forEach((h, i) => {
    const lower = h.toLowerCase();
    if (lower.includes('date') || h === 'Timestamp') {
      sheet.getRange(2, i + 1, 999).setNumberFormat('yyyy-mm-dd');
    }
    if (h === 'Time') {
      sheet.getRange(2, i + 1, 999).setNumberFormat('hh:mm:ss');
    }
  });

  if (config.validations) {
    Object.keys(config.validations).forEach(colName => {
      const colIdx = headers.indexOf(colName) + 1;
      if (colIdx > 0) {
        const rule = SpreadsheetApp.newDataValidation()
          .requireValueInList(config.validations[colName], true)
          .setAllowInvalid(false)
          .build();
        sheet.getRange(2, colIdx, 999).setDataValidation(rule);
      }
    });
  }

  sheet.getRange(2, 1, 999, numCols).applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY);

  if (config.hiddenColumns) {
    config.hiddenColumns.forEach(colName => {
      const colIdx = headers.indexOf(colName) + 1;
      if (colIdx > 0) sheet.hideColumns(colIdx);
    });
  }
}

// ============================================================
// YEAR ROLLOVER
// ============================================================

/**
 * Duplicates the seedlings tab for a new year, clearing Available counts.
 * Preserves variety rows + metadata so the new year starts pre-populated.
 *
 * Example: copySeedlingsToNewYear(2026, 2027)
 */
function copySeedlingsToNewYear(fromYear, toYear) {
  const ss = getSheet_();
  const fromName = fromYear + ' Seedlings';
  const toName = toYear + ' Seedlings';
  const src = ss.getSheetByName(fromName);
  if (!src) throw new Error('Source tab not found: ' + fromName);
  if (ss.getSheetByName(toName)) throw new Error('Target tab already exists: ' + toName);
  const copy = src.copyTo(ss);
  copy.setName(toName);

  // Find the Available column and zero it out (keep variety + metadata).
  const headers = copy.getRange(1, 1, 1, copy.getLastColumn()).getValues()[0];
  const availIdx = headers.indexOf('Available');
  if (availIdx >= 0 && copy.getLastRow() > 1) {
    const rows = copy.getLastRow() - 1;
    copy.getRange(2, availIdx + 1, rows, 1).clearContent();
  }
  ss.setActiveSheet(copy);
  ss.moveActiveSheet(2);  // Just after Harvest Data; tweak as desired.
  Logger.log('Created ' + toName + ' from ' + fromName);
  try { SpreadsheetApp.getUi().alert('Created ' + toName + '. Set Available counts and you\'re ready.'); } catch (e) {}
}
