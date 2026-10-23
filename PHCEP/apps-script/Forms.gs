function phcepEnsureForm_(ss, type) {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty(type + '_FORM_ID');
  const url = type === 'CDR'
    ? phcepProperty_('CDR_FORM_URL', ['GOOGLE_FORM_URL', 'GOOGLE_FORM_BASE_URL'])
    : phcepProperty_('VITALS_FORM_URL');
  let form;
  if (id) form = FormApp.openById(id);
  else if (url) form = FormApp.openByUrl(url);
  else {
    form = FormApp.create(type === 'CDR' ? '臨床失智評估量表 (CDR®) 評估工作表' : '病患每日血壓、血糖與健康狀況回報表單');
    // Persist immediately so a failed setup reuses the same form.
    props.setProperty(type + '_FORM_ID', form.getId());
    props.setProperty(type + '_PROVISION_STAGE', 'BUILDING');
    form.setAllowResponseEdits(false);
  }
  if (props.getProperty(type + '_PROVISION_STAGE') === 'BUILDING') {
    const resumable = phcepResumableBuilder_(form, type);
    if (type === 'CDR') phcepBuildCDRQuestions_(resumable);
    else phcepBuildVitalsQuestions_(resumable);
    props.setProperty(type + '_PROVISION_STAGE', 'COMPLETE');
  }
  props.setProperty(type + '_FORM_ID', form.getId());
  if (!props.getProperty(type + '_FORM_URL')) props.setProperty(type + '_FORM_URL', form.getPublishedUrl());
  phcepEnsureTextItem_(form, props, type + '_TOKEN_ITEM_ID', 'PHCEP 邀請碼')
    .setRequired(true).setHelpText('邀請碼由連結帶入；修改或過期的邀請將不會連結病患紀錄。');
  const destination = form.getDestinationId();
  if (destination && destination !== ss.getId()) throw new Error('Existing form belongs to another spreadsheet.');
  if (!destination) form.setDestination(FormApp.DestinationType.SPREADSHEET, ss.getId());
  const responseSheet = ss.getSheets().find(function(sheet) {
    const associated = sheet.getFormUrl();
    return associated && FormApp.openByUrl(associated).getId() === form.getId();
  });
  if (responseSheet) props.setProperty(type + '_RESPONSE_SHEET_ID', String(responseSheet.getSheetId()));
  return form;
}

function migratePHCEPFormIdentity() {
  phcepAuthorizeClinician_();
  return phcepWithLock_(function() {
    const ss = phcepSpreadsheet_();
    const props = PropertiesService.getScriptProperties();
    // Preflight both forms before removing any item. Keep retired IDs for historical responses.
    const plans = ['CDR', 'VITALS'].map(function(type) {
      const id = props.getProperty(type + '_FORM_ID');
      if (!id) throw new Error('Missing configured form: ' + type);
      const form = FormApp.openById(id);
      if (form.getDestinationId() !== ss.getId()) throw new Error('Form destination mismatch: ' + type);
      const token = form.getItemById(Number(props.getProperty(type + '_TOKEN_ITEM_ID')));
      if (!token || token.getTitle() !== 'PHCEP 邀請碼') throw new Error('Invitation item mismatch: ' + type);
      token.asTextItem();
      const retiredId = props.getProperty(type + '_LINE_ITEM_ID');
      const items = form.getItems().filter(function(item) {
        if (retiredId === String(item.getId()) && item.getTitle() !== 'LINE ID 編號') {
          throw new Error('Configured identity item mismatch: ' + type);
        }
        return item.getTitle() === 'LINE ID 編號';
      });
      items.forEach(function(item) { item.asTextItem(); });
      return { type: type, form: form, items: items };
    });
    const report = {};
    plans.forEach(function(plan) {
      plan.items.forEach(function(item) { plan.form.deleteItem(item); });
      report[plan.type] = { removed: plan.items.length, identity: 'invitation-recipient-server-only' };
    });
    console.log(JSON.stringify(report));
    return report;
  });
}

