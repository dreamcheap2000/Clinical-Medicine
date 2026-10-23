/**
 * Fixed-target, layout-only manual operation. No setup, form discovery, triggers,
 * Drive access or runtime configuration changes belong in this entrypoint.
 * Reports describe metadata observations separately from completed operations;
 * a failed migration may have made writes and is never rolled back.
 */
function phcepManualLayoutMigration(request) {
  var result = { status: 'blocked', blocker: null, before: null, after: null, changes: null };
  var target = '12ksl5GvgM_YVc1NjrPE9LRe_YvUgqttLl0R41z5dazo';
  var ss = null;
  var authorized = false;
  var lock = null;
  var held = false;
  var started = false;
  var completed = false;
  var failure = 'READ_FAILED';
  try {
    if (!request || typeof request !== 'object' || Array.isArray(request) ||
        Object.keys(request).sort().join(',') !== 'apply,targetSpreadsheetId' ||
        typeof request.apply !== 'boolean' || typeof request.targetSpreadsheetId !== 'string') {
      result.blocker = 'INVALID_REQUEST';
      return result;
    }
    if (request.targetSpreadsheetId !== target) {
      result.blocker = 'TARGET_MISMATCH';
      return result;
    }
    if (phcepManualProperty_('SPREADSHEET_ID') !== target) {
      result.blocker = 'CONFIGURATION_MISMATCH';
      return result;
    }
    failure = 'UNAUTHORIZED';
    var trusted = phcepManualTrustedEditors_();
    var email = Session.getEffectiveUser().getEmail().toLowerCase();
    if (!email) {
      result.blocker = 'UNAUTHORIZED';
      return result;
    }
    ss = SpreadsheetApp.openById(target);
    var owner = ss.getOwner();
    if (trusted.indexOf(email) === -1 && (!owner || owner.getEmail().toLowerCase() !== email)) {
      result.blocker = 'UNAUTHORIZED';
      return result;
    }
    authorized = true;
    if (request.apply) {
      failure = 'LOCK_UNAVAILABLE';
      lock = LockService.getScriptLock();
      held = lock.tryLock(30000);
      if (!held) {
        result.blocker = 'LOCK_UNAVAILABLE';
        return result;
      }
      if (phcepManualProperty_('SPREADSHEET_ID') !== target) {
        result.blocker = 'CONFIGURATION_MISMATCH';
        return result;
      }
    }
    failure = 'READ_FAILED';
    result.before = phcepManualInventory_(ss);
    result.blocker = phcepManualPreflight_(ss);
    if (result.blocker) {
      result.after = phcepManualInventory_(ss);
      result.changes = phcepManualChanges_(result.before, result.after, false, false);
      return result;
    }
    if (request.apply) {
      failure = 'MIGRATION_FAILED';
      started = true;
      phcepMigrateLayout_(ss, trusted);
      completed = true;
    }
    failure = 'READ_FAILED';
    result.after = phcepManualInventory_(ss);
    result.changes = phcepManualChanges_(result.before, result.after, started, completed);
    result.status = 'ok';
    return result;
  } catch (ignored) {
    result.status = failure === 'UNAUTHORIZED' || failure === 'LOCK_UNAVAILABLE' ? 'blocked' : 'failed';
    result.blocker = failure;
    // A fresh read is useful even when the helper stopped after its first write.
    if (authorized && ss) {
      try { result.after = phcepManualInventory_(ss); } catch (unreadable) { result.after = null; }
      result.changes = phcepManualChanges_(result.before, result.after, started, completed);
    }
    return result;
  } finally {
    if (held) {
      try { lock.releaseLock(); } catch (ignoredRelease) {
        result.status = 'failed';
        result.blocker = 'LOCK_UNAVAILABLE';
      }
    }
  }
}

// Preview deliberately depends only on this file and read-only service APIs.
// Keep these fixed schemas in sync with Setup.gs/Workflow.gs; tests enforce it.
function phcepManualSchemas_() {
  return {
    'LINE對話': ['Message ID', '發送問卷 (勾選)', 'User ID', 'DateTime', 'User Name', '訊息 (病患問題)', '檔案/媒體連結', '建議回覆選單', '回覆草稿 (可編輯)', '回覆紀錄 (最新)', 'Event Key', '操作狀態'],
    'QA知識庫': ['ID', '重要性分級 (1-5)', '訊息', 'Line Friend 連結備註', '回覆', '連結備註', '問題 Embedding', '回覆 Embedding', '備註 Embedding', '行內使用次數', '全域使用次數'],
    'PHCEP事件': ['Event Key', 'Status', 'Message ID', 'Updated At'],
    'PHCEP請求': ['Nonce Hash', 'Expires At'],
    'PHCEP寄件匣': ['Key', 'Retry Key', 'Status', 'Recipient', 'Messages JSON', 'Updated At', 'Error', 'Created At'],
    'PHCEP邀請': ['Nonce', 'LINE ID', 'Source Type', 'Form ID', 'Expires At', 'Used Response ID'],
    'PHCEP表單紀錄': ['Response ID', 'Correlation Nonce', 'Source Type', 'Timestamp', 'LINE ID', 'Answers JSON'],
    'PHCEP隔離': ['Response ID', 'Form ID', 'Timestamp', 'Reason'],
    'PHCEP回覆歷史': ['Operation ID', 'Event Key', 'Timestamp', 'Draft'],
    'PHCEP臨床評分': ['Response ID', '記憶力', '定向感', '判斷與解決問題', '社區事務', '家庭與嗜好', '個人照料', 'CDR（人工）'],
    '收錄集合': ['Collection Key', '狀態', '問題 (病患訊息)', '回覆', '來源', '已發送', '重要性 (1-5，選填)', 'Event Key', 'Message ID', '列參考', '收錄時間', '收錄者', '審核備註', 'QA ID']
  };
}

