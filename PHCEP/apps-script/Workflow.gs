/**
 * No-menu operator workflow: overview index, grouped LINE對話 controls,
 * collection review, safe media rename and idempotent layout migration.
 * Required operation uses the installed edit trigger only; menus are optional.
 */
var PHCEP_OVERVIEW_SHEET_ = '總覽';
var PHCEP_OVERVIEW_TITLE_ = 'PHCEP 總覽';
var PHCEP_OVERVIEW_ROWS_ = 30;
var PHCEP_COLLECTION_SHEET_ = '收錄集合';
var PHCEP_OVERVIEW_LINKS_ = ['LINE對話', 'QA知識庫', '收錄集合', 'PHCEP事件', 'PHCEP請求', 'PHCEP寄件匣',
  'PHCEP邀請', 'PHCEP表單紀錄', 'PHCEP隔離', 'PHCEP臨床評分', 'PHCEP回覆歷史'];
var PHCEP_LINE_CONTROL_HEADERS_ = ['操作動作', '確認執行 (勾選)', '收錄來源', '重要性 (1-5，選填)',
  '收錄 (勾選)', '媒體檔名 (修改即改名)', '操作結果'];
var PHCEP_LINE_CONTROL_FIELDS_ = ['action', 'confirm', 'source', 'importance', 'collect', 'mediaName', 'status'];
var PHCEP_LINE_HISTORY_HEADERS_ = ['回覆紀錄 (前1)', '回覆紀錄 (前2)', '回覆紀錄 (前3)', '回覆紀錄 (前4)', '回覆紀錄 (前5)'];
var PHCEP_ACTIONS_ = {
  SEND_DRAFT: '發送草稿', SEND_CDR: '發送 CDR 邀請', SEND_VITALS: '發送每日健康邀請',
  NEW_CDR: '建立新 CDR 邀請', NEW_VITALS: '建立新每日健康邀請', REFRESH: '重新整理建議', COLLECT: '收錄'
};
var PHCEP_COLLECTION_SOURCES_ = ['最新回覆', '病患訊息', '草稿 (未發送)', '歷史回覆 前1', '歷史回覆 前2',
  '歷史回覆 前3', '歷史回覆 前4', '歷史回覆 前5'];
var PHCEP_COLLECTION_STATUSES_ = ['待審核', '核准', '退回', '已發布'];
var PHCEP_IMPORTANCE_VALUES_ = ['1', '2', '3', '4', '5'];

function phcepActionValues_() {
  return Object.keys(PHCEP_ACTIONS_).map(function(key) { return PHCEP_ACTIONS_[key]; });
}

function phcepIsChecked_(value) {
  return value === true || value === 'TRUE';
}

function phcepPlainText_(value) {
  var text = String(value == null ? '' : value);
  return text.charAt(0) === "'" ? text.slice(1) : text;
}

/** Locate the contiguous operator block + history area by header; null for old layouts. */
function phcepLineLayout_(sheet) {
  var all = PHCEP_LINE_CONTROL_HEADERS_.concat(PHCEP_LINE_HISTORY_HEADERS_);
  var headers = sheet.getRange(1, 1, 1, sheet.getMaxColumns()).getValues()[0].map(function(value) { return String(value); });
  var start = headers.indexOf(all[0]) + 1;
  if (start < 13) return null;
  for (var i = 0; i < all.length; i++) {
    if (headers[start - 1 + i] !== all[i]) return null;
  }
  var layout = { start: start, end: start + all.length - 1, historyStart: start + PHCEP_LINE_CONTROL_HEADERS_.length };
  PHCEP_LINE_CONTROL_FIELDS_.forEach(function(field, index) { layout[field] = start + index; });
  return layout;
}

/**
 * Place the operator block directly after L (M onward) so editor columns stay
 * next to H/I/J. Any legacy content beyond L is shifted right by inserting
 * empty columns, never overwritten; A:L never move.
 */
