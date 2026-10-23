function onOpen() {
  SpreadsheetApp.getUi().createMenu('⚡ 臨床指令')
    .addItem('🛠️ 初始化標題、表單與觸發器', 'setupPHCEP')
    .addItem('🔄 更新已核准 QA 知識庫向量（選用）', 'buildCuratedQAEmbeddings')
    .addItem('💡 重新整理選取列 QA 建議回覆選單（人工知識庫）', 'refreshSelectedRowSuggestions')
    .addItem('📤 發送選取列問卷', 'sendSelectedQuestionnaire')
    .addItem('🩺 發送選取列每日健康問卷', 'sendSelectedVitalsQuestionnaire')
    .addItem('🆕 確認建立新的 CDR 邀請', 'sendNewSelectedCDRInvitation')
    .addItem('🆕 確認建立新的每日健康邀請', 'sendNewSelectedVitalsInvitation')
    .addItem('📤 批次發送勾選的問卷', 'sendBatchQuestionnaireFromCheckboxes')
    .addItem('📨 確認發送選取列草稿', 'sendSelectedDraft')
    .addItem('⚠️ 啟用 I 欄編輯即發送（需確認）', 'enableClinicianSendOnEdit')
    .addItem('🛑 停用 I 欄編輯即發送', 'disableClinicianSendOnEdit')
    .addItem('🧭 遷移版面（總覽／操作欄／收錄集合）', 'migratePHCEPLayout')
    .addItem('📊 重新整理總覽', 'refreshPHCEPOverview')
    .addItem('📚 發布已核准的收錄項目', 'publishApprovedCollections')
    .addToUi();
}

function phcepAuthorizeClinician_(eventUser) {
  const ss = phcepSpreadsheet_();
  const owner = ss.getOwner();
  const email = (eventUser || Session.getEffectiveUser()).getEmail().toLowerCase();
  if (!email || (phcepTrustedEditors_().indexOf(email) === -1 && (!owner || owner.getEmail().toLowerCase() !== email))) {
    throw new Error('Trusted clinician required.');
  }
}

function enableClinicianSendOnEdit() {
  phcepAuthorizeClinician_();
  const ui = SpreadsheetApp.getUi();
  const answer = ui.alert('啟用編輯即發送？',
    '啟用後，可信任醫師在 LINE對話 I 欄單格編輯非空草稿即會發送給病患。H 欄只填入草稿；多格貼上不發送。是否確定？',
    ui.ButtonSet.YES_NO);
  if (answer === ui.Button.YES) PropertiesService.getScriptProperties().setProperty('CLINICIAN_SEND_ON_EDIT', 'true');
}

function disableClinicianSendOnEdit() {
  phcepAuthorizeClinician_();
  PropertiesService.getScriptProperties().setProperty('CLINICIAN_SEND_ON_EDIT', 'false');
}

function phcepReadOperationState_(sheet, row) {
  const raw = String(sheet.getRange(row, 12).getValue() || '');
  if (!raw) return {};
  try {
    const state = JSON.parse(raw);
    if (state && typeof state === 'object' && !Array.isArray(state)) return state;
  } catch (error) {}
  throw new Error('Invalid operation status; clinician review required.');
}

function phcepWriteOperationState_(sheet, row, state) {
  sheet.getRange(row, 12).setValue(phcepLiteral_(JSON.stringify(state)));
  SpreadsheetApp.flush();
}

function phcepLocateOperationRow_(sheet, identity) {
  const rows = sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 11).getValues() : [];
  const matches = [];
  rows.forEach(function(values, i) {
    if (String(values[identity.column - 1]) === identity.value && String(values[2]).trim() === identity.recipient) matches.push(i + 2);
  });
  if (matches.length !== 1) throw new Error('Patient row moved, removed or changed; reconcile outbox before retry.');
  return matches[0];
}

function phcepArchiveReply_(operation, eventKey) {
  const history = phcepSpreadsheet_().getSheetByName('PHCEP回覆歷史');
  if (!history) throw new Error('Run setupPHCEP to provision protected reply history.');
  const ids = history.getLastRow() > 1 ? history.getRange(2, 1, history.getLastRow() - 1, 1).getValues() : [];
  if (!ids.some(function(value) { return String(value[0]) === operation.key; })) {
    history.appendRow([phcepLiteral_(operation.key), phcepLiteral_(eventKey), new Date(), phcepLiteral_(operation.draft)]);
    SpreadsheetApp.flush();
  }
}

