// Container-bound script for the NHI 高血脂 patient spreadsheet (the one Render reads
// through GOOGLE_SHEET_ID). Install via 擴充功能 → Apps Script inside that spreadsheet.
// Only people with edit access to this spreadsheet can see or run the menu.
//
// One row = one NHI VPN submission. 新收案 (careStage 1) happens once per patient;
// 追蹤管理 (careStage 2) rows repeat the baseline fields and leave the time-point
// measurements blank. Every row starts as DRAFT; Tampermonkey only sees PENDING rows.

const NHI_TAB_ = 'NHI高血脂個案';
const NHI_MAX_ROWS_ = 500;
const NHI_ORDER_STAGES_ = { P8901B: '1', P8902B: '2' };
const NHI_HISTORY_KEYS_ = [
  'acuteCoronarySyndrome', 'coronaryRevascularization', 'intracranialOrCarotidStenosis',
  'aorticArchAtherosclerosis', 'coronaryArteryDisease', 'peripheralArteryDisease',
  'coronaryAngiography', 'coronaryOrPeripheralCT', 'carotidOrPeripheralUltrasound',
  'miWithinOneYear', 'twoOrMoreMIs', 'multivesselCoronaryObstruction', 'acsWithDiabetes',
  'padOrCarotidStenosis', 'coronaryArteryDiseaseCriterion', 'carotidStenosisCriterion'
];
const NHI_LIFESTYLE_KEYS_ = [
  'positiveSocialConnection', 'physicalActivity', 'harmfulSubstanceAvoidance',
  'sleepAndStressManagement', 'nutrition'
];
const NHI_HEADERS_ = [
  'rowId', 'workflowStatus', 'patientId', 'name', 'birthday', 'gender', 'visitDate',
  'enrollmentDate', 'physicianName', 'physicianId', 'primaryDiagnosisCategory',
  'primaryDiagnosisCode', 'hisDiagnosisCode', 'chartNo', 'importedAt', 'careStage',
  'acuteAdmissionDate', 'examDate', 'heightCm', 'weightKg', 'waistCm', 'labDate',
  'hba1cPercent', 'glycatedAlbuminPercent', 'fastingGlucoseMgDl', 'totalCholesterolMgDl',
  'triglyceridesMgDl', 'ldlCMgDl', 'hdlCMgDl', 'systolicMmHg', 'diastolicMmHg',
  'smoking', 'alcohol', 'betelNut'
].concat(
  NHI_HISTORY_KEYS_.map(function(key) { return 'history.' + key; }),
  NHI_LIFESTYLE_KEYS_.map(function(key) { return 'lifestyleScores.' + key; }),
  ['extractionRequestId']
);
// Stored as plain text so Sheets never turns dates or IDs into serial numbers.
const NHI_TEXT_COLUMNS_ = [
  'workflowStatus', 'patientId', 'name', 'birthday', 'gender', 'visitDate', 'enrollmentDate',
  'physicianName', 'physicianId', 'primaryDiagnosisCategory', 'primaryDiagnosisCode',
  'hisDiagnosisCode', 'chartNo', 'importedAt', 'careStage', 'acuteAdmissionDate', 'examDate',
  'labDate', 'extractionRequestId'
];
// Patient-level baseline repeated on every 追蹤管理 row. Everything else (visitDate,
// exam/lab values, blood pressure, habits, lifestyle scores) is per time point.
const NHI_BASELINE_KEYS_ = [
  'patientId', 'name', 'birthday', 'gender', 'enrollmentDate', 'physicianName', 'physicianId',
  'primaryDiagnosisCategory', 'primaryDiagnosisCode', 'hisDiagnosisCode', 'chartNo',
  'acuteAdmissionDate'
].concat(NHI_HISTORY_KEYS_.map(function(key) { return 'history.' + key; }));
const NHI_LABELS_ = {
  rowId: '系統序號（自動產生，勿修改）',
  workflowStatus: 'DRAFT＝補資料中；PENDING＝可由 Tampermonkey 載入；COMPLETE＝已完成',
  patientId: '身分證號', name: '姓名', birthday: '出生日期（西元 YYYY/MM/DD）', gender: '性別（男／女）',
  visitDate: '就醫日期（本次時間點，西元 YYYY/MM/DD）',
  enrollmentDate: '收案日期（新收案＝就醫日期；追蹤列沿用新收案日期）',
  physicianName: '醫師姓名', physicianId: '醫師身分證號（自 HIS 補填）',
  primaryDiagnosisCategory: '主診斷類別 1–4（自動建議，請確認）',
  primaryDiagnosisCode: '主診斷 ICD（僅在可對應類別時自動帶入）',
  hisDiagnosisCode: 'HIS 原始主診斷（參考，不送 NHI）', chartNo: '病歷號碼（參考，不送 NHI）',
  importedAt: '建立時間', careStage: '診療階段：1＝新收案；2＝追蹤管理'
};
const NHI_SOURCE_KEYS_ = [
  'orderCode', 'name', 'patientId', 'birthday', 'visitDate', 'diagnosis', 'gender',
  'physicianName', 'chartNo'
];