function phcepFormPermissions_(formId, method, query, permission) {
  const options = {
    method: method, headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true
  };
  if (permission) {
    options.contentType = 'application/json';
    options.payload = JSON.stringify(permission);
  }
  const response = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' +
    encodeURIComponent(formId) + '/permissions?' + query, options);
  const code = response.getResponseCode();
  if (code < 200 || code >= 300) phcepFail_('FORM_RESPONDER_PERMISSION_HTTP_' + code);
  try {
    return JSON.parse(response.getContentText());
  } catch (error) {
    phcepFail_('FORM_RESPONDER_PERMISSION_INVALID_RESPONSE');
  }
}

function phcepHasAnonymousResponder_(formId) {
  let pageToken = '';
  do {
    const result = phcepFormPermissions_(formId, 'get',
      'includePermissionsForView=published&pageSize=100&fields=nextPageToken,permissions(type,view,role)' +
      (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : ''));
    if (!Array.isArray(result.permissions)) phcepFail_('FORM_RESPONDER_PERMISSION_INVALID_RESPONSE');
    if (result.permissions.some(function(permission) {
      return permission.type === 'anyone' && permission.view === 'published' && permission.role === 'reader';
    })) return true;
    pageToken = result.nextPageToken || '';
  } while (pageToken);
  return false;
}

/** Changes only responder access for the two configured forms; never shares response data. */
function configurePHCEPAnonymousForms() {
  phcepAuthorizeClinician_();
  return phcepWithLock_(function() {
    const configured = ['CDR', 'VITALS'].map(function(type) {
      const id = phcepProperty_(type + '_FORM_ID');
      if (!id) phcepFail_('FORM_NOT_CONFIGURED');
      const form = FormApp.openById(id);
      if (form.getItems().some(function(item) { return String(item.getType()) === 'FILE_UPLOAD'; })) {
        phcepFail_('FORM_FILE_UPLOAD_REQUIRES_LOGIN');
      }
      if (form.getDestinationId() !== phcepSpreadsheet_().getId()) phcepFail_('FORM_DESTINATION_MISMATCH');
      return { type: type, form: form };
    });
    const report = [];
    configured.forEach(function(item) {
      const form = item.form;
      form.setPublishingSummary(false);
      form.setCollectEmail(false);
      form.setLimitOneResponsePerUser(false);
      const advanced = form.supportsAdvancedResponderPermissions();
      if (advanced) {
        if (!phcepHasAnonymousResponder_(form.getId())) {
          phcepFormPermissions_(form.getId(), 'post', 'fields=type,view,role',
            { type: 'anyone', role: 'reader', view: 'published', allowFileDiscovery: false });
        }
        if (!phcepHasAnonymousResponder_(form.getId())) phcepFail_('FORM_ANONYMOUS_PERMISSION_NOT_APPLIED');
        form.setPublished(true);
      } else {
        // Legacy Workspace forms expose domain-login restrictions only through this older API.
        if (form.requiresLogin()) form.setRequireLogin(false);
        if (form.requiresLogin()) phcepFail_('FORM_STILL_REQUIRES_LOGIN');
      }
      form.setAcceptingResponses(true);
      if (form.collectsEmail() || form.hasLimitOneResponsePerUser() || form.isPublishingSummary() ||
          !form.isAcceptingResponses() || (advanced && !form.isPublished())) {
        phcepFail_('FORM_ANONYMOUS_SETTINGS_NOT_APPLIED');
      }
      report.push({ type: item.type, responderAccess: advanced ? 'anyone_with_link' : 'legacy_domain_login_disabled',
        emailCollection: false, oneResponsePerUser: false, responseSummaryPublic: false,
        acceptingResponses: true, signedOutBrowserCheck: 'required' });
    });
    console.log(JSON.stringify(report));
    return report;
  }, 20000);
}