function phcepEnsureLineExtension_(sheet) {
  var all = PHCEP_LINE_CONTROL_HEADERS_.concat(PHCEP_LINE_HISTORY_HEADERS_);
  var headers = sheet.getRange(1, 1, 1, sheet.getMaxColumns()).getValues()[0].map(function(value) { return String(value); });
  var start = headers.indexOf(all[0]) + 1;
  var created = false;
  if (!start) {
    if (all.some(function(header) { return headers.indexOf(header) !== -1; })) {
      throw new Error('LINE對話 operator block headers are incomplete or moved; restore them before migration.');
    }
    start = 13;
    created = true;
    if (sheet.getLastColumn() > 12 && sheet.getMaxColumns() > 12) sheet.insertColumnsAfter(12, all.length);
  }
  if (start < 13) throw new Error('LINE對話 operator block must follow Event Key (K) and 操作狀態 (L).');
  var needed = start + all.length - 1;
  if (sheet.getMaxColumns() < needed) sheet.insertColumnsAfter(sheet.getMaxColumns(), needed - sheet.getMaxColumns());
  var current = sheet.getRange(1, start, 1, all.length).getValues()[0];
  var lastRow = sheet.getLastRow();
  current.forEach(function(value, i) {
    if (value === all[i]) return;
    if (value !== '') throw new Error('Inconsistent schema: LINE對話, column ' + (start + i));
    if (lastRow > 1 && sheet.getRange(2, start + i, lastRow - 1, 1).getValues().some(function(row) { return row[0] !== ''; })) {
      throw new Error('Unlabelled data overlaps schema: LINE對話, column ' + (start + i));
    }
  });
  var added = 0;
  current.forEach(function(value, i) {
    if (value === '') { sheet.getRange(1, start + i).setValue(all[i]); added++; }
  });
  sheet.getRange(1, start, 1, all.length).setFontWeight('bold').setBackground('#e8f0fe');
  // System columns K (Event Key) and L (操作狀態) are hidden once so editor columns
  // read H, I, J, M…; they stay intact and can be unhidden at any time.
  if (created) sheet.hideColumns(11, 2);
  return { layout: phcepLineLayout_(sheet), added: added };
}

function phcepListValidation_(values) {
  return SpreadsheetApp.newDataValidation().requireValueInList(values, true).setAllowInvalid(false).build();
}

function phcepApplyColumnValidation_(sheet, column, rule, row) {
  if (sheet.getMaxRows() < 2) sheet.insertRowsAfter(1, 1);
  sheet.getRange(row || 2, column, row ? 1 : sheet.getMaxRows() - 1, 1).setDataValidation(rule);
}

function phcepApplyLineValidations_(sheet, layout, row) {
  var checkbox = SpreadsheetApp.newDataValidation().requireCheckbox().build();
  phcepApplyColumnValidation_(sheet, 2, checkbox, row);
  if (!layout) return;
  phcepApplyColumnValidation_(sheet, layout.action, phcepListValidation_(phcepActionValues_()), row);
  phcepApplyColumnValidation_(sheet, layout.confirm, checkbox, row);
  phcepApplyColumnValidation_(sheet, layout.source, phcepListValidation_(PHCEP_COLLECTION_SOURCES_), row);
  phcepApplyColumnValidation_(sheet, layout.importance, phcepListValidation_(PHCEP_IMPORTANCE_VALUES_), row);
  phcepApplyColumnValidation_(sheet, layout.collect, checkbox, row);
}