// Right-shift the previous latest reply only inside the dedicated history area;
// K/L and the operator block never move. Full history stays in PHCEP回覆歷史.
function phcepShiftReplyHistory_(sheet, row, operation) {
  const previous = sheet.getRange(row, 10).getValue();
  const text = String(previous == null ? '' : previous);
  if (!text || text === operation.draft || text === phcepLiteral_(operation.draft)) return false;
  const layout = phcepLineLayout_(sheet);
  if (!layout) return false;
  const width = PHCEP_LINE_HISTORY_HEADERS_.length;
  const history = sheet.getRange(row, layout.historyStart, 1, width).getValues()[0];
  const shifted = [previous].concat(history.slice(0, width - 1)).map(function(value) {
    return typeof value === 'string' ? phcepLiteral_(value) : value;
  });
  sheet.getRange(row, layout.historyStart, 1, width).setValues([shifted]);
  return true;
}

function phcepCompleteReply_(sheet, row, operation, rawDraft, eventKey) {
  phcepArchiveReply_(operation, eventKey);
  phcepShiftReplyHistory_(sheet, row, operation);
  sheet.getRange(row, 10).setValue(phcepLiteral_(operation.draft));
  if (String(sheet.getRange(row, 9).getValue() || '') === rawDraft) sheet.getRange(row, 9).clearContent();
}

