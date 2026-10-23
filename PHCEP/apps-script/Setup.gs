const PHCEP_SCHEMAS_ = {
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

function phcepQALegacyHeaders_() {
  var compact = PHCEP_SCHEMAS_['QA知識庫'];
  return compact.slice(0, 3).concat(['LINE Friend 訊息 1', 'LINE Friend 訊息 2'],
    compact.slice(3, 5), ['檔案/媒體連結', '檔案/網址名稱'], compact.slice(5));
}

function phcepEnsureSheet_(ss, name, headers) {
  const sheet = ss.getSheetByName(name) || ss.insertSheet(name);
  if (name === 'QA知識庫' && sheet.getMaxColumns() >= 15) {
    const legacy = phcepQALegacyHeaders_();
    const actual = sheet.getRange(1, 1, 1, legacy.length).getValues()[0];
    if (legacy.every(function(header, i) { return actual[i] === header; })) headers = legacy;
  }
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

function migratePHCEPQAColumns() {
  phcepAuthorizeClinician_();
  return phcepWithLock_(function() {
    const ss = phcepSpreadsheet_();
    const sheet = ss.getSheetByName('QA知識庫');
    if (!sheet || sheet.getFormUrl()) throw new Error('Managed QA sheet required.');
    const layout = phcepQALayout_(sheet);
    const removed = [layout.alias1, layout.alias2, layout.media, layout.filename].filter(Boolean);
    if (!removed.length) return { changed: false, columnsRemoved: 0 };
    const count = sheet.getLastRow() - 1;
    const values = count > 0 ? sheet.getRange(2, 1, count, layout.width).getValues() : [];
    const formulas = sheet.getRange(1, 1, sheet.getLastRow(), layout.width).getFormulas();
    if (formulas.some(function(row) { return row.some(Boolean); })) {
      throw new Error('QA_MIGRATION_FORMULAS_REQUIRE_REVIEW: resolve formulas before deleting columns.');
    }
    const rich = count > 0 ? sheet.getRange(2, 1, count, layout.width).getRichTextValues() : [];
    const staged = values.map(function(row, i) {
      const questions = [];
      [layout.question, layout.alias1, layout.alias2].filter(Boolean).forEach(function(column) {
        phcepLinkedText_(row[column - 1], rich[i][column - 1]).split(/\r?\n/).forEach(function(value) {
          value = value.trim();
          if (value && questions.indexOf(value) === -1) questions.push(value);
        });
      });
      let reply = phcepLinkedText_(row[layout.reply - 1], rich[i][layout.reply - 1]);
      if (layout.media) {
        phcepRichLinks_(row[layout.media - 1], rich[i][layout.media - 1]).forEach(function(url) {
          if (reply.indexOf(url) === -1) reply += (reply ? '\n' : '') + url;
        });
      }
      const question = questions.join('\n');
      if (question.length > 49000 || reply.length > 49000) throw new Error('QA_MIGRATION_CELL_TOO_LARGE');
      return { question: question, reply: reply };
    });
    const backup = sheet.copyTo(ss).setName('PHCEP_QA備份_' + Date.now() + '_' + Utilities.getUuid().slice(0, 8));
    phcepProtectSheet_(ss, backup, phcepTrustedEditors_());
    SpreadsheetApp.flush();
    // The original sheet is untouched until the complete copy is protected.
    if (count > 0) {
      sheet.getRange(2, layout.question, count, 1).setValues(staged.map(function(row) { return [phcepLiteral_(row.question)]; }));
      sheet.getRange(2, layout.reply, count, 1).setValues(staged.map(function(row) { return [phcepLiteral_(row.reply)]; }));
    }
    removed.sort(function(a, b) { return b - a; }).forEach(function(column) { sheet.deleteColumns(column, 1); });
    phcepApplyQAValidations_(sheet);
    const report = { changed: true, columnsRemoved: removed.length, backupSheet: backup.getName(), rows: count };
    console.log(JSON.stringify(report));
    return report;
  });
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

function phcepEnsureEditTrigger_(ss) {
  let found = false;
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() !== 'phcepHandleEdit') return;
    if (!found && trigger.getTriggerSourceId() === ss.getId() &&
        trigger.getEventType() === ScriptApp.EventType.ON_EDIT) {
      found = true;
    } else {
      ScriptApp.deleteTrigger(trigger);
    }
  });
  if (!found) ScriptApp.newTrigger('phcepHandleEdit').forSpreadsheet(ss).onEdit().create();
}

function phcepEnsureTriggers_(ss, forms) {
  phcepEnsureEditTrigger_(ss);
  const wanted = [];
  forms.forEach(function(form) {
    wanted.push({ handler: 'phcepHandleFormSubmit', id: form.getId(), type: ScriptApp.EventType.ON_FORM_SUBMIT });
  });
  const found = {};
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    const handler = trigger.getHandlerFunction();
    if (handler !== 'phcepHandleFormSubmit') return;
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
    builder.forForm(forms.find(function(form) { return form.getId() === item.id; })).onFormSubmit().create();
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