function phcepEnsureOverview_(ss) {
  var sheet = ss.getSheetByName(PHCEP_OVERVIEW_SHEET_);
  if (!sheet) sheet = ss.insertSheet(PHCEP_OVERVIEW_SHEET_);
  var title = sheet.getRange(1, 1).getValue();
  if ((title !== '' && title !== PHCEP_OVERVIEW_TITLE_) || (title === '' && sheet.getLastRow() > 0)) {
    throw new Error('Existing 總覽 sheet is not PHCEP-managed; rename it before migration.');
  }
  if (sheet.getMaxColumns() < 3) sheet.insertColumnsAfter(sheet.getMaxColumns(), 3 - sheet.getMaxColumns());
  if (sheet.getMaxRows() < PHCEP_OVERVIEW_ROWS_) sheet.insertRowsAfter(sheet.getMaxRows(), PHCEP_OVERVIEW_ROWS_ - sheet.getMaxRows());
  sheet.getRange(1, 1, 1, 3).setValues([[PHCEP_OVERVIEW_TITLE_, '重新整理 (勾選)', false]]);
  sheet.setFrozenRows(Math.max(1, sheet.getFrozenRows()));
  sheet.getRange(1, 1, 1, 3).setFontWeight('bold').setBackground('#e8f0fe');
  sheet.getRange(1, 3).setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build());
  return sheet;
}

/** 總覽 first, LINE對話 second, QA知識庫 third; other tabs keep their relative order. */
function phcepEnsureSheetOrder_(ss) {
  [PHCEP_OVERVIEW_SHEET_, 'LINE對話', 'QA知識庫'].forEach(function(name, i) {
    var sheet = ss.getSheetByName(name);
    if (sheet && sheet.getIndex() !== i + 1) {
      ss.setActiveSheet(sheet);
      ss.moveActiveSheet(i + 1);
    }
  });
}

function phcepCountRows_(sheet, column, predicate) {
  if (!sheet || sheet.getLastRow() < 2) return 0;
  return sheet.getRange(2, column, sheet.getLastRow() - 1, 1).getValues().filter(function(row) {
    return predicate(row[0]);
  }).length;
}

/** Counts and links only; never copies payloads, recipients, answers or secrets. */
function phcepRefreshOverview_(ss) {
  var sheet = ss.getSheetByName(PHCEP_OVERVIEW_SHEET_);
  if (!sheet) return null;
  var rows = [['最後更新', new Date(), ''], ['', '', ''], ['工作表 (點擊開啟)', '資料列數', '']];
  var links = [];
  PHCEP_OVERVIEW_LINKS_.forEach(function(name) {
    var target = ss.getSheetByName(name);
    if (target) links.push({ row: rows.length + 2, name: name, gid: target.getSheetId() });
    rows.push([target ? '' : name, target ? Math.max(0, target.getLastRow() - 1) : '未建立', '']);
  });
  var outbox = ss.getSheetByName('PHCEP寄件匣');
  var collections = ss.getSheetByName(PHCEP_COLLECTION_SHEET_);
  var counters = {
    pendingOutbox: phcepCountRows_(outbox, 3, function(value) { return value === 'PENDING' || value === 'FAILED'; }),
    manualReviewOutbox: phcepCountRows_(outbox, 3, function(value) { return value === 'AMBIGUOUS_EXPIRED'; }),
    quarantine: phcepCountRows_(ss.getSheetByName('PHCEP隔離'), 1, function(value) { return value !== ''; }),
    collectionPending: phcepCountRows_(collections, 2, function(value) { return value === '待審核'; }),
    collectionApproved: phcepCountRows_(collections, 2, function(value) { return value === '核准'; }),
    incompleteEvents: phcepCountRows_(ss.getSheetByName('PHCEP事件'), 2, function(value) { return value !== '' && value !== 'COMPLETE'; })
  };
  rows.push(['', '', '']);
  rows.push(['作業指標', '數量', '說明']);
  rows.push(['寄件匣待處理/失敗', counters.pendingOutbox, '於 LINE對話 L 欄查看狀態後重試']);
  rows.push(['寄件匣需人工確認', counters.manualReviewOutbox, 'AMBIGUOUS_EXPIRED：勿重設金鑰或盲目重送']);
  rows.push(['表單隔離紀錄', counters.quarantine, '臨床使用前請檢視 PHCEP隔離']);
  rows.push(['收錄待審核', counters.collectionPending, '收錄集合 B 欄改為「核准」才會發布']);
  rows.push(['收錄已核准未發布', counters.collectionApproved, '可重新選取「核准」或執行 publishApprovedCollections']);
  rows.push(['事件處理未完成', counters.incompleteEvents, '勿刪除 PHCEP事件 金鑰']);
  while (rows.length < PHCEP_OVERVIEW_ROWS_ - 1) rows.push(['', '', '']);
  sheet.getRange(2, 1, rows.length, 3).setValues(rows);
  links.forEach(function(link) {
    sheet.getRange(link.row, 1).setRichTextValue(SpreadsheetApp.newRichTextValue()
      .setText(link.name).setLinkUrl('#gid=' + link.gid).build());
  });
  return counters;
}