function phcepResumableBuilder_(form, sourceType) {
  let index = 0;
  let step = 0;
  const props = PropertiesService.getScriptProperties();
  const key = sourceType + '_PROVISION_STEP';
  const completed = Number(props.getProperty(key) || 0);
  const existing = form.getItems();
  const builder = {
    setDescription: function(value) { if (!existing.length) form.setDescription(value); return builder; },
    setIsQuiz: function(value) { if (!existing.length) form.setIsQuiz(value); return builder; }
  };
  ['Text', 'Date', 'DateTime', 'SectionHeader', 'PageBreak', 'MultipleChoice', 'ParagraphText', 'Grid'].forEach(function(type) {
    const method = 'add' + type + 'Item';
    builder[method] = function() {
      const previous = existing[index++];
      const item = previous || form[method]();
      const wrapper = {};
      ['setTitle', 'setHelpText', 'setRequired', 'setChoiceValues', 'setRows', 'setColumns'].forEach(function(setter) {
        wrapper[setter] = function(value) {
          step++;
          if (previous && setter === 'setTitle' && step <= completed && previous.getTitle() !== value) {
            throw new Error('Incomplete form has operator edits; resolve provisioning manually.');
          }
          if (step > completed) {
            const typed = previous ? item['as' + type + 'Item']() : item;
            typed[setter](value);
            props.setProperty(key, String(step));
          }
          return wrapper;
        };
      });
      return wrapper;
    };
  });
  return builder;
}

function phcepEnsureTextItem_(form, props, key, title) {
  const configured = props.getProperty(key);
  let item;
  if (configured) {
    item = form.getItemById(Number(configured));
    if (!item) throw new Error('Configured form item is missing: ' + key);
    item = item.asTextItem();
  } else {
    const matches = form.getItems().filter(function(candidate) { return candidate.getTitle() === title; });
    if (matches.length > 1) throw new Error('Ambiguous form item: ' + title);
    item = matches.length ? matches[0].asTextItem() : form.addTextItem().setTitle(title);
    props.setProperty(key, String(item.getId()));
  }
  return item;
}

function phcepInvitationSignature_(payload) {
  const secret = phcepProperty_('GATEWAY_SIGNING_SECRET');
  const lineSecret = phcepProperty_('LINE_CHANNEL_SECRET', ['CHANNEL_SECRET']);
  if (!secret || secret.length < 32 || (lineSecret && secret === lineSecret)) {
    throw new Error('GATEWAY_SIGNING_SECRET must be at least 32 characters and distinct from the LINE secret.');
  }
  return Utilities.base64EncodeWebSafe(
    Utilities.computeHmacSha256Signature('invitation\n' + payload, secret, Utilities.Charset.UTF_8)
  ).replace(/=+$/, '');
}

function phcepConstantEqual_(a, b) {
  let difference = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    difference |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return difference === 0;
}

// Caller holds the shared script lock; tokens expose no LINE ID or clinical data.
function phcepCreateInvitation_(userId, type) {
  if (!/^U[0-9a-f]{32}$/i.test(userId)) throw new Error('Invalid LINE recipient.');
  if (type !== 'CDR' && type !== 'VITALS') throw new Error('Invalid form type.');
  const props = PropertiesService.getScriptProperties();
  const formId = props.getProperty(type + '_FORM_ID');
  const itemId = props.getProperty(type + '_TOKEN_ITEM_ID');
  if (!formId || !itemId) throw new Error('Run setupPHCEP before inviting patients.');
  const nonce = Utilities.getUuid();
  const expiry = Date.now() + 24 * 60 * 60 * 1000;
  const payload = nonce + '.' + expiry;
  const token = payload + '.' + phcepInvitationSignature_(payload);
  const form = FormApp.openById(formId);
  const response = form.createResponse().withItemResponse(
    form.getItemById(Number(itemId)).asTextItem().createResponse(token)
  );
  const url = response.toPrefilledUrl();
  phcepSpreadsheet_().getSheetByName('PHCEP邀請')
    .appendRow([nonce, phcepLiteral_(userId), type, formId, expiry, '']);
  SpreadsheetApp.flush();
  return { url: url, nonce: nonce, expiresAt: expiry };
}

function createPHCEPInvitation(userId, type) {
  phcepAuthorizeClinician_();
  return phcepWithLock_(function() { return phcepCreateInvitation_(userId, type || 'CDR'); });
}