function phcepManualLineHeaders_() {
  return ['操作動作', '確認執行 (勾選)', '收錄來源', '重要性 (1-5，選填)',
    '收錄 (勾選)', '媒體檔名 (修改即改名)', '操作結果',
    '回覆紀錄 (前1)', '回覆紀錄 (前2)', '回覆紀錄 (前3)', '回覆紀錄 (前4)', '回覆紀錄 (前5)'];
}

function phcepManualQAHeaders_(headers) {
  var compact = phcepManualSchemas_()['QA知識庫'];
  var legacy = compact.slice(0, 3).concat(['LINE Friend 訊息 1', 'LINE Friend 訊息 2'],
    compact.slice(3, 5), ['檔案/媒體連結', '檔案/網址名稱'], compact.slice(5));
  return legacy.every(function(header, i) { return headers[i] === header; }) ? legacy : compact;
}

function phcepManualProperty_(key) {
  return PropertiesService.getScriptProperties().getProperty(key) || '';
}

function phcepManualTrustedEditors_() {
  var emails = phcepManualProperty_('TRUSTED_EDITOR_EMAILS').split(',')
    .map(function(email) { return email.trim().toLowerCase(); }).filter(Boolean);
  if (!emails.length || emails.some(function(email) { return !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email); })) {
    throw new Error('UNAUTHORIZED');
  }
  return emails;
}

function phcepManualNames_() {
  return Object.keys(phcepManualSchemas_()).concat(['總覽']);
}

function phcepManualLineLayout_(sheet) {
  var block = phcepManualLineHeaders_();
  var headers = sheet.getRange(1, 1, 1, sheet.getMaxColumns()).getValues()[0];
  var start = headers.indexOf(block[0]) + 1;
  if (start < 13 || !block.every(function(header, i) { return headers[start - 1 + i] === header; })) {
    return null;
  }
  return { start: start, historyStart: start + 7 };
}

function phcepManualFormInventory_(type) {
  var id = phcepManualProperty_(type + '_FORM_ID');
  var inventory = { configured: !!id, observable: false, items: null };
  if (!id) return inventory;
  try {
    inventory.items = FormApp.openById(id).getItems().length;
    inventory.observable = true;
  } catch (unreadableForm) {
    // Inaccessible configured forms are unknown, never zero, and never modified.
  }
  return inventory;
}

function phcepManualInventory_(ss) {
  var names = phcepManualNames_();
  var schemas = phcepManualSchemas_();
  var all = ss.getSheets();
  var sheets = names.map(function(name) {
    var sheet = ss.getSheetByName(name);
    if (!sheet) return { name: name, present: false, index: null, rows: null,
      columns: null, frozenRows: null, protectionCount: null, matchingHeaders: null };
    var expected = schemas[name] || ['PHCEP 總覽'];
    var width = sheet.getMaxColumns();
    var headers = sheet.getRange(1, 1, 1, width).getValues()[0];
    if (name === 'QA知識庫') expected = phcepManualQAHeaders_(headers);
    return { name: name, present: true, index: sheet.getIndex(), rows: sheet.getLastRow(),
      columns: sheet.getMaxColumns(), frozenRows: sheet.getFrozenRows(),
      protectionCount: sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET).length,
      matchingHeaders: expected.filter(function(header, i) { return headers[i] === header; }).length };
  });
  var line = ss.getSheetByName('LINE對話');
  var layout = line ? phcepManualLineLayout_(line) : null;
  return {
    totalSheets: all.length,
    otherSheets: all.filter(function(sheet) { return names.indexOf(sheet.getName()) === -1; }).length,
    legacyLinePresent: !!ss.getSheetByName('工作表1'),
    sheets: sheets,
    forms: {
      CDR: phcepManualFormInventory_('CDR'),
      VITALS: phcepManualFormInventory_('VITALS')
    },
    line: {
      controlStartColumn: layout ? layout.start : null,
      historyStartColumn: layout ? layout.historyStart : null,
      hiddenK: line && line.getMaxColumns() >= 11 ? line.isColumnHiddenByUser(11) : null,
      hiddenL: line && line.getMaxColumns() >= 12 ? line.isColumnHiddenByUser(12) : null
    }
  };
}

