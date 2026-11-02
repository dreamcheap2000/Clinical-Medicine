// All machine writes and menu writes share the same script lock.
function nhiApiError_(status, code) {
  const error = new Error(code);
  error.apiStatus = status;
  throw error;
}

function nhiApiMac_(text, secret) {
  return Utilities.base64Encode(Utilities.computeHmacSha256Signature(text, secret));
}

function nhiApiEqual_(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

function doPost(e) {
  let result;
  try {
    const text = e && e.postData && e.postData.contents;
    if (!text || text.length > 30000) nhiApiError_(400, 'INVALID_ENVELOPE');
    const envelope = JSON.parse(text);
    if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope) ||
        Object.keys(envelope).sort().join() !==
          ['version', 'action', 'timestamp', 'nonce', 'rawBody', 'signature'].sort().join()) {
      nhiApiError_(400, 'INVALID_ENVELOPE');
    }
    const secret = PropertiesService.getScriptProperties().getProperty('NHI_GATEWAY_SIGNING_SECRET');
    if (!secret || secret.length < 32) nhiApiError_(503, 'SIGNING_NOT_CONFIGURED');
    if (envelope.version !== 1 || !Number.isSafeInteger(envelope.timestamp) ||
        Math.abs(Date.now() - envelope.timestamp) > 120000 ||
        typeof envelope.nonce !== 'string' || !/^[a-zA-Z0-9-]{20,80}$/.test(envelope.nonce) ||
        typeof envelope.rawBody !== 'string' ||
        !['patient.pending', 'patient.complete', 'patient.preview', 'patient.extract'].includes(envelope.action)) {
      nhiApiError_(400, 'INVALID_ENVELOPE');
    }
    const canonical = '1\n' + envelope.action + '\n' + envelope.timestamp + '\n' +
      envelope.nonce + '\n' + envelope.rawBody;
    if (!nhiApiEqual_(envelope.signature, nhiApiMac_(canonical, secret))) {
      nhiApiError_(400, 'INVALID_SIGNATURE');
    }
    const payload = JSON.parse(Utilities.newBlob(Utilities.base64Decode(envelope.rawBody)).getDataAsString());
    result = nhiWithLock_(function() {
      const cache = CacheService.getScriptCache();
      const key = 'nhi-api-' + envelope.nonce;
      if (cache.get(key)) nhiApiError_(409, 'REPLAY_REJECTED');
      cache.put(key, '1', 300);
      return nhiApiDispatch_(envelope.action, payload, secret);
    });
  } catch (error) {
    const code = error.apiStatus ? error.message :
      error instanceof SyntaxError ? 'INVALID_ENVELOPE' : 'SHEET_OPERATION_FAILED';
    console.error('nhi_api_error ' + code);
    result = { success: false, status: error.apiStatus || (error instanceof SyntaxError ? 400 : 503), error: code };
  }
  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

function nhiApiRecords_(sheet) {
  const rows = sheet.getDataRange().getValues();
  if (!rows[0] || NHI_HEADERS_.some(function(key, i) { return rows[0][i] !== key; })) {
    nhiApiError_(503, 'SHEET_SETUP_REQUIRED');
  }
  const seen = new Set();
  return rows.slice(1).map(function(row, index) {
    if (!row.some(function(v) { return v !== '' && v !== null && v !== undefined; })) return null;
    const record = {};
    NHI_HEADERS_.forEach(function(key, i) { record[key] = row[i] === undefined ? '' : row[i]; });
    const id = typeof record.rowId === 'number' ? record.rowId :
      /^[1-9]\d*$/.test(record.rowId) ? Number(record.rowId) : NaN;
    if (!Number.isSafeInteger(id) || id < 1 || seen.has(id)) nhiApiError_(409, 'SHEET_ROW_ID_ERROR');
    if (!['DRAFT', 'PENDING', 'COMPLETE'].includes(record.workflowStatus)) nhiApiError_(409, 'SHEET_STATUS_ERROR');
    if (NHI_HISTORY_KEYS_.some(function(key) {
      const value = record['history.' + key];
      return value !== '' && typeof value !== 'boolean';
    })) nhiApiError_(409, 'SHEET_BOOLEAN_ERROR');
    seen.add(id);
    record.rowId = id;
    return { record: record, sheetRow: index + 2 };
  }).filter(function(row) { return row !== null; });
}