function reconcilePHCEPFormResponse(type, responseId) {
  phcepAuthorizeClinician_();
  if (type !== 'CDR' && type !== 'VITALS') throw new Error('Invalid form type.');
  const form = FormApp.openById(phcepProperty_(type + '_FORM_ID'));
  const response = form.getResponses().find(function(item) { return String(item.getId()) === String(responseId); });
  if (!response) throw new Error('Response ID not found.');
  const trigger = ScriptApp.getProjectTriggers().find(function(item) {
    return item.getHandlerFunction() === 'phcepHandleFormSubmit' &&
      item.getTriggerSourceId() === form.getId() && item.getEventType() === ScriptApp.EventType.ON_FORM_SUBMIT;
  });
  if (!trigger) throw new Error('Run setupPHCEP to install the form trigger.');
  return phcepHandleFormSubmit({ source: form, response: response, triggerUid: trigger.getUniqueId() });
}

function phcepValidateInvitation_(token, formId, responseId, submittedAt) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3 || !/^[0-9a-f-]{36}$/i.test(parts[0]) || !/^\d{13}$/.test(parts[1])) {
    throw new Error('invalid-token');
  }
  const payload = parts[0] + '.' + parts[1];
  if (!phcepConstantEqual_(parts[2], phcepInvitationSignature_(payload))) throw new Error('invalid-signature');
  const responseTime = submittedAt ? new Date(submittedAt).getTime() : Date.now();
  if (!Number.isFinite(responseTime) || responseTime > Date.now() || Number(parts[1]) <= responseTime) throw new Error('expired-token');
  const sheet = phcepSpreadsheet_().getSheetByName('PHCEP邀請');
  const data = sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 6).getValues() : [];
  const index = data.findIndex(function(row) { return String(row[0]) === parts[0]; });
  if (index < 0) throw new Error('unknown-invitation');
  const row = data[index];
  if (String(row[3]) !== formId || Number(row[4]) !== Number(parts[1])) throw new Error('wrong-form');
  if (row[2] !== 'CDR' && row[2] !== 'VITALS') throw new Error('wrong-form');
  if (PropertiesService.getScriptProperties().getProperty(row[2] + '_FORM_ID') !== formId) throw new Error('wrong-form');
  if (row[5] && String(row[5]) !== responseId) throw new Error('replayed-invitation');
  return { sheet: sheet, row: index + 2, nonce: parts[0], userId: String(row[1]), type: row[2] };
}

