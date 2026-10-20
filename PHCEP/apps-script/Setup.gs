const PHCEP_SCHEMAS_ = {
  'LINE對話': ['Message ID', '發送問卷 (勾選)', 'User ID', 'DateTime', 'User Name', '訊息 (病患問題)', '檔案/媒體連結', '建議回覆選單', '回覆草稿 (可編輯)', '回覆紀錄 (最新)', 'Event Key', '操作狀態'],
  'QA知識庫': ['ID', '重要性分級 (1-5)', '訊息', 'LINE Friend 訊息 1', 'LINE Friend 訊息 2', 'Line Friend 連結備註', '回覆', '檔案/媒體連結', '檔案/網址名稱', '連結備註', '問題 Embedding', '回覆 Embedding', '備註 Embedding', '行內使用次數', '全域使用次數'],
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

function phcepConfigurationNames_() {
  const missing = [];
  if (!phcepProperty_('SPREADSHEET_ID')) missing.push('SPREADSHEET_ID');
  if (!phcepProperty_('LINE_CHANNEL_ACCESS_TOKEN', ['CHANNEL_ACCESS_TOKEN'])) missing.push('LINE_CHANNEL_ACCESS_TOKEN');
  if (!phcepProperty_('LINE_CHANNEL_SECRET', ['CHANNEL_SECRET'])) missing.push('LINE_CHANNEL_SECRET');
  const secret = phcepProperty_('GATEWAY_SIGNING_SECRET');
  if (!secret || secret.length < 32 || secret === phcepProperty_('LINE_CHANNEL_SECRET', ['CHANNEL_SECRET'])) {
    missing.push('GATEWAY_SIGNING_SECRET');
  }
  if (!phcepProperty_('IMAGE_FOLDER_ID', ['DRIVE_FOLDER_ID'])) missing.push('IMAGE_FOLDER_ID');
  if (!phcepProperty_('TRUSTED_EDITOR_EMAILS')) missing.push('TRUSTED_EDITOR_EMAILS');
  return missing;
}

function validatePHCEPConfiguration() {
  const effective = Session.getEffectiveUser().getEmail().toLowerCase();
  const spreadsheetId = phcepProperty_('SPREADSHEET_ID');
  const trusted = phcepTrustedEditors_();
  if (trusted.indexOf(effective) === -1) {
    if (!spreadsheetId) throw new Error('Trusted clinician required.');
    const owner = SpreadsheetApp.openById(spreadsheetId).getOwner();
    if (!effective || !owner || owner.getEmail().toLowerCase() !== effective) throw new Error('Trusted clinician required.');
  }
  return { missing: phcepConfigurationNames_() };
}

function phcepEnsureSheet_(ss, name, headers) {
  const sheet = ss.getSheetByName(name) || ss.insertSheet(name);
  if (sheet.getMaxColumns() < headers.length) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), headers.length - sheet.getMaxColumns());
  }
  const existing = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  existing.forEach(function(value, i) {
    if (value !== '' && String(value) !== headers[i]) {
      throw new Error('Inconsistent schema: ' + name + ', column ' + (i + 1));
    }
    if (value === '' && sheet.getLastRow() > 1 &&
        sheet.getRange(2, i + 1, sheet.getLastRow() - 1, 1).getValues().some(function(row) { return row[0] !== ''; })) {
      throw new Error('Unlabelled data overlaps schema: ' + name + ', column ' + (i + 1));
    }
  });
  if (sheet.getLastRow() > 1 && existing.every(function(value) { return value === ''; })) {
    throw new Error('Missing headers on populated sheet: ' + name);
  }
  headers.forEach(function(header, i) {
    if (existing[i] === '') sheet.getRange(1, i + 1).setValue(header);
  });
  sheet.setFrozenRows(Math.max(1, sheet.getFrozenRows()));
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#e8f0fe');
  return sheet;
}

function phcepTrustedEditors_() {
  const raw = phcepProperty_('TRUSTED_EDITOR_EMAILS') || '';
  const emails = raw.split(',').map(function(email) { return email.trim().toLowerCase(); }).filter(Boolean);
  if (!emails.length || emails.some(function(email) { return !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email); })) {
    throw new Error('TRUSTED_EDITOR_EMAILS must list trusted clinician email addresses.');
  }
  return emails;
}

function phcepProtectSheet_(ss, sheet, trusted) {
  const owner = ss.getOwner();
  const ownerEmail = owner ? owner.getEmail().toLowerCase() : '';
  const effective = Session.getEffectiveUser().getEmail().toLowerCase();
  if (!effective || (effective !== ownerEmail && trusted.indexOf(effective) === -1)) {
    throw new Error('Setup must run as the owner or a TRUSTED_EDITOR_EMAILS clinician.');
  }
  const allowed = trusted.concat(ownerEmail ? [ownerEmail] : []);
  const protections = sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET);
  const protection = protections[0] || sheet.protect();
  protection.setDescription('PHCEP trusted clinicians only');
  protection.setWarningOnly(false);
  protection.setUnprotectedRanges([]);
  protection.addEditors(allowed);
  const unwanted = protection.getEditors().filter(function(user) {
    return allowed.indexOf(user.getEmail().toLowerCase()) === -1;
  });
  if (unwanted.length) protection.removeEditors(unwanted);
  if (protection.canDomainEdit()) protection.setDomainEdit(false);
  // Existing additional protections are retained; they may be more restrictive.
}