// Stable persisted payload and key survive network failure and subsequent retries.
function phcepSendRow_(sheet, row, kind, type) {
  phcepAuthorizeClinician_();
  if (row < 2) return false;
  const userId = String(sheet.getRange(row, 3).getValue() || '').trim();
  if (!/^U[0-9a-f]{32}$/i.test(userId)) throw new Error('Invalid LINE recipient.');
  const eventKey = String(sheet.getRange(row, 11).getValue() || '');
  const messageId = String(sheet.getRange(row, 1).getValue() || '');
  if (!eventKey && !messageId) throw new Error('Stable patient row identity required.');
  const identity = { column: eventKey ? 11 : 1, value: eventKey || messageId, recipient: userId };
  row = phcepLocateOperationRow_(sheet, identity);
  const state = phcepReadOperationState_(sheet, row);
  const stateKey = kind === 'questionnaire' ? 'questionnaire:' + (type || 'CDR') : kind;
  let operation = state[stateKey];
  // Retain legacy CDR retry state without silently sending a second invitation.
  if (!operation && kind === 'questionnaire' && (type || 'CDR') === 'CDR' && state.questionnaire) {
    operation = state.questionnaire;
    state[stateKey] = operation;
    delete state.questionnaire;
  }
  if (kind === 'reply' && operation && operation.status === 'SENT') {
    phcepArchiveReply_(operation, eventKey || messageId);
  }
  let draft;
  let rawDraft;
  if (kind === 'reply') {
    rawDraft = String(sheet.getRange(row, 9).getValue() || '');
    draft = rawDraft.trim();
    if (!draft) return false;
    if (draft.length > 5000) throw new Error('Draft exceeds LINE text message limit.');
    if (operation && (operation.recipient !== userId || operation.draft !== draft)) {
      if (operation.status !== 'SENT') throw new Error('Resolve pending reply before changing recipient or draft.');
      operation = null;
    }
  } else if (operation && operation.recipient !== userId) {
    throw new Error('Recipient changed; clinician review required.');
  }
  if (operation && operation.status === 'SENT') {
    if (kind === 'reply') phcepCompleteReply_(sheet, row, operation, rawDraft, eventKey || messageId);
    return true;
  }
  if (operation && operation.status === 'MANUAL_REVIEW') return false;
  if (!operation) {
    operation = { key: 'clinician:' + Utilities.getUuid(), recipient: userId, status: 'PENDING' };
    if (kind === 'questionnaire') {
      const invitation = phcepCreateInvitation_(userId, type || 'CDR');
      operation.nonce = invitation.nonce;
      operation.expiresAt = invitation.expiresAt;
      operation.messages = [{ type: 'text', text: '請填寫' + ((type || 'CDR') === 'CDR' ? '臨床失智評估量表' : '每日健康回報表單') +
        '。邀請有效期限為 24 小時，請勿轉傳；LINE ID 欄位可留空。\n' + invitation.url }];
    } else {
      operation.draft = draft;
      operation.messages = [{ type: 'text', text: draft }];
    }
    state[stateKey] = operation;
    phcepWriteOperationState_(sheet, row, state);
  }
  try {
    const result = phcepPush_(operation.key, operation.recipient, operation.messages);
    if (result && result.ok === false && result.error === 'AMBIGUOUS_EXPIRED') {
      row = phcepLocateOperationRow_(sheet, identity);
      operation.status = 'MANUAL_REVIEW';
      operation.error = 'AMBIGUOUS_EXPIRED';
      state.notice = '重試期限已過：請人工確認 LINE 寄件匣，勿重設金鑰或盲目重送。';
      phcepWriteOperationState_(sheet, row, state);
      return false;
    }
    if (result === false || (result && result.ok === false)) {
      row = phcepLocateOperationRow_(sheet, identity);
      operation.status = 'RETRY';
      operation.error = result && /^(LINE_(TOKEN_MISSING|FETCH_FAILED|MONTHLY_QUOTA_EXCEEDED|HTTP_[0-9]{3})|OUTBOUND_CONFLICT|INVALID_OUTBOUND)$/.test(result.error) ?
        result.error : 'SEND_FAILED';
      state.notice = '未發送：' + operation.error + '。草稿與重試金鑰已保留；修正原因後再確認發送。';
      phcepWriteOperationState_(sheet, row, state);
      return false;
    }
    row = phcepLocateOperationRow_(sheet, identity);
    operation.status = 'SENT';
    delete operation.error;
    delete state.notice;
    phcepWriteOperationState_(sheet, row, state);
    if (kind === 'reply') {
      phcepCompleteReply_(sheet, row, operation, rawDraft, eventKey || messageId);
    }
    return true;
  } catch (error) {
    row = phcepLocateOperationRow_(sheet, identity);
    operation.status = 'RETRY';
    phcepWriteOperationState_(sheet, row, state);
    return false;
  } finally {
    if (kind === 'questionnaire') {
      row = phcepLocateOperationRow_(sheet, identity);
      sheet.getRange(row, 2).setValue(false);
    }
  }
}