function phcepHandleFormSubmit(e) {
  if (!e || !e.response || !e.source) return;
  if (!phcepInstalledEvent_(e, 'phcepHandleFormSubmit', ScriptApp.EventType.ON_FORM_SUBMIT, e.source.getId())) return;
  return phcepWithLock_(function() {
    const ss = phcepSpreadsheet_();
    const formId = String(e.source.getId());
    const responseId = String(e.response.getId() || '');
    if (!responseId) return;
    const props = PropertiesService.getScriptProperties();
    const type = ['CDR', 'VITALS'].find(function(candidate) { return props.getProperty(candidate + '_FORM_ID') === formId; });
    let invitation;
    const itemResponses = e.response.getItemResponses();
    try {
      if (!type) throw new Error('unknown-form');
      const tokenId = props.getProperty(type + '_TOKEN_ITEM_ID');
      const tokenResponses = itemResponses.filter(function(answer) { return String(answer.getItem().getId()) === tokenId; });
      if (tokenResponses.length !== 1) throw new Error('invalid-token');
      invitation = phcepValidateInvitation_(tokenResponses[0].getResponse(), formId, responseId, e.response.getTimestamp());
    } catch (error) {
      const safeReasons = ['invalid-token', 'invalid-signature', 'expired-token', 'unknown-invitation', 'wrong-form', 'replayed-invitation', 'unknown-form'];
      const reason = safeReasons.indexOf(error.message) !== -1 ? error.message : 'validation-failed';
      ss.getSheetByName('PHCEP隔離').appendRow([phcepLiteral_(responseId), phcepLiteral_(formId), new Date(), reason]);
      return { status: 'quarantined' };
    }
    // Reserve the response before any writes that can fail; the same response may resume safely.
    invitation.sheet.getRange(invitation.row, 6).setValue(phcepLiteral_(responseId));
    SpreadsheetApp.flush();
    const records = ss.getSheetByName('PHCEP表單紀錄');
    const tokenId = props.getProperty(type + '_TOKEN_ITEM_ID');
    const lineId = props.getProperty(type + '_LINE_ITEM_ID');
    const answers = itemResponses.filter(function(answer) {
      return [tokenId, lineId].indexOf(String(answer.getItem().getId())) === -1 &&
        answer.getItem().getTitle() !== 'LINE ID 編號';
    }).map(function(answer) {
      return { itemId: String(answer.getItem().getId()), title: answer.getItem().getTitle(), answer: answer.getResponse() };
    });
    const answersJson = phcepLiteral_(JSON.stringify(answers));
    const rows = records.getLastRow() > 1 ? records.getRange(2, 1, records.getLastRow() - 1, 6).getValues() : [];
    const existing = rows.find(function(row) { return String(row[0]) === responseId; });
    if (existing && (String(existing[5]) !== answersJson ||
        new Date(existing[3]).getTime() !== new Date(e.response.getTimestamp()).getTime())) {
      const reason = 'edited-response-review-required';
      const quarantine = ss.getSheetByName('PHCEP隔離');
      const quarantined = quarantine.getLastRow() > 1 ? quarantine.getRange(2, 1, quarantine.getLastRow() - 1, 4).getValues() : [];
      if (!quarantined.some(function(row) { return String(row[0]) === responseId && row[3] === reason; })) {
        quarantine.appendRow([phcepLiteral_(responseId), phcepLiteral_(formId), new Date(), reason]);
      }
      ss.toast('表單回應曾修改：請醫師檢查 PHCEP隔離；原紀錄與人工評分未變更。', '需要人工審查', 8);
      return { status: 'quarantined' };
    }
    if (!existing) {
      records.appendRow([phcepLiteral_(responseId), invitation.nonce, invitation.type, e.response.getTimestamp(),
        phcepLiteral_(invitation.userId), answersJson]);
    }
    if (type === 'CDR') {
      const clinician = ss.getSheetByName('PHCEP臨床評分');
      const clinicalIds = clinician.getLastRow() > 1 ? clinician.getRange(2, 1, clinician.getLastRow() - 1, 1).getValues() : [];
      if (!clinicalIds.some(function(row) { return String(row[0]) === responseId; })) {
        clinician.appendRow([phcepLiteral_(responseId), '', '', '', '', '', '', '']);
      }
    }
    return { status: 'linked' };
  });
}

function createDementiaScreeningForm() {
  return createFullCDRFormTraditionalChinese();
}

function createFullCDRFormTraditionalChinese() {
  setupPHCEP();
  return FormApp.openById(phcepProperty_('CDR_FORM_ID')).getPublishedUrl();
}

function createPatientVitalsTrackerForm() {
  setupPHCEP();
  return FormApp.openById(phcepProperty_('VITALS_FORM_ID')).getPublishedUrl();
}