function setupPHCEP() {
  return phcepWithLock_(function() {
    const trusted = phcepTrustedEditors_();
    const missing = validatePHCEPConfiguration().missing;
    if (missing.indexOf('GATEWAY_SIGNING_SECRET') !== -1 || missing.indexOf('LINE_CHANNEL_SECRET') !== -1) {
      throw new Error('Configure distinct LINE_CHANNEL_SECRET and GATEWAY_SIGNING_SECRET (at least 32 characters).');
    }
    const props = PropertiesService.getScriptProperties();
    let ss;
    const spreadsheetId = phcepProperty_('SPREADSHEET_ID');
    if (spreadsheetId) ss = SpreadsheetApp.openById(spreadsheetId);
    else {
      ss = SpreadsheetApp.getActiveSpreadsheet();
      if (!ss) {
        const effective = Session.getEffectiveUser().getEmail().toLowerCase();
        if (trusted.indexOf(effective) === -1) throw new Error('Standalone setup requires a trusted clinician.');
        ss = SpreadsheetApp.create('PHCEP 臨床工作台');
      }
    }
    const owner = ss.getOwner();
    const effective = Session.getEffectiveUser().getEmail().toLowerCase();
    if (!effective || (trusted.indexOf(effective) === -1 && (!owner || owner.getEmail().toLowerCase() !== effective))) {
      throw new Error('Setup must run as the owner or a trusted clinician.');
    }
    if (!spreadsheetId) props.setProperty('SPREADSHEET_ID', ss.getId());
    const folderId = phcepProperty_('IMAGE_FOLDER_ID', ['DRIVE_FOLDER_ID']);
    const folder = folderId ? DriveApp.getFolderById(folderId) : DriveApp.createFolder('PHCEP 私人病患媒體');
    if (folder.getSharingAccess() !== DriveApp.Access.PRIVATE) throw new Error('Media folder must be private.');
    if (!folderId) props.setProperty('IMAGE_FOLDER_ID', folder.getId());
    const migration = phcepMigrateLayout_(ss, trusted);
    const cdr = phcepEnsureForm_(ss, 'CDR');
    const vitals = phcepEnsureForm_(ss, 'VITALS');
    ss.getSheets().forEach(function(sheet) {
      if (sheet.getFormUrl()) phcepProtectSheet_(ss, sheet, trusted);
    });
    // Form response tabs may be inserted first; restore 總覽, LINE對話, QA知識庫 order.
    phcepEnsureSheetOrder_(ss);
    phcepEnsureTriggers_(ss, [cdr, vitals]);
    return { spreadsheetId: ss.getId(), spreadsheetUrl: ss.getUrl(), migration: migration,
      cdrFormId: cdr.getId(), cdrFormUrl: cdr.getPublishedUrl(),
      vitalsFormId: vitals.getId(), vitalsFormUrl: vitals.getPublishedUrl(),
      mediaFolderId: folder.getId(), mediaFolderUrl: folder.getUrl(),
      missingRuntimeProperties: phcepConfigurationNames_() };
  });
}

function phcepEnsureTriggers_(ss, forms) {
  const wanted = [{ handler: 'phcepHandleEdit', id: ss.getId(), type: ScriptApp.EventType.ON_EDIT }];
  forms.forEach(function(form) {
    wanted.push({ handler: 'phcepHandleFormSubmit', id: form.getId(), type: ScriptApp.EventType.ON_FORM_SUBMIT });
  });
  const found = {};
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    const handler = trigger.getHandlerFunction();
    if (handler !== 'phcepHandleEdit' && handler !== 'phcepHandleFormSubmit') return;
    const match = wanted.find(function(item) {
      return item.handler === handler && item.id === trigger.getTriggerSourceId() && item.type === trigger.getEventType();
    });
    const key = handler + ':' + trigger.getTriggerSourceId();
    if (!match || found[key]) ScriptApp.deleteTrigger(trigger);
    else found[key] = true;
  });
  wanted.forEach(function(item) {
    if (found[item.handler + ':' + item.id]) return;
    const builder = ScriptApp.newTrigger(item.handler);
    if (item.handler === 'phcepHandleEdit') builder.forSpreadsheet(ss).onEdit().create();
    else builder.forForm(forms.find(function(form) { return form.getId() === item.id; })).onFormSubmit().create();
  });
}

function phcepInstalledEvent_(e, handler, type, sourceId) {
  if (!e || !e.triggerUid) return false;
  return ScriptApp.getProjectTriggers().some(function(trigger) {
    return String(trigger.getUniqueId()) === String(e.triggerUid) &&
      trigger.getHandlerFunction() === handler && trigger.getEventType() === type &&
      String(trigger.getTriggerSourceId()) === String(sourceId);
  });
}

function updateSheetNamesAndHeaders() {
  return setupPHCEP();
}
