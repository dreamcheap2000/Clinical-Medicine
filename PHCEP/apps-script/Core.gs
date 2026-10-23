function phcepJson_(result) {
  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

function phcepAuthenticate_(e) {
  var secret = phcepProperty_('GATEWAY_SIGNING_SECRET');
  var lineSecret = phcepProperty_('LINE_CHANNEL_SECRET');
  if (secret.length < 32 || !lineSecret || secret === lineSecret) phcepFail_('CONFIGURATION');
  var envelope;
  try {
    envelope = JSON.parse(e.postData.contents);
  } catch (ignored) {
    phcepFail_('INVALID_ENVELOPE');
  }
  if (!envelope || Array.isArray(envelope) ||
      Object.keys(envelope).sort().join(',') !==
        'action,nonce,rawBody,signature,timestamp,version' ||
      envelope.version !== 1 || envelope.action !== 'events' ||
      typeof envelope.timestamp !== 'number' || !Number.isSafeInteger(envelope.timestamp) ||
      typeof envelope.nonce !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(envelope.nonce) ||
      typeof envelope.rawBody !== 'string' || typeof envelope.signature !== 'string')
    phcepFail_('INVALID_ENVELOPE');
  if (envelope.rawBody.length > 1398104) phcepFail_('INVALID_PAYLOAD');
  if (Math.abs(Date.now() - envelope.timestamp) > 300000) phcepFail_('EXPIRED');
  var canonical = '1\n' + envelope.action + '\n' + envelope.timestamp + '\n' +
    envelope.nonce + '\n' + envelope.rawBody;
  var expected = Utilities.base64Encode(Utilities.computeHmacSha256Signature(
    canonical, secret, Utilities.Charset.UTF_8));
  var mismatch = expected.length ^ envelope.signature.length;
  for (var i = 0; i < expected.length; i++)
    mismatch |= expected.charCodeAt(i) ^ (envelope.signature.charCodeAt(i) || 0);
  if (mismatch) phcepFail_('AUTHENTICATION');
  var payload;
  try {
    var bytes = Utilities.base64Decode(envelope.rawBody);
    if (bytes.length > 1048576) phcepFail_('INVALID_PAYLOAD');
    if (Utilities.base64Encode(bytes) !== envelope.rawBody) phcepFail_('INVALID_PAYLOAD');
    var text = Utilities.newBlob(bytes).getDataAsString('UTF-8');
    if (Utilities.base64Encode(Utilities.newBlob(text).getBytes()) !== envelope.rawBody)
      phcepFail_('INVALID_PAYLOAD');
    payload = JSON.parse(text);
  } catch (ignored) {
    phcepFail_('INVALID_PAYLOAD');
  }
  if (!payload || !Array.isArray(payload.events) || payload.events.length > 100)
    phcepFail_('INVALID_PAYLOAD');
  return { envelope: envelope, events: payload.events };
}

function doPost(e) {
  try {
    var request = phcepAuthenticate_(e);
    return phcepWithLock_(function () {
      var ss = phcepSpreadsheet_();
      phcepConsumeNonce_(ss, request.envelope.nonce, request.envelope.timestamp);
      request.events.forEach(function (event) { phcepAcceptEvent_(ss, event); });
      return phcepJson_({ ok: true });
    });
  } catch (error) {
    var allowed = ['CONFIGURATION', 'INVALID_ENVELOPE', 'EXPIRED', 'AUTHENTICATION',
      'INVALID_PAYLOAD', 'REPLAY', 'BUSY', 'MEDIA_FAILED'];
    var code = error && allowed.indexOf(error.phcepCode) !== -1 ?
      error.phcepCode : 'ACCEPTANCE_FAILED';
    return phcepJson_({ ok: false, error: code });
  }
}

function phcepProfile_(userId) {
  if (!userId) return '';
  try {
    var token = phcepProperty_('LINE_CHANNEL_ACCESS_TOKEN', ['CHANNEL_ACCESS_TOKEN']);
    if (!token) return '';
    var response = UrlFetchApp.fetch(
      'https://api.line.me/v2/bot/profile/' + encodeURIComponent(userId), {
        headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true
      });
    if (response.getResponseCode() !== 200) return '';
    var profile = JSON.parse(response.getContentText());
    return typeof profile.displayName === 'string' ? profile.displayName.slice(0, 1000) : '';
  } catch (ignored) {
    return '';
  }
}

function phcepMedia_(message) {
  var folderId = phcepProperty_('IMAGE_FOLDER_ID', ['DRIVE_FOLDER_ID']);
  var token = phcepProperty_('LINE_CHANNEL_ACCESS_TOKEN', ['CHANNEL_ACCESS_TOKEN']);
  if (!folderId || !token) phcepFail_('CONFIGURATION');
  var folder = DriveApp.getFolderById(folderId);
  if (folder.getSharingAccess() !== DriveApp.Access.PRIVATE) phcepFail_('CONFIGURATION');
  var name = 'LINE_' + phcepDigest_(String(message.id)).replace(/[+/=]/g, '_');
  var files = folder.getFilesByName(name);
  var file;
  if (files.hasNext()) {
    file = files.next();
  } else {
    var response = UrlFetchApp.fetch(
      'https://api-data.line.me/v2/bot/message/' + encodeURIComponent(message.id) + '/content', {
        headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true
      });
    if (response.getResponseCode() !== 200) phcepFail_('MEDIA_FAILED');
    file = folder.createFile(response.getBlob().setName(name));
  }
  if (file.getSharingAccess() !== DriveApp.Access.PRIVATE) phcepFail_('CONFIGURATION');
  return file.getUrl();
}

function phcepAcceptEvent_(ss, event) {
  if (!event || typeof event.type !== 'string') phcepFail_('INVALID_PAYLOAD');
  var message = event.message;
  var safeId = /^[A-Za-z0-9_-]{1,128}$/;
  if (event.webhookEventId != null &&
      (typeof event.webhookEventId !== 'string' || !safeId.test(event.webhookEventId)))
    phcepFail_('INVALID_PAYLOAD');
  if (event.type === 'message' && (!message || typeof message.id !== 'string' ||
      !safeId.test(message.id) || typeof message.type !== 'string'))
    phcepFail_('INVALID_PAYLOAD');
  if (event.type !== 'message' && !event.webhookEventId) phcepFail_('INVALID_PAYLOAD');
  var key = 'event:' + (event.webhookEventId || message.id);
  var messageId = event.type === 'message' ? message.id : '';
  var journal = phcepSheet_(ss, 'PHCEP事件');
  var rows = phcepRows_(journal, 4);
  var journalRow = 0;
  for (var i = 0; i < rows.length; i++) {
    if (rows[i][0] === key) {
      journalRow = i + 2;
      if (rows[i][1] === 'COMPLETE') return;
      break;
    }
  }
  if (!journalRow) {
    journalRow = journal.getLastRow() + 1;
    journal.getRange(journalRow, 1, 1, 4).setValues([[
      key, 'RECEIVED', messageId, new Date()
    ]]);
    SpreadsheetApp.flush();
  }
  if (event.type !== 'message') {
    journal.getRange(journalRow, 2, 1, 3).setValues([['COMPLETE', '', new Date()]]);
    SpreadsheetApp.flush();
    return;
  }
  var inbox = phcepSheet_(ss, 'LINE對話');
  var existing = phcepRows_(inbox, 11);
  var inboxRow = 0;
  for (var j = 0; j < existing.length; j++) {
    if (existing[j][10] === key || String(existing[j][0]) === phcepLiteral_(message.id)) {
      inboxRow = j + 2;
      break;
    }
  }
  if (!inboxRow) {
    var userId = event.source && typeof event.source.userId === 'string' ?
      event.source.userId : '';
    var text = '';
    var url = '';
    var label = '';
    if (message.type === 'text') {
      if (typeof message.text !== 'string') phcepFail_('INVALID_PAYLOAD');
      text = message.text;
      var match = text.match(/https?:\/\/[^\s]+/i);
      if (match) { url = match[0]; label = '開啟連結'; }
    } else if (['image', 'video', 'audio', 'file'].indexOf(message.type) !== -1) {
      url = phcepMedia_(message);
      text = { image: '圖片', video: '影片', audio: '音訊', file: '檔案' }[message.type];
      label = message.fileName || '檢視檔案';
    } else {
      text = '其他訊息';
    }
    var profile = phcepProfile_(userId);
    inbox.insertRowsAfter(1, 1);
    inboxRow = 2;
    // A row inserted under the header inherits its bold/blue styling.
    inbox.getRange(inboxRow, 1, 1, inbox.getMaxColumns()).setFontWeight('normal').setBackground(null);
    inbox.getRange(inboxRow, 1, 1, 11).setValues([[
      phcepLiteral_(message.id), false, phcepLiteral_(userId),
      new Date(typeof event.timestamp === 'number' ? event.timestamp : Date.now()),
      phcepLiteral_(profile), phcepLiteral_(text), '', '', '', '',
      phcepLiteral_(key)
    ]]);
    SpreadsheetApp.flush();
    journal.getRange(journalRow, 2).setValue('STORED');
  }
  phcepApplyLineValidations_(inbox, phcepLineLayout_(inbox), inboxRow);
  // Rebuild the optional link after a crash between the row write and decoration.
  var link = inbox.getRange(inboxRow, 7);
  if (!link.getValue()) {
    var linkUrl = url || '';
    var linkLabel = label || '';
    if (!linkUrl && ['image', 'video', 'audio', 'file'].indexOf(message.type) !== -1) {
      linkUrl = phcepMedia_(message);
      linkLabel = message.fileName || '檢視檔案';
    } else if (!linkUrl && message.type === 'text') {
      var found = message.text.match(/https?:\/\/[^\s]+/i);
      if (found) { linkUrl = found[0]; linkLabel = '開啟連結'; }
    }
    if (linkUrl) link.setRichTextValue(SpreadsheetApp.newRichTextValue()
      .setText(String(linkLabel)).setLinkUrl(linkUrl).build());
  }
  if (message.type === 'text') {
    // Bounded local lexical suggestions only (no network); never blocks ingestion or sends.
    try {
      phcepApplySuggestions_(ss, inbox, inboxRow, message.text);
    } catch (ignored) {}
  }
  journal.getRange(journalRow, 2, 1, 3).setValues([[
    'COMPLETE', phcepLiteral_(message.id), new Date()
  ]]);
  SpreadsheetApp.flush();
}