/** Idempotent, non-destructive layout migration shared by setup and operators. */
function phcepMigrateLayout_(ss, trusted) {
  var report = { addedSheets: [], lineColumnsAdded: 0 };
  if (!ss.getSheetByName('LINE對話') && ss.getSheetByName('工作表1')) {
    ss.getSheetByName('工作表1').setName('LINE對話');
  }
  Object.keys(PHCEP_SCHEMAS_).forEach(function(name) {
    if (!ss.getSheetByName(name)) report.addedSheets.push(name);
    var sheet = phcepEnsureSheet_(ss, name, PHCEP_SCHEMAS_[name]);
    phcepProtectSheet_(ss, sheet, trusted);
  });
  var line = ss.getSheetByName('LINE對話');
  var extension = phcepEnsureLineExtension_(line);
  report.lineColumnsAdded = extension.added;
  report.controlStartColumn = extension.layout.start;
  phcepApplyLineValidations_(line, extension.layout);
  var qa = ss.getSheetByName('QA知識庫');
  phcepApplyColumnValidation_(qa, 2, phcepListValidation_(PHCEP_IMPORTANCE_VALUES_));
  var collections = ss.getSheetByName(PHCEP_COLLECTION_SHEET_);
  phcepApplyColumnValidation_(collections, 2, phcepListValidation_(PHCEP_COLLECTION_STATUSES_));
  phcepApplyColumnValidation_(collections, 7, phcepListValidation_(PHCEP_IMPORTANCE_VALUES_));
  if (!ss.getSheetByName(PHCEP_OVERVIEW_SHEET_)) report.addedSheets.push(PHCEP_OVERVIEW_SHEET_);
  var overview = phcepEnsureOverview_(ss);
  phcepProtectSheet_(ss, overview, trusted);
  phcepEnsureSheetOrder_(ss);
  phcepRefreshOverview_(ss);
  return report;
}

function migratePHCEPLayout() {
  phcepAuthorizeClinician_();
  return phcepWithLock_(function() {
    var ss = phcepSpreadsheet_();
    var report = phcepMigrateLayout_(ss, phcepTrustedEditors_());
    phcepEnsureEditTrigger_(ss);
    report.editTrigger = 'ready';
    return report;
  });
}

function refreshPHCEPOverview() {
  phcepAuthorizeClinician_();
  return phcepWithLock_(function() { return phcepRefreshOverview_(phcepSpreadsheet_()); });
}

function phcepCollectionKey_(question, reply) {
  var normalize = function(value) {
    return phcepPlainText_(value).normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
  };
  return phcepDigest_(normalize(question) + '\n' + normalize(reply));
}

function phcepSetLineStatus_(sheet, row, layout, text) {
  sheet.getRange(row, layout.status).setValue(phcepLiteral_(text));
}