function onOpen() {
  SpreadsheetApp.getUi().createMenu('🏥 NHI 高血脂')
    .addItem('🧱 建立／檢查個案工作表', 'nhiSetupSheet')
    .addItem('📥 匯入 HIS 醫令明細（P8901B 新收案／P8902B 追蹤）', 'nhiOpenImport')
    .addItem('➕ 為選取列新增追蹤管理列', 'nhiAddFollowUpFromSelection')
    .addToUi();
}

function nhiWithLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new Error('其他人正在寫入工作表，請稍後再試。');
  try {
    return fn();
  } finally {
    try {
      SpreadsheetApp.flush();
    } finally {
      lock.releaseLock();
    }
  }
}

function nhiColumn_(key) {
  return NHI_HEADERS_.indexOf(key) + 1;
}

function nhiRecordValidation_(sheet, start, count) {
  const choices = {
    workflowStatus: ['DRAFT', 'PENDING', 'COMPLETE'], primaryDiagnosisCategory: ['1', '2', '3', '4'],
    careStage: ['1', '2'], gender: ['男', '女']
  };
  Object.keys(choices).forEach(function(key) {
    const rule = SpreadsheetApp.newDataValidation().requireValueInList(choices[key], true)
      .setAllowInvalid(false).build();
    sheet.getRange(start, nhiColumn_(key), count, 1).setDataValidation(rule);
  });
}

function nhiSpreadsheet_() {
  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) return active;
  const id = PropertiesService.getScriptProperties().getProperty('NHI_PATIENT_SHEET_ID');
  if (!id) throw new Error('請先從試算表執行 nhiSetupSheet。');
  return SpreadsheetApp.openById(id);
}

function nhiPrepareSheet_() {
  const properties = PropertiesService.getScriptProperties();
  const spreadsheet = nhiSpreadsheet_();
  let sheet = spreadsheet.getSheetByName(NHI_TAB_);
  const width = NHI_HEADERS_.length;
  if (!sheet) sheet = spreadsheet.insertSheet(NHI_TAB_);
  if (sheet.getLastRow() === 0) {
    if (sheet.getMaxColumns() < width) {
      sheet.insertColumnsAfter(sheet.getMaxColumns(), width - sheet.getMaxColumns());
    }
    sheet.getRange(1, 1, 1, width).setValues([NHI_HEADERS_]).setFontWeight('bold');
    sheet.setFrozenRows(1);
    NHI_HEADERS_.forEach(function(key, index) {
      if (NHI_LABELS_[key]) sheet.getRange(1, index + 1).setNote(NHI_LABELS_[key]);
    });
    const rows = Math.max(sheet.getMaxRows() - 1, 1);
    NHI_TEXT_COLUMNS_.forEach(function(key) {
      sheet.getRange(2, nhiColumn_(key), rows, 1).setNumberFormat('@');
    });
  }
  if (sheet.getMaxColumns() < width) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), width - sheet.getMaxColumns());
  }
  const headers = sheet.getRange(1, 1, 1, width).getValues()[0];
  if (headers[width - 1] === '' &&
      headers.slice(0, -1).every(function(header, i) { return header === NHI_HEADERS_[i]; })) {
    sheet.getRange(1, width).setValues([['extractionRequestId']]);
    headers[width - 1] = 'extractionRequestId';
  }
  if (headers.some(function(header, index) { return header !== NHI_HEADERS_[index]; })) {
    throw new Error('「' + NHI_TAB_ + '」第 1 列標題與 NHI 格式不符，請勿改動標題或欄位順序。');
  }
  sheet.setFrozenColumns(0);
  sheet.setFrozenRows(1);
  nhiRecordValidation_(sheet, 2, Math.max(sheet.getLastRow() - 1, 1));
  properties.setProperty('NHI_PATIENT_SHEET_ID', spreadsheet.getId());
  return sheet;
}