function nhiApiPatient_(record) {
  const patient = {};
  NHI_HEADERS_.forEach(function(key) {
    if (['workflowStatus', 'importedAt', 'chartNo', 'hisDiagnosisCode', 'extractionRequestId'].includes(key)) return;
    const value = record[key];
    if (value === '' || value === undefined || value === null) return;
    const parts = key.split('.');
    if (parts.length === 2) {
      patient[parts[0]] = patient[parts[0]] || {};
      patient[parts[0]][parts[1]] = value;
    } else {
      patient[key] = value;
    }
  });
  return patient;
}

function nhiApiDate_(value) {
  if (typeof value !== 'string') nhiApiError_(400, 'INVALID_DATE');
  const match = /^(\d{4})[/-](\d{2})[/-](\d{2})$/.exec(value);
  if (!match) nhiApiError_(400, 'INVALID_DATE');
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (date.getUTCFullYear() !== Number(match[1]) || date.getUTCMonth() + 1 !== Number(match[2]) ||
      date.getUTCDate() !== Number(match[3])) nhiApiError_(400, 'INVALID_DATE');
  return match[1] + '/' + match[2] + '/' + match[3];
}

function nhiApiExtraction_(patient) {
  if (!patient || typeof patient !== 'object' || Array.isArray(patient) ||
      !/^[A-Z][A-Z0-9]\d{8}$/.test(patient.patientId || '')) nhiApiError_(400, 'INVALID_EXTRACTION');
  const record = {};
  const numericLimits = {
    heightCm: 999.9, weightKg: 999.99, waistCm: 600, hba1cPercent: 100,
    glycatedAlbuminPercent: 100, fastingGlucoseMgDl: 3000, totalCholesterolMgDl: 999,
    triglyceridesMgDl: 17000, ldlCMgDl: 999, hdlCMgDl: 999, systolicMmHg: 999, diastolicMmHg: 999
  };
  const choices = {
    gender: ['男', '女'], careStage: ['1', '2'], primaryDiagnosisCategory: ['1', '2', '3', '4'],
    smoking: ['1', '2', '3', '4'], alcohol: ['1', '2', '3'], betelNut: ['1', '2', '3']
  };
  Object.keys(patient).sort().forEach(function(key) {
    if (key === 'history' || key === 'lifestyleScores') {
      const fields = key === 'history' ? NHI_HISTORY_KEYS_ : NHI_LIFESTYLE_KEYS_;
      if (!patient[key] || typeof patient[key] !== 'object' || Array.isArray(patient[key])) {
        nhiApiError_(400, 'INVALID_EXTRACTION');
      }
      Object.keys(patient[key]).sort().forEach(function(field) {
        const value = patient[key][field];
        if (!fields.includes(field) || (key === 'history' ? typeof value !== 'boolean' :
            !Number.isInteger(value) || value < 0 || value > 10)) nhiApiError_(400, 'INVALID_EXTRACTION');
        record[key + '.' + field] = value;
      });
      return;
    }
    if (!NHI_HEADERS_.includes(key) ||
        ['rowId', 'workflowStatus', 'importedAt', 'chartNo', 'hisDiagnosisCode', 'extractionRequestId'].includes(key)) {
      nhiApiError_(400, 'INVALID_EXTRACTION');
    }
    const value = patient[key];
    if (!['string', 'number'].includes(typeof value) || String(value).length > 100 ||
        /^[=+\-@]/.test(String(value)) || /[\u0000-\u001f\u007f]/.test(String(value)) ||
        (typeof value === 'number' && !Number.isFinite(value))) nhiApiError_(400, 'INVALID_EXTRACTION');
    if (value === '') return;
    if (Object.prototype.hasOwnProperty.call(numericLimits, key) &&
        (typeof value !== 'number' || value < 0 || value > numericLimits[key])) {
      nhiApiError_(400, 'INVALID_EXTRACTION');
    }
    if (choices[key] && !choices[key].includes(String(value))) nhiApiError_(400, 'INVALID_EXTRACTION');
    if (key === 'primaryDiagnosisCode' && !/^[A-Z]\d[0-9A-Z](\.?[0-9A-Z]{1,4})?$/.test(value)) {
      nhiApiError_(400, 'INVALID_EXTRACTION');
    }
    record[key] = /Date$/.test(key) || key === 'birthday' ? nhiApiDate_(value) : value;
  });
  return record;
}