function phcepCollectRow_(ss, sheet, row, layout, collector) {
  var values = sheet.getRange(row, 1, 1, 12).getValues()[0];
  var question = phcepPlainText_(values[5]).trim();
  var source = String(sheet.getRange(row, layout.source).getValue() || '').trim() || '最新回覆';
  var reply;
  var sent;
  if (source === '最新回覆') { reply = values[9]; sent = '已發送'; }
  else if (source === '病患訊息') { reply = ''; sent = '無回覆'; }
  else if (source === '草稿 (未發送)') { reply = values[8]; sent = '未發送 (草稿)'; }
  else {
    var match = source.match(/^歷史回覆 前([1-5])$/);
    if (!match) return '❌ 收錄來源無效。';
    reply = sheet.getRange(row, layout.historyStart + Number(match[1]) - 1).getValue();
    sent = '已發送 (歷史)';
  }
  reply = phcepPlainText_(reply).trim();
  if (!question) return '⚠️ 此列沒有病患訊息，未收錄。';
  if (source !== '病患訊息' && !reply) return '⚠️ 所選來源「' + source + '」沒有回覆內容，未收錄。';
  var importance = phcepNormalizeImportance_(sheet.getRange(row, layout.importance).getValue());
  if (!importance.ok) return '❌ ' + importance.error + '未收錄。';
  var collections = ss.getSheetByName(PHCEP_COLLECTION_SHEET_);
  if (!collections) return '❌ 請先執行 setupPHCEP 或 migratePHCEPLayout 建立收錄集合。';
  var key = phcepCollectionKey_(question, reply);
  var keys = collections.getLastRow() > 1 ? collections.getRange(2, 1, collections.getLastRow() - 1, 1).getValues() : [];
  for (var i = 0; i < keys.length; i++) {
    if (String(keys[i][0]) === key) return 'ℹ️ 已存在於收錄集合第 ' + (i + 2) + ' 列，未重複收錄。';
  }
  collections.appendRow([key, '待審核', phcepLiteral_(question), phcepLiteral_(reply), source, sent,
    importance.value === null ? '' : importance.value, phcepLiteral_(values[10]), phcepLiteral_(values[0]),
    'LINE對話!' + row, new Date(), phcepLiteral_(collector || ''), '', '']);
  return '✅ 已收錄至收錄集合第 ' + collections.getLastRow() + ' 列（待審核，尚未發布到 QA 建議）' +
    (reply ? '。' : '；核准前請先於收錄集合 D 欄填寫回覆。');
}

/** Publish one approved collection row into QA知識庫 (idempotent by QA ID). */
function phcepPublishCollectionRow_(ss, sheet, row, editor) {
  var values = sheet.getRange(row, 1, 1, 14).getValues()[0];
  if (values[13]) {
    sheet.getRange(row, 2).setValue('已發布');
    return true;
  }
  var question = phcepPlainText_(values[2]).trim();
  var reply = phcepPlainText_(values[3]).trim();
  var importance = phcepNormalizeImportance_(values[6]);
  var problem = !question || !reply ? '需有問題與回覆才能發布。' : (!importance.ok ? importance.error : '');
  if (problem) {
    sheet.getRange(row, 2).setValue('待審核');
    sheet.getRange(row, 13).setValue(phcepLiteral_('未發布：' + problem));
    return false;
  }
  var qa = ss.getSheetByName('QA知識庫');
  if (!qa) throw new Error('Run setupPHCEP to provision QA知識庫.');
  var key = String(values[0] || phcepCollectionKey_(question, reply));
  var id = 'COL-' + key.slice(0, 24);
  var ids = qa.getLastRow() > 1 ? qa.getRange(2, 1, qa.getLastRow() - 1, 1).getValues() : [];
  if (!ids.some(function(value) { return String(value[0]) === id; })) {
    qa.appendRow([id, importance.value === null ? '' : importance.value, phcepLiteral_(question), '', '', '',
      phcepLiteral_(reply), '', '', '', '', '', '', 0, 0]);
  }
  sheet.getRange(row, 14).setValue(id);
  sheet.getRange(row, 2).setValue('已發布');
  sheet.getRange(row, 13).setValue(phcepLiteral_('已由 ' + editor + ' 核准並發布至 QA知識庫'));
  return true;
}