function nhiSetupSheet() {
  const sheet = nhiWithLock_(nhiPrepareSheet_);
  SpreadsheetApp.getUi().alert('NHI 高血脂個案工作表已就緒：' + sheet.getName());
}

function nhiOpenImport() {
  SpreadsheetApp.getUi().showModalDialog(
    HtmlService.createHtmlOutputFromFile('NhiImportDialog').setWidth(720).setHeight(580),
    '匯入 HIS 醫令明細（P8901B／P8902B）'
  );
}

// ROC (民國) yyy/mm/dd → Gregorian YYYY/MM/DD, the format the NHI VPN form uses.
function nhiRocToNhiDate_(value) {
  const match = String(value == null ? '' : value).trim()
    .match(/^(\d{2,3})[\/.-](\d{1,2})[\/.-](\d{1,2})$/);
  if (!match) return '';
  const year = Number(match[1]) + 1911;
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (Number(match[1]) < 1 || date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return '';
  return year + '/' + ('0' + month).slice(-2) + '/' + ('0' + day).slice(-2);
}

// Suggests the NHI 主診斷 category (cph_ddlICDTYPE value). Unlisted codes stay blank
// so the clinician decides; the NHI ICD list itself is only known after postback.
function nhiDiagnosisCategory_(code) {
  const compact = code.replace('.', '');
  if (/^(I63|G45)/.test(compact)) return '1';
  if (/^I25/.test(compact)) return '2';
  if (/^(I200|I21|I22|I24)/.test(compact)) return '3';
  if (/^(I702|I739|I74)/.test(compact)) return '4';
  return '';
}

function nhiText_(value, max) {
  const text = String(value == null ? '' : value).trim();
  if (!text) return '';
  if (text.length > max || /[\u0000-\u001f\u007f]/.test(text) || /^[=+\-@]/.test(text)) return null;
  return text;
}

function nhiMapSourceRows_(request) {
  if (!request || typeof request !== 'object' || !Array.isArray(request.rows) ||
      !request.rows.length || request.rows.length > NHI_MAX_ROWS_) {
    throw new Error('檔案沒有可匯入的資料列，或超過 ' + NHI_MAX_ROWS_ + ' 列。');
  }
  const mapped = [];
  const skipped = [];
  request.rows.forEach(function(row) {
    if (!row || typeof row !== 'object' || !Number.isSafeInteger(row.line) || row.line < 1 ||
        !row.values || typeof row.values !== 'object' ||
        Object.keys(row.values).sort().join() !== NHI_SOURCE_KEYS_.slice().sort().join() ||
        NHI_SOURCE_KEYS_.some(function(key) {
          return typeof row.values[key] !== 'string' || row.values[key].length > 200;
        })) {
      throw new Error('上傳資料格式無效，請重新選擇檔案。');
    }
    const source = row.values;
    const skip = function(reason) { skipped.push({ line: row.line, reason: reason }); };
    const careStage = NHI_ORDER_STAGES_[source.orderCode.trim().toUpperCase()];
    if (!careStage) return skip('非 P8901B／P8902B 醫令');
    const patientId = source.patientId.trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9]\d{8}$/.test(patientId)) return skip('身分證號格式錯誤');
    const name = nhiText_(source.name, 50);
    if (!name) return skip('姓名空白或含不允許字元');
    const birthday = nhiRocToNhiDate_(source.birthday);
    if (!birthday) return skip('出生日期不是有效的民國日期');
    const visitDate = nhiRocToNhiDate_(source.visitDate);
    if (!visitDate) return skip('看診日期不是有效的民國日期');
    const physicianName = nhiText_(source.physicianName, 30);
    if (physicianName === null) return skip('醫師姓名含不允許字元');
    const chartNo = source.chartNo.trim();
    if (chartNo && !/^[A-Za-z0-9-]{1,20}$/.test(chartNo)) return skip('病歷號碼格式錯誤');
    const diagnosis = source.diagnosis.trim().toUpperCase();
    const validDiagnosis = /^[A-Z]\d[0-9A-Z](\.?[0-9A-Z]{1,4})?$/.test(diagnosis) ? diagnosis : '';
    const category = validDiagnosis ? nhiDiagnosisCategory_(validDiagnosis) : '';
    const gender = source.gender.trim();
    mapped.push({
      line: row.line,
      values: {
        patientId: patientId, name: name, birthday: birthday,
        gender: gender === '男' || gender === '女' ? gender : '',
        visitDate: visitDate, careStage: careStage, physicianName: physicianName,
        primaryDiagnosisCategory: category, primaryDiagnosisCode: category ? validDiagnosis : '',
        hisDiagnosisCode: validDiagnosis, chartNo: chartNo,
        enrollmentDate: careStage === '1' ? visitDate : ''
      }
    });
  });
  return { mapped: mapped, skipped: skipped };
}