function phcepBuildCDRQuestions_(form) {
  form.setDescription('臨床失智評估量表 (Clinical Dementia Rating, CDR) 半結構化訪談與施測工作表');
  form.setIsQuiz(false);
  form.addSectionHeaderItem().setTitle('被評估者與觀察者基本資料').setHelpText('請填寫被評估者與主要照顧者/觀察者的基本資訊');
  form.addTextItem().setTitle('受試者姓名 / 編號').setRequired(true);
  form.addTextItem().setTitle('受試者代號 / 簡稱');
  form.addTextItem().setTitle('觀察者姓名及與被評估者之關係（如配偶、子女）').setRequired(true);
  form.addDateItem().setTitle('評估日期').setRequired(true);
  form.addPageBreakItem().setTitle('觀察者訪談：記憶力 (Memory)');
  form.addMultipleChoiceItem().setTitle('1. 他/她是否有記憶力或思考方面的問題？').setChoiceValues(['是', '否']).setRequired(true);
  form.addMultipleChoiceItem().setTitle('1a. 若「是」，這是持續發生的問題（非偶爾或斷斷續續）嗎？').setChoiceValues(['是', '否', '不適用']);
  form.addMultipleChoiceItem().setTitle('2. 他/她能記得最近發生的事情嗎？').setChoiceValues(['經常可以', '有時候', '很少/幾乎不能']);
  form.addMultipleChoiceItem().setTitle('3. 他/她能記住簡短的清單（例如買菜清單）嗎？').setChoiceValues(['經常可以', '有時候', '很少/幾乎不能']);
  form.addMultipleChoiceItem().setTitle('4. 過去一年中，其記憶力是否有減退現象？').setChoiceValues(['是', '否']);
  form.addMultipleChoiceItem().setTitle('5. 記憶減退是否已達到會干擾幾年前日常生活的程度（或影響退休前的活動）？').setChoiceValues(['是', '否']);
  form.addMultipleChoiceItem().setTitle('6. 他/她是否會在數週內完全忘記一件重大事件（例如旅行、喜宴、家庭聚會）？').setChoiceValues(['經常如此', '有時候', '很少/幾乎不會']);
  form.addMultipleChoiceItem().setTitle('7. 他/她是否會遺忘該重大事件的重要相關細節？').setChoiceValues(['經常如此', '有時候', '很少/幾乎不會']);
  form.addMultipleChoiceItem().setTitle('8. 他/她是否會完全忘記過去的重要資訊（如生日、結婚紀念日、工作地點）？').setChoiceValues(['經常如此', '有時候', '很少/幾乎不會']);
  form.addParagraphTextItem().setTitle('9. 請描述他/她生活中的近事（作為後續核對被評估者回答的基準）：')
    .setHelpText('請記錄：一週內事件（地點、時間、參與者、經過）以及一個月內事件。');
  form.addParagraphTextItem().setTitle('10-15. 觀察者所知之被評估者個人歷史（出生年月日/地點、最高學歷、主要職業、退休時間與原因）');
  form.addPageBreakItem().setTitle('觀察者訪談：定向力 (Orientation)');
  form.addGridItem().setTitle('他/她有多常能準確知道：')
    .setRows(['1. 今天幾號（日期）', '2. 目前月份', '3. 目前年份', '4. 星期幾', '5. 事件發生的先後時間順序關係', '6. 在熟悉的街道辨認方向/認路', '7. 在住家社區以外的地方往返兩地', '8. 在室內（如家中）認路及辨認方向'])
    .setColumns(['經常可以', '有時候', '很少/幾乎不能', '不知道']);
  form.addPageBreakItem().setTitle('觀察者訪談：判斷與解決問題能力 (Judgment & Problem Solving)');
  form.addMultipleChoiceItem().setTitle('1. 整體而言，評估他/她目前解決問題的能力：')
    .setChoiceValues(['跟以前一樣好', '還不錯，但不如以往', '普通 / 尚可', '不佳 / 差', '完全喪失能力']);
  form.addMultipleChoiceItem().setTitle('2. 處理小額金錢的能力（例如找零、計算秤重雜貨的費用）：').setChoiceValues(['無減退', '輕微減退', '嚴重減退']);
  form.addMultipleChoiceItem().setTitle('3. 處理複雜財務或商業往來的能力（例如結算支票簿、繳納各項帳單）：').setChoiceValues(['無減退', '輕微減退', '嚴重減退']);
  form.addMultipleChoiceItem().setTitle('4. 能否應對家庭緊急狀況（例如水管漏水、小火災）？')
    .setChoiceValues(['與以前一樣好', '比以前差（因為思考/認知困難）', '比以前差（其他原因）', '未曾遇過緊急狀況']);
  form.addMultipleChoiceItem().setTitle('5. 他/她能否理解情況或他人的解釋說明？').setChoiceValues(['經常可以', '有時候', '很少/幾乎不能', '不知道']);
  form.addMultipleChoiceItem().setTitle('6. 在社交場合與人際互動中，表現是否得體（符合其平時常態）？').setChoiceValues(['經常得體', '有時候', '很少/幾乎不得體', '不知道']);
  form.addPageBreakItem().setTitle('觀察者訪談：社區事務與參與 (Community Participation)');
  form.addMultipleChoiceItem().setTitle('1. 被評估者目前是否仍在工作？').setChoiceValues(['是', '否', '不適用']);
  form.addMultipleChoiceItem().setTitle('2. 記憶或思考問題是否促成退休的決定？').setChoiceValues(['是', '否', '不知道', '不適用']);
  form.addMultipleChoiceItem().setTitle('3. 在工作上是否因為記憶或思考問題而面臨顯著困難？').setChoiceValues(['很少或從未', '有時候', '經常如此', '不知道', '不適用']);
  form.addMultipleChoiceItem().setTitle('4. 駕駛/開車狀況：').setChoiceValues(['目前仍可安全駕駛，無明顯問題', '目前仍開車，但已出現風險或困難', '因記憶/思考問題而已停止開車', '因其他身體原因停止開車', '從不開車']);
  form.addMultipleChoiceItem().setTitle('6. 能否獨立購物採買日常所需？').setChoiceValues(['通常可以獨立完成', '有時可以（僅能買有限物品、會重複購買或漏買）', '很少或無法（每次購物均需有人陪同）']);
  form.addMultipleChoiceItem().setTitle('7. 能否獨立進行家外的各項活動？')
    .setChoiceValues(['通常可以（能有意義地參與社區活動，如自主去投票、參加團體）', '有時可以（僅限例行性活動，如去教堂、上理髮店）', '很少或無法（無他人協助時通常無法進行活動）', '不知道']);
  form.addMultipleChoiceItem().setTitle('8. 他/她是否會被帶去參加家庭以外的社交活動？').setChoiceValues(['是', '否']);
  form.addMultipleChoiceItem().setTitle('9. 一般旁人觀察其行為，是否會察覺其生病/不對勁？').setChoiceValues(['是（看得出來）', '否（看不出來）']);
  form.addPageBreakItem().setTitle('觀察者訪談：家事與嗜好 (Housework and Hobbies)');
  form.addParagraphTextItem().setTitle('處理家務能力的改變情況（目前仍能做好的家務為何）：');
  form.addParagraphTextItem().setTitle('進行休閒嗜好能力的改變情況（目前仍能維持的嗜好為何）：');
  form.addMultipleChoiceItem().setTitle('日常家務執行能力等級（評估者擇一評定）：')
    .setChoiceValues(['常態功能：各項日常家事功能正常維持', '稍減退：仍能參與以往活動，但未達以往水準', '部分獨立：僅能在部分項目獨立操作（如吸塵、準備簡單餐點）', '功能受限：僅能在極少數項目維持（如在督導下洗碗、擺餐具）', '無實質功能：無實質家務功能（僅能在大量監督下做簡單動作）']);
  form.addPageBreakItem().setTitle('觀察者訪談：個人照料 (Personal Care - Blessed Scale)');
  form.addMultipleChoiceItem().setTitle('A. 穿衣 (Dressing)').setChoiceValues(['0 - 完全自理', '1 - 偶爾扣錯鈕扣或順序微瑕', '2 - 順序經常錯誤、常漏穿衣物', '3 - 完全無法自行穿衣']);
  form.addMultipleChoiceItem().setTitle('B. 梳洗、個人衛生 (Washing, grooming)').setChoiceValues(['0 - 完全自理', '1 - 需要口頭提醒督促', '2 - 有時需要人身協助', '3 - 總是或幾乎總是需要他人協助']);
  form.addMultipleChoiceItem().setTitle('C. 進食習慣 (Eating habits)').setChoiceValues(['0 - 自行乾淨進食，能正確使用餐具', '1 - 動作凌亂；僅能使用湯匙', '2 - 僅能吃簡單固體食物', '3 - 完全需由他人餵食']);
  form.addMultipleChoiceItem().setTitle('D. 大小便控制 (Sphincter control)').setChoiceValues(['0 - 完全控制正常', '1 - 偶爾尿床/失禁', '2 - 經常尿床/失禁', '3 - 大小便完全失禁']);
  form.addPageBreakItem().setTitle('被評估者直接施測：記憶與定向');
  form.addMultipleChoiceItem().setTitle('被評估者自述：你覺得自己的記憶或思考有困難嗎？').setChoiceValues(['是', '否']);
  form.addMultipleChoiceItem().setTitle('請受試者回答近期生活事件（一週內）：').setChoiceValues(['1.0 - 大致正確', '0.5 - 部分正確', '0.0 - 大致錯誤 / 無法回答']);
  form.addMultipleChoiceItem().setTitle('請受試者回答近期生活事件（一個月內）：').setChoiceValues(['1.0 - 大致正確', '0.5 - 部分正確', '0.0 - 大致錯誤 / 無法回答']);
  form.addParagraphTextItem().setTitle('姓名與地址登錄記憶（施測詞：陳大華、台北市、中正區、中山路、100號）').setHelpText('記錄三次嘗試中，被評估者正確複誦之元素數量（滿分 5 分）');
  form.addGridItem().setTitle('被評估者定向力回答（評分）：')
    .setRows(['1. 今天的日期（幾號）', '2. 今天星期幾', '3. 現在是幾月份', '4. 今年是哪一年', '5. 這裡是什麼地方（場所名稱）', '6. 我們現在在什麼縣市/城鎮', '7. 現在大約幾點（時間）', '8. 能否正確認出陪同的親友身分'])
    .setColumns(['正確', '錯誤']);
  form.addPageBreakItem().setTitle('被評估者直接施測：判斷、類比與計算');
  form.addGridItem().setTitle('相似處、差異處與計算評分：')
    .setRows(['相似處：紅蘿蔔／花椰菜 (0:蔬菜, 1:可食/植物, 2:不相關)', '相似處：書桌／書櫃 (0:家具, 1:木製/有腳, 2:不相關)', '差異處：謊言／錯誤 (0:故意與無心, 1:一好一壞, 2:其他)', '差異處：河流／運河 (0:天然與人造, 2:其他)', '計算：一塊錢裡面有幾個一角？（或100元有幾個10元）', '計算：54元裡面有幾個2元？', '計算：從20連續減3（連續減算）'])
    .setColumns(['正確 (0分)', '部分正確 (1分)', '錯誤 (2分)']);
  form.addTextItem().setTitle('延遲記憶測驗：請被評估者再次說出剛才記住的姓名與地址（正確元素數量 0-5）');
  form.addMultipleChoiceItem().setTitle('被評估者病識感（對自身能力減退及為何受檢的理解）：')
    .setChoiceValues(['良好病識感 (Good Insight)', '部分病識感 (Partial Insight)', '幾乎無病識感 (Little Insight)']);
}