function publishApprovedCollections() {
  phcepAuthorizeClinician_();
  var editor = Session.getEffectiveUser().getEmail().toLowerCase();
  return phcepWithLock_(function() {
    var ss = phcepSpreadsheet_();
    var sheet = ss.getSheetByName(PHCEP_COLLECTION_SHEET_);
    var published = 0;
    var skipped = 0;
    if (sheet && sheet.getLastRow() > 1) {
      var statuses = sheet.getRange(2, 2, sheet.getLastRow() - 1, 1).getValues();
      statuses.forEach(function(value, i) {
        if (value[0] !== '核准') return;
        if (phcepPublishCollectionRow_(ss, sheet, i + 2, editor)) published++;
        else skipped++;
      });
    }
    phcepRefreshOverview_(ss);
    return { published: published, skipped: skipped };
  });
}

function phcepSanitizeFileName_(value) {
  return String(value == null ? '' : value).normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f\/\\:*?"<>|]/g, '').trim().slice(0, 120);
}

function phcepDriveFileId_(url) {
  var text = String(url || '');
  if (!/^https:\/\/(drive|docs)\.google\.com\//.test(text)) return '';
  var match = text.match(/\/d\/([A-Za-z0-9_-]{10,})/) || text.match(/[?&]id=([A-Za-z0-9_-]{10,})/);
  return match ? match[1] : '';
}

/** Rename only private files inside the configured media folder; links stay private. */
function phcepRenameMediaForRow_(sheet, row, newName) {
  var name = phcepSanitizeFileName_(newName);
  if (!name) return '❌ 檔名無效或為空，未改名。';
  var cell = sheet.getRange(row, 7);
  var rich = cell.getRichTextValue();
  var url = rich && rich.getLinkUrl ? rich.getLinkUrl() : '';
  var fileId = phcepDriveFileId_(url);
  if (!fileId) return '⚠️ 此列沒有系統管理的媒體檔案。';
  var folderId = phcepProperty_('IMAGE_FOLDER_ID', ['DRIVE_FOLDER_ID']);
  if (!folderId) return '❌ 未設定 IMAGE_FOLDER_ID。';
  var file;
  try {
    file = DriveApp.getFileById(fileId);
  } catch (error) {
    return '❌ 找不到檔案或無權限。';
  }
  var managed = false;
  var parents = file.getParents();
  while (parents.hasNext()) {
    if (parents.next().getId() === folderId) managed = true;
  }
  if (!managed) return '❌ 僅能改名私人媒體資料夾中的系統檔案。';
  if (file.getSharingAccess() !== DriveApp.Access.PRIVATE) return '❌ 檔案不是私人檔案，拒絕改名；請先檢查分享設定。';
  file.setName(name);
  cell.setRichTextValue(SpreadsheetApp.newRichTextValue().setText(name).setLinkUrl(url).build());
  return '✅ 已同步 Drive 檔名並更新連結標籤。';
}

function phcepEditorEmail_(e) {
  if (!e.user) throw new Error('Verified editor identity required.');
  phcepAuthorizeClinician_(e.user);
  return String(e.user.getEmail() || '').toLowerCase();
}

function phcepRowIdentity_(sheet, row) {
  var eventKey = String(sheet.getRange(row, 11).getValue() || '');
  return { column: eventKey ? 11 : 1, value: eventKey || String(sheet.getRange(row, 1).getValue() || ''),
    recipient: String(sheet.getRange(row, 3).getValue() || '').trim() };
}

function phcepRunSendAction_(sheet, row, action) {
  if (action === PHCEP_ACTIONS_.SEND_DRAFT) {
    if (!String(sheet.getRange(row, 9).getValue() || '').trim()) return '⚠️ I 欄草稿為空，未發送。';
    return phcepSendRow_(sheet, row, 'reply') ? '✅ 草稿已發送。' : '⚠️ 未完成：請查看 L 欄操作狀態。';
  }
  var type = action === PHCEP_ACTIONS_.SEND_VITALS || action === PHCEP_ACTIONS_.NEW_VITALS ? 'VITALS' : 'CDR';
  var created = action === PHCEP_ACTIONS_.NEW_CDR || action === PHCEP_ACTIONS_.NEW_VITALS;
  var ok = created ? phcepNewInvitationForRow_(sheet, row, type) : phcepSendRow_(sheet, row, 'questionnaire', type);
  return ok ? '✅ 已發送「' + action + '」。' : '⚠️ 未完成：請查看 L 欄操作狀態。';
}

/** Caller holds the script lock. Sending requires action selection then a separate confirm check. */
function phcepHandleLineControlEdit_(e, sheet, row, col, layout) {
  var field = PHCEP_LINE_CONTROL_FIELDS_[col - layout.start];
  var range = e.range;
  var value = range.getValue();
  var ss = sheet.getParent();
  if (field === 'source') {
    if (value && PHCEP_COLLECTION_SOURCES_.indexOf(String(value)) === -1) {
      range.clearContent();
      phcepSetLineStatus_(sheet, row, layout, '❌ 收錄來源無效，已清除。');
    } else {
      phcepSetLineStatus_(sheet, row, layout, 'ℹ️ 收錄來源：' + (value || '最新回覆') +
        '。可選填重要性，再勾選「收錄」；不會自動收錄或發送。');
    }
    return;
  }
  if (field === 'importance') {
    var importance = phcepNormalizeImportance_(value);
    if (!importance.ok) {
      range.clearContent();
      phcepSetLineStatus_(sheet, row, layout, '❌ ' + importance.error + '已清除。');
    } else {
      if (importance.value !== null && value !== importance.value) range.setValue(importance.value);
      phcepSetLineStatus_(sheet, row, layout, importance.value === null ? 'ℹ️ 重要性：未設定。' : 'ℹ️ 重要性：' + importance.value + '。');
    }
    return;
  }
  if (field === 'mediaName') {
    if (!String(value || '').trim()) return;
    try {
      phcepEditorEmail_(e);
      phcepSetLineStatus_(sheet, row, layout, phcepRenameMediaForRow_(sheet, row, value));
    } catch (error) {
      phcepSetLineStatus_(sheet, row, layout, '❌ 未改名：需可驗證的授權編輯者。');
    }
    return;
  }
  if (field === 'collect') {
    if (!phcepIsChecked_(value)) return;
    try {
      phcepSetLineStatus_(sheet, row, layout, phcepCollectRow_(ss, sheet, row, layout, phcepEditorEmail_(e)));
    } catch (error) {
      phcepSetLineStatus_(sheet, row, layout, '❌ 未收錄：需可驗證的授權編輯者，或處理時發生錯誤。');
    } finally {
      range.setValue(false);
    }
    return;
  }
  if (field === 'action') {
    var action = String(value || '').trim();
    if (!action) return;
    if (phcepActionValues_().indexOf(action) === -1) {
      range.clearContent();
      phcepSetLineStatus_(sheet, row, layout, '❌ 未知的操作動作。');
      return;
    }
    if (action === PHCEP_ACTIONS_.REFRESH || action === PHCEP_ACTIONS_.COLLECT) {
      try {
        var editor = phcepEditorEmail_(e);
        if (action === PHCEP_ACTIONS_.COLLECT) {
          phcepSetLineStatus_(sheet, row, layout, phcepCollectRow_(ss, sheet, row, layout, editor));
        } else {
          var count = phcepApplySuggestions_(ss, sheet, row, phcepPlainText_(sheet.getRange(row, 6).getValue())).length;
          phcepSetLineStatus_(sheet, row, layout, count ? '💡 已更新 ' + count + ' 筆建議（H 欄選單）。' : 'ℹ️ 無足夠相符的 QA 建議。');
        }
      } catch (error) {
        phcepSetLineStatus_(sheet, row, layout, '❌ 未執行：需可驗證的授權編輯者，或處理時發生錯誤。');
      } finally {
        range.clearContent();
      }
      return;
    }
    sheet.getRange(row, layout.confirm).setValue(false);
    phcepSetLineStatus_(sheet, row, layout, '⏸ 已選擇「' + action + '」：勾選「確認執行」後才會發送。');
    return;
  }
  if (field === 'confirm') {
    if (!phcepIsChecked_(value)) return;
    range.setValue(false);
    var selected = String(sheet.getRange(row, layout.action).getValue() || '').trim();
    var sending = [PHCEP_ACTIONS_.SEND_DRAFT, PHCEP_ACTIONS_.SEND_CDR, PHCEP_ACTIONS_.SEND_VITALS,
      PHCEP_ACTIONS_.NEW_CDR, PHCEP_ACTIONS_.NEW_VITALS];
    if (sending.indexOf(selected) === -1) {
      phcepSetLineStatus_(sheet, row, layout, '⚠️ 請先在「操作動作」選擇發送類動作，再勾選確認。');
      return;
    }
    var identity = phcepRowIdentity_(sheet, row);
    var status;
    try {
      phcepEditorEmail_(e);
      status = phcepRunSendAction_(sheet, row, selected);
    } catch (error) {
      status = '❌ 未發送：請確認身分、收件者或待處理狀態（見 L 欄）。';
    }
    var currentRow = row;
    try {
      currentRow = phcepLocateOperationRow_(sheet, identity);
    } catch (error) {
      // Fail closed: disarm the edited row and report that the row position changed.
      currentRow = row;
      status = '⚠️ 列位置已變動，請至 L 欄或 PHCEP寄件匣確認結果。' + status;
    }
    sheet.getRange(currentRow, layout.action).clearContent();
    phcepSetLineStatus_(sheet, currentRow, layout, status);
  }
}

function phcepHandleOverviewEdit_(e) {
  var range = e.range;
  if (range.getRow() !== 1 || range.getColumn() !== 3 || range.getNumRows() !== 1 || range.getNumColumns() !== 1) return;
  if (!phcepIsChecked_(range.getValue())) return;
  return phcepWithLock_(function() {
    phcepRefreshOverview_(phcepSpreadsheet_());
    range.setValue(false);
  });
}

function phcepHandleCollectionEdit_(e) {
  var range = e.range;
  if (range.getRow() < 2 || range.getNumRows() !== 1 || range.getNumColumns() !== 1) return;
  var sheet = range.getSheet();
  var row = range.getRow();
  var col = range.getColumn();
  return phcepWithLock_(function() {
    if (col === 7) {
      var importance = phcepNormalizeImportance_(range.getValue());
      if (!importance.ok) {
        range.clearContent();
        sheet.getRange(row, 13).setValue(phcepLiteral_(importance.error + '已清除。'));
      } else if (importance.value !== null && range.getValue() !== importance.value) {
        range.setValue(importance.value);
      }
      return;
    }
    if (col !== 2 || range.getValue() !== '核准') return;
    var editor;
    try {
      editor = phcepEditorEmail_(e);
    } catch (error) {
      range.setValue('待審核');
      sheet.getRange(row, 13).setValue('未發布：需可驗證的授權編輯者。');
      return;
    }
    try {
      phcepPublishCollectionRow_(sheet.getParent(), sheet, row, editor);
    } catch (error) {
      range.setValue('待審核');
      sheet.getRange(row, 13).setValue('未發布：發布時發生錯誤（請確認 QA知識庫 存在）。');
    }
  });
}