// Reads all rows into header-keyed records, indexes them per patient and finds the next rowId.
function nhiLoadState_(sheet) {
  const width = NHI_HEADERS_.length;
  const lastRow = sheet.getLastRow();
  const rows = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, width).getValues() : [];
  const state = { lastRow: lastRow, intake: {}, latest: {}, visits: {}, maxRowId: 0 };
  rows.forEach(function(row) {
    const record = {};
    NHI_HEADERS_.forEach(function(key, index) { record[key] = row[index]; });
    nhiRemember_(state, record);
  });
  // A persisted high-water mark keeps rowId values unique even after rows are deleted.
  const stored = Number(PropertiesService.getScriptProperties()
    .getProperty('NHI_PATIENT_LAST_ROW_ID') || 0);
  const documentProperties = PropertiesService.getDocumentProperties();
  const legacy = Number(documentProperties && documentProperties.getProperty('NHI_PATIENT_LAST_ROW_ID') || 0);
  state.nextId = Math.max(Number.isSafeInteger(stored) ? stored : 0,
    Number.isSafeInteger(legacy) ? legacy : 0, state.maxRowId);
  return state;
}

function nhiRemember_(state, record) {
  const id = Number(record.rowId);
  if (Number.isSafeInteger(id) && id > state.maxRowId) state.maxRowId = id;
  const patientId = String(record.patientId || '').trim().toUpperCase();
  if (!patientId) return;
  if (String(record.careStage) === '1' && !state.intake[patientId]) state.intake[patientId] = record;
  if (!state.latest[patientId] || id > Number(state.latest[patientId].rowId)) {
    state.latest[patientId] = record;
  }
  const visitDate = String(record.visitDate || '').trim();
  if (visitDate) state.visits[patientId + '|' + visitDate] = true;
}

function nhiBaseline_(record) {
  const baseline = {};
  NHI_BASELINE_KEYS_.forEach(function(key) {
    const value = record[key];
    if (value !== '' && value !== null && value !== undefined) baseline[key] = value;
  });
  return baseline;
}

function nhiAppendRows_(sheet, state, records) {
  if (!records.length) return;
  if (records.some(function(record) { return !Number.isSafeInteger(record.rowId) || record.rowId < 1; })) {
    throw new Error('rowId 超出安全整數範圍，無法新增資料。');
  }
  const start = 2;
  sheet.insertRowsBefore(start, records.length);
  const rows = records.slice().reverse().map(function(record) {
    return NHI_HEADERS_.map(function(key) {
      if (Object.prototype.hasOwnProperty.call(record, key)) return record[key];
      return key.indexOf('history.') === 0 && !record.extractionRequestId ? false : '';
    });
  });
  const formats = rows.map(function() {
    return NHI_HEADERS_.map(function(key) {
      return NHI_TEXT_COLUMNS_.indexOf(key) === -1 ? 'General' : '@';
    });
  });
  const range = sheet.getRange(start, 1, rows.length, NHI_HEADERS_.length);
  range.setNumberFormats(formats);
  range.setValues(rows);
  nhiRecordValidation_(sheet, start, rows.length);
  // Validation does not reset copied true values (insertCheckboxes can reset them).
  const checkbox = SpreadsheetApp.newDataValidation().requireCheckbox().build();
  sheet.getRange(start, nhiColumn_('history.' + NHI_HISTORY_KEYS_[0]),
    rows.length, NHI_HISTORY_KEYS_.length).setDataValidation(checkbox);
  state.lastRow += rows.length;
  PropertiesService.getScriptProperties()
    .setProperty('NHI_PATIENT_LAST_ROW_ID', String(state.nextId));
}

function nhiNow_() {
  return Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy/MM/dd HH:mm');
}