function phcepBuildVitalsQuestions_(form) {
  form.setDescription('請依實際測量結果填寫您的每日生理數據與身體狀況。身分連結僅依有效邀請碼。');
  form.setIsQuiz(false);
  form.addSectionHeaderItem().setTitle('基本資料與記錄時間').setHelpText('請確認記錄時間與您的身分識別。');
  form.addDateTimeItem().setTitle('測量記錄時間').setHelpText('請填寫實際測量時間，若為補登可手動調整。').setRequired(true);
  form.addPageBreakItem().setTitle('生理數值記錄 (血壓與血糖)');
  form.addTextItem().setTitle('收縮壓 (Systolic, mmHg)').setHelpText('例如：120');
  form.addTextItem().setTitle('舒張壓 (Diastolic, mmHg)').setHelpText('例如：80');
  form.addTextItem().setTitle('血糖數值 (Blood Sugar, mg/dL)').setHelpText('例如：100 (若無測量可留空)');
  form.addMultipleChoiceItem().setTitle('測量血糖的時間點：')
    .setChoiceValues(['空腹 (Fasting)', '飯後 2 小時 (Postprandial)', '隨機 / 不確定 (Random)', '未測量血糖 (N/A)']);
  form.addPageBreakItem().setTitle('神經與身體症狀自我評估');
  form.addGridItem().setTitle('今日是否有以下身體不適或神經學症狀？')
    .setRows(['1. 頭暈 / 暈眩 (Dizziness)', '2. 頭痛 (Headache)', '3. 手腳麻木 / 感覺異常 (Numbness)', '4. 步態不穩 / 容易跌倒 (Unsteadiness)', '5. 胸悶 / 心悸 (Chest tightness / Palpitations)', '6. 虛弱無力 (Weakness)'])
    .setColumns(['無 (None)', '輕微 (Mild)', '明顯/嚴重 (Significant)']);
  form.addParagraphTextItem().setTitle('其他症狀補充說明或用藥反應紀錄 (Optional)')
    .setHelpText('請簡單描述任何其他身體不適、服藥後的感受或想回報醫師的事項。');
}