/** Validate every sheet before phcepMigrateLayout_ can touch the first one. */
function phcepManualPreflight_(ss) {
  var overview = ss.getSheetByName('總覽');
  if (overview) {
    var title = overview.getRange(1, 1).getValue();
    if ((title !== '' && title !== 'PHCEP 總覽') || (title === '' && overview.getLastRow() > 0)) {
      return 'UNMANAGED_OVERVIEW';
    }
  }
  var schemas = phcepManualSchemas_();
  var names = Object.keys(schemas);
  for (var n = 0; n < names.length; n++) {
    var name = names[n];
    var sheet = ss.getSheetByName(name);
    if (!sheet && name === 'LINE對話') sheet = ss.getSheetByName('工作表1');
    if (!sheet) continue;
    // A response tab must never be repurposed, even if its headers look familiar.
    if (sheet.getFormUrl()) return 'SCHEMA_CONFLICT';
    var expected = schemas[name];
    var headers = sheet.getRange(1, 1, 1, sheet.getMaxColumns()).getValues()[0];
    if (name === 'QA知識庫') expected = phcepManualQAHeaders_(headers);
    var headerFormulas = sheet.getRange(1, 1, 1, sheet.getMaxColumns()).getFormulas()[0];
    for (var h = 0; h < headers.length; h++) {
      if (headerFormulas[h] !== '') return 'SCHEMA_CONFLICT';
      if (headers[h] !== '' && headers.slice(0, h).some(function(header) {
        return String(header) === String(headers[h]);
      })) {
        return name === 'LINE對話' &&
          phcepManualLineHeaders_().indexOf(headers[h]) !== -1 ?
          'UNSUPPORTED_LINE_LAYOUT' : 'SCHEMA_CONFLICT';
      }
    }
    var matched = 0;
    for (var i = 0; i < expected.length; i++) {
      var value = i < headers.length ? headers[i] : '';
      if (value !== '' && value !== expected[i]) return 'SCHEMA_CONFLICT';
      if (value === expected[i]) matched++;
      for (var j = 0; j < headers.length; j++) {
        if (headers[j] === expected[i] && j !== i) return 'SCHEMA_CONFLICT';
      }
      if (value === '' && i < headers.length && phcepManualColumnHasData_(sheet, i + 1)) {
        return 'SCHEMA_CONFLICT';
      }
    }
    if ((matched > 0 && matched < expected.length) || (matched === 0 && sheet.getLastRow() > 1)) {
      return 'SCHEMA_CONFLICT';
    }
    if (name === 'LINE對話') {
      var block = phcepManualLineHeaders_();
      var found = headers.some(function(header) { return block.indexOf(header) !== -1; });
      if (found) {
        for (var b = 0; b < block.length; b++) {
          if (headers[12 + b] !== block[b]) return 'UNSUPPORTED_LINE_LAYOUT';
          for (var c = 0; c < headers.length; c++) {
            if (headers[c] === block[b] && c !== 12 + b) return 'UNSUPPORTED_LINE_LAYOUT';
          }
        }
      } else {
        for (var col = 13; col <= Math.min(headers.length, 12 + block.length); col++) {
          if (headers[col - 1] === '' && phcepManualColumnHasData_(sheet, col)) return 'SCHEMA_CONFLICT';
        }
      }
    }
  }
  if (overview && overview.getFormUrl()) return 'UNMANAGED_OVERVIEW';
  return null;
}

function phcepManualColumnHasData_(sheet, column) {
  if (sheet.getLastRow() < 2) return false;
  var range = sheet.getRange(2, column, sheet.getLastRow() - 1, 1);
  return range.getValues().some(function(row) { return row[0] !== ''; }) ||
    range.getFormulas().some(function(row) { return row[0] !== ''; });
}

function phcepManualChanges_(before, after, started, completed) {
  var observed = before && after ? before.sheets.filter(function(sheet, i) {
    return JSON.stringify(sheet) !== JSON.stringify(after.sheets[i]) ||
      (sheet.name === 'LINE對話' && JSON.stringify(before.line) !== JSON.stringify(after.line));
  }).map(function(sheet) { return sheet.name; }) : null;
  return {
    metadataChangedSheets: observed,
    metadataChangedSheetCount: observed ? observed.length : null,
    contentChangedSheetCount: null,
    operations: {
      state: completed ? 'completed' : started ? 'partial' : 'not_started',
      schemaProtectionFormattingSheets: completed ? phcepManualNames_() : started ? null : [],
      validationSheets: completed ? ['LINE對話', 'QA知識庫', '收錄集合'] : started ? null : [],
      overviewRefreshed: completed ? true : started ? null : false,
      sheetOrderEnsured: completed ? true : started ? null : false
    }
  };
}