function importNhiHisExport(request) {
  const parsed = nhiMapSourceRows_(request);
  // Chronological order lets a 新收案 and its 追蹤 in the same file link correctly.
  parsed.mapped.sort(function(a, b) {
    return a.values.visitDate.localeCompare(b.values.visitDate) ||
      a.values.careStage.localeCompare(b.values.careStage) || a.line - b.line;
  });
  return nhiWithLock_(function() {
    const sheet = nhiPrepareSheet_();
    const state = nhiLoadState_(sheet);
    const createdAt = nhiNow_();
    const skipped = parsed.skipped.slice();
    const records = [];
    let followUpsWithoutIntake = 0;
    parsed.mapped.forEach(function(item) {
      const values = item.values;
      const patientId = values.patientId;
      if (state.visits[patientId + '|' + values.visitDate]) {
        skipped.push({ line: item.line, reason: '同一病人同一就醫日期已有資料列（略過重複）' });
        return;
      }
      if (values.careStage === '1' && state.intake[patientId]) {
        skipped.push({ line: item.line, reason: '此病人已有新收案列（rowId ' +
          state.intake[patientId].rowId + '），追蹤請用 P8902B 或「新增追蹤管理列」' });
        return;
      }
      let record = values;
      if (values.careStage === '2') {
        const source = state.intake[patientId] || state.latest[patientId];
        if (source) {
          const baseline = nhiBaseline_(source);
          // Today's HIS diagnosis is kept for reference; the NHI 主診斷 stays the enrollment one.
          record = Object.assign({}, values, baseline, {
            name: values.name, birthday: values.birthday,
            gender: values.gender || baseline.gender || '',
            physicianName: values.physicianName || baseline.physicianName || '',
            physicianId: values.physicianName && values.physicianName !== baseline.physicianName ?
              '' : baseline.physicianId || '',
            hisDiagnosisCode: values.hisDiagnosisCode,
            chartNo: values.chartNo || baseline.chartNo || ''
          });
        } else {
          followUpsWithoutIntake++;
        }
      }
      state.nextId++;
      record = Object.assign({}, record, {
        rowId: state.nextId, workflowStatus: 'DRAFT', importedAt: createdAt
      });
      records.push(record);
      nhiRemember_(state, record);
    });
    nhiAppendRows_(sheet, state, records);
    skipped.sort(function(a, b) { return a.line - b.line; });
    return {
      imported: records.length,
      intake: records.filter(function(record) { return record.careStage === '1'; }).length,
      followUp: records.filter(function(record) { return record.careStage === '2'; }).length,
      followUpsWithoutIntake: followUpsWithoutIntake,
      firstRowId: records.length ? records[0].rowId : null,
      lastRowId: records.length ? state.nextId : null,
      uncategorized: records.filter(function(record) {
        return !record.primaryDiagnosisCategory;
      }).length,
      skipped: skipped,
      sheetName: sheet.getName()
    };
  });
}

// Appends a 追蹤管理 row repeating the patient's baseline (from the 新收案 row when one
// exists). New time-point data — 就醫日期, exam/lab values, blood pressure, habits and
// lifestyle scores — stays blank for the clinician.
function nhiAddFollowUp_(sheetRow) {
  return nhiWithLock_(function() {
    const sheet = nhiPrepareSheet_();
    if (!Number.isSafeInteger(sheetRow) || sheetRow < 2 || sheetRow > sheet.getLastRow()) {
      throw new Error('請先在「' + NHI_TAB_ + '」選取一位病人的資料列（第 2 列以下）。');
    }
    const values = sheet.getRange(sheetRow, 1, 1, NHI_HEADERS_.length).getValues()[0];
    const selected = {};
    NHI_HEADERS_.forEach(function(key, index) { selected[key] = values[index]; });
    const patientId = String(selected.patientId || '').trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9]\d{8}$/.test(patientId)) throw new Error('選取列沒有有效的身分證號。');
    const state = nhiLoadState_(sheet);
    const source = state.intake[patientId] || selected;
    state.nextId++;
    const record = Object.assign(nhiBaseline_(source), {
      rowId: state.nextId, workflowStatus: 'DRAFT', careStage: '2', importedAt: nhiNow_()
    });
    nhiAppendRows_(sheet, state, [record]);
    return { rowId: record.rowId, sheetRow: 2, fromRowId: source.rowId };
  });
}

function nhiAddFollowUpFromSelection() {
  const sheet = SpreadsheetApp.getActiveSheet();
  if (sheet.getName() !== NHI_TAB_) {
    throw new Error('請先切換到「' + NHI_TAB_ + '」工作表並選取病人資料列。');
  }
  const result = nhiAddFollowUp_(sheet.getActiveRange().getRow());
  sheet.getRange(result.sheetRow, nhiColumn_('visitDate')).activate();
  SpreadsheetApp.getUi().alert('已新增追蹤管理列 rowId ' + result.rowId +
    '（沿用 rowId ' + result.fromRowId + ' 的基本資料）。\n' +
    '請填入本次就醫日期與檢查／檢驗等資料，確認後將 workflowStatus 改為 PENDING。');
}