function phcepHandleEdit(e) {
  if (!e || !e.range) return;
  const range = e.range;
  const sheet = range.getSheet();
  if (!phcepInstalledEvent_(e, 'phcepHandleEdit', ScriptApp.EventType.ON_EDIT, sheet.getParent().getId())) return;
  if (sheet.getParent().getId() !== phcepSpreadsheet_().getId()) return;
  if (sheet.getName() === PHCEP_OVERVIEW_SHEET_) return phcepHandleOverviewEdit_(e);
  if (sheet.getName() === PHCEP_COLLECTION_SHEET_) return phcepHandleCollectionEdit_(e);
  if (sheet.getName() !== 'LINE對話') return;
  if (range.getRow() < 2) return;
  return phcepWithLock_(function() {
    if (range.getNumRows() !== 1 || range.getNumColumns() !== 1) {
      const start = range.getColumn();
      const end = start + range.getNumColumns() - 1;
      if (start <= 9 && end >= 2) {
        for (let row = range.getRow(); row < range.getRow() + range.getNumRows(); row++) {
          if (start <= 2 && end >= 2) sheet.getRange(row, 2).setValue(false);
          const state = phcepReadOperationState_(sheet, row);
          state.notice = '多格編輯未發送；請使用選取列或批次選單確認。';
          phcepWriteOperationState_(sheet, row, state);
        }
      }
      // Multi-cell pastes never run or arm operator actions; clear pasted actions and confirmations.
      const layout = phcepLineLayout_(sheet);
      if (layout && start <= layout.collect && end >= layout.action) {
        for (let row = range.getRow(); row < range.getRow() + range.getNumRows(); row++) {
          if (start <= layout.action && end >= layout.action) sheet.getRange(row, layout.action).clearContent();
          if (start <= layout.confirm && end >= layout.confirm) sheet.getRange(row, layout.confirm).setValue(false);
          if (start <= layout.collect && end >= layout.collect) sheet.getRange(row, layout.collect).setValue(false);
        }
      }
      return;
    }
    const row = range.getRow();
    const col = range.getColumn();
    if (col === 8) {
      const selected = String(range.getValue() || '').trim();
      const qa = phcepManualQA_();
      const match = qa.find(function(item) { return item.reply === selected; });
      if (match) {
        sheet.getRange(row, 9).setValue(phcepLiteral_(match.reply));
        phcepRecordQAUsage_(match);
      }
      range.clearContent();
      return;
    }
    if (col > 12) {
      const layout = phcepLineLayout_(sheet);
      if (layout && col >= layout.start && col < layout.historyStart) {
        return phcepHandleLineControlEdit_(e, sheet, row, col, layout);
      }
      return;
    }
    const autoReply = col === 9 && phcepProperty_('CLINICIAN_SEND_ON_EDIT') === 'true';
    const questionnaire = col === 2 && (range.getValue() === true || range.getValue() === 'TRUE');
    if (!autoReply && !questionnaire) return;
    const editMessageId = String(sheet.getRange(row, 1).getValue() || '');
    const editEventKey = String(sheet.getRange(row, 11).getValue() || '');
    const editRecipient = String(sheet.getRange(row, 3).getValue() || '').trim();
    try {
      if (!e.user) throw new Error('Verified editor identity required.');
      phcepAuthorizeClinician_(e.user);
      phcepSendRow_(sheet, row, questionnaire ? 'questionnaire' : 'reply', 'CDR');
    } catch (error) {
      const currentRow = phcepLocateOperationRow_(sheet, {
        column: editEventKey ? 11 : 1, value: editEventKey || editMessageId, recipient: editRecipient
      });
      const state = phcepReadOperationState_(sheet, currentRow);
      state.notice = '未發送：請確認身分、收件者或待處理狀態，使用選單重試。';
      phcepWriteOperationState_(sheet, currentRow, state);
      if (questionnaire) sheet.getRange(currentRow, 2).setValue(false);
    }
  });
}

function phcepSelectedRow_() {
  const ss = phcepSpreadsheet_();
  const sheet = ss.getActiveSheet();
  const range = ss.getActiveRange();
  if (!sheet || sheet.getName() !== 'LINE對話' || !range || range.getNumRows() !== 1 || range.getRow() < 2) {
    throw new Error('Select one patient row in LINE對話.');
  }
  return { sheet: sheet, row: range.getRow() };
}

function sendSelectedQuestionnaire() {
  return phcepWithLock_(function() {
    const selected = phcepSelectedRow_();
    return phcepSendRow_(selected.sheet, selected.row, 'questionnaire', 'CDR');
  });
}

function sendSelectedVitalsQuestionnaire() {
  return phcepWithLock_(function() {
    const selected = phcepSelectedRow_();
    return phcepSendRow_(selected.sheet, selected.row, 'questionnaire', 'VITALS');
  });
}

// Caller holds the lock and has obtained explicit confirmation (menu dialog or no-menu confirm checkbox).
function phcepNewInvitationForRow_(sheet, row, type) {
  const state = phcepReadOperationState_(sheet, row);
  const key = 'questionnaire:' + type;
  const prior = state[key] || (type === 'CDR' ? state.questionnaire : null);
  if (prior && prior.status !== 'SENT') {
    throw new Error('Reconcile pending or ambiguous invitation before creating a new invitation.');
  }
  if (prior) {
    state.previousInvitations = (state.previousInvitations || []).concat([{ key: prior.key, type: type, status: prior.status }]).slice(-20);
    delete state[key];
    if (type === 'CDR') delete state.questionnaire;
    phcepWriteOperationState_(sheet, row, state);
  }
  return phcepSendRow_(sheet, row, 'questionnaire', type);
}