function nhiApiPreview_(record, rows, secret) {
  const existing = rows.filter(function(row) { return row.record.patientId === record.patientId; });
  const dates = existing.map(function(row) { return row.record.visitDate; }).filter(Boolean)
    .map(nhiApiDate_).sort();
  const allDates = dates.concat(record.visitDate ? [record.visitDate] : []).sort();
  const summary = {
    existingCount: existing.length,
    previousVisitDate: dates.length ? dates[dates.length - 1] : null,
    suggestedEnrollmentDate: allDates[0] || null,
    sameVisitExists: !!record.visitDate && dates.includes(record.visitDate)
  };
  // Includes all same-patient data, so a change between preview and save requires review again.
  const snapshot = JSON.stringify([record, existing.map(function(row) { return row.record; })]);
  return Object.assign({ success: true, previewToken: nhiApiMac_(snapshot, secret) }, summary);
}

function nhiApiDispatch_(action, payload, secret) {
  const sheet = nhiSpreadsheet_().getSheetByName(NHI_TAB_);
  if (!sheet) nhiApiError_(503, 'SHEET_SETUP_REQUIRED');
  const rows = nhiApiRecords_(sheet);
  if (action === 'patient.pending') {
    const next = rows.find(function(row) { return row.record.workflowStatus === 'PENDING'; });
    return { success: true, patient: next ? nhiApiPatient_(next.record) : null };
  }
  if (action === 'patient.complete') {
    if (!Number.isSafeInteger(payload.rowId) || payload.rowId < 1) nhiApiError_(400, 'INVALID_ROW_ID');
    const row = rows.find(function(row) { return row.record.rowId === payload.rowId; });
    if (!row) nhiApiError_(404, 'PATIENT_NOT_FOUND');
    if (row.record.workflowStatus === 'COMPLETE') return { success: true };
    if (row.record.workflowStatus !== 'PENDING') nhiApiError_(409, 'PATIENT_NOT_PENDING');
    sheet.getRange(row.sheetRow, nhiColumn_('workflowStatus')).setValues([['COMPLETE']]);
    SpreadsheetApp.flush();
    return { success: true };
  }
  const record = nhiApiExtraction_(payload.patient);
  const preview = nhiApiPreview_(record, rows, secret);
  if (action === 'patient.preview') return preview;
  if (typeof payload.requestId !== 'string' || !/^[a-zA-Z0-9-]{20,80}$/.test(payload.requestId) ||
      typeof payload.useSuggestedEnrollmentDate !== 'boolean') nhiApiError_(400, 'INVALID_EXTRACTION');
  const receipt = payload.requestId + ':' +
    nhiApiMac_(JSON.stringify([record, payload.useSuggestedEnrollmentDate]), secret);
  const saved = rows.find(function(row) {
    return String(row.record.extractionRequestId).split(':')[0] === payload.requestId;
  });
  if (saved) {
    if (saved.record.extractionRequestId !== receipt) nhiApiError_(409, 'REQUEST_ID_CONFLICT');
    return { success: true, rowId: saved.record.rowId, workflowStatus: 'DRAFT' };
  }
  if (!nhiApiEqual_(payload.previewToken, preview.previewToken)) nhiApiError_(409, 'PREVIEW_CHANGED');
  if (payload.useSuggestedEnrollmentDate) {
    if (!preview.suggestedEnrollmentDate) nhiApiError_(400, 'NO_SUGGESTED_DATE');
    record.enrollmentDate = preview.suggestedEnrollmentDate;
  }
  const state = nhiLoadState_(sheet);
  state.nextId++;
  Object.assign(record, {
    rowId: state.nextId, workflowStatus: 'DRAFT', importedAt: nhiNow_(), extractionRequestId: receipt
  });
  nhiAppendRows_(sheet, state, [record]);
  SpreadsheetApp.flush();
  return { success: true, rowId: record.rowId, workflowStatus: 'DRAFT' };
}