function phcepNewSelectedInvitation_(type) {
  phcepAuthorizeClinician_();
  const ui = SpreadsheetApp.getUi();
  if (ui.alert('確認新邀請', '此操作建立新的 ' + type + ' 邀請並發送；不是重試既有邀請。是否確定？',
      ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  return phcepWithLock_(function() {
    const selected = phcepSelectedRow_();
    return phcepNewInvitationForRow_(selected.sheet, selected.row, type);
  });
}

function sendNewSelectedCDRInvitation() {
  return phcepNewSelectedInvitation_('CDR');
}

function sendNewSelectedVitalsInvitation() {
  return phcepNewSelectedInvitation_('VITALS');
}

function sendSelectedDraft() {
  phcepAuthorizeClinician_();
  const ui = SpreadsheetApp.getUi();
  if (ui.alert('確認發送', '將發送選取列 I 欄草稿給該列病患。是否確定？', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  return phcepWithLock_(function() {
    const selected = phcepSelectedRow_();
    return phcepSendRow_(selected.sheet, selected.row, 'reply');
  });
}

function sendBatchQuestionnaireFromCheckboxes() {
  return phcepWithLock_(function() {
    phcepAuthorizeClinician_();
    const sheet = phcepSpreadsheet_().getSheetByName('LINE對話');
    let sent = 0;
    let failed = 0;
    for (let row = 2; row <= sheet.getLastRow(); row++) {
      const checked = sheet.getRange(row, 2).getValue();
      if (checked !== true && checked !== 'TRUE') continue;
      const identity = {
        column: sheet.getRange(row, 11).getValue() ? 11 : 1,
        value: String(sheet.getRange(row, 11).getValue() || sheet.getRange(row, 1).getValue() || ''),
        recipient: String(sheet.getRange(row, 3).getValue() || '').trim()
      };
      try {
        if (phcepSendRow_(sheet, row, 'questionnaire', 'CDR')) sent++;
        else failed++;
      } catch (error) {
        failed++;
        const currentRow = phcepLocateOperationRow_(sheet, identity);
        const state = phcepReadOperationState_(sheet, currentRow);
        state.notice = '未發送：請確認收件者及待處理狀態。';
        phcepWriteOperationState_(sheet, currentRow, state);
        sheet.getRange(currentRow, 2).setValue(false);
      }
    }
    phcepSpreadsheet_().toast('成功 ' + sent + ' 筆；未發送 ' + failed + ' 筆。', '批次問卷', 5);
    return { sent: sent, failed: failed };
  });
}

function phcepManualQA_() {
  return phcepReadQA_(phcepSpreadsheet_());
}

// Usage counts (N per row, O for identical replies) are a small bounded ranking hint only.
function phcepRecordQAUsage_(match) {
  const sheet = phcepSpreadsheet_().getSheetByName('QA知識庫');
  if (!sheet || !match || !match.row) return;
  const count = sheet.getLastRow() - 1;
  if (count < 1 || match.row - 2 >= count) return;
  const replies = sheet.getRange(2, 7, count, 1).getValues();
  const usage = sheet.getRange(2, 14, count, 2).getValues();
  const bump = function(current) {
    return current === '' || typeof current === 'number' ? (Number(current) || 0) + 1 : current;
  };
  usage[match.row - 2][0] = bump(usage[match.row - 2][0]);
  replies.forEach(function(values, i) {
    if (String(values[0] || '').trim() === match.reply) usage[i][1] = bump(usage[i][1]);
  });
  sheet.getRange(2, 14, count, 2).setValues(usage);
}

function suggestRepliesForUserMessage(userMessage, targetRow) {
  const ss = phcepSpreadsheet_();
  const sheet = ss.getSheetByName('LINE對話');
  if (!sheet || targetRow < 2) return [];
  return phcepApplySuggestions_(ss, sheet, targetRow, userMessage);
}

function refreshSelectedRowSuggestions() {
  return phcepWithLock_(function() {
    const selected = phcepSelectedRow_();
    return suggestRepliesForUserMessage(selected.sheet.getRange(selected.row, 6).getValue(), selected.row);
  });
}

function formatCellDisplayForReply(content) {
  return { isFormula: false, value: phcepLiteral_(String(content || '').trim()) };
}
