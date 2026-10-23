/** Runtime storage always uses the configured spreadsheet, never the active UI. */
function phcepProperty_(name, aliases) {
  var properties = PropertiesService.getScriptProperties();
  var names = [name].concat(aliases || []);
  for (var i = 0; i < names.length; i++) {
    var value = properties.getProperty(names[i]);
    if (value && value.trim()) return value.trim();
  }
  return '';
}

function phcepSpreadsheet_() {
  var id = phcepProperty_('SPREADSHEET_ID');
  if (!id) phcepFail_('CONFIGURATION');
  return SpreadsheetApp.openById(id);
}

function phcepFail_(code) {
  var error = new Error(code);
  error.phcepCode = code;
  throw error;
}

function phcepLiteral_(text) {
  var value = String(text == null ? '' : text);
  return /^[\s]*[=+\-@]|^[\t\r\n]/.test(value) ? "'" + value : value;
}

var phcepLockDepth_ = 0;
function phcepWithLock_(fn) {
  if (phcepLockDepth_) return fn();
  var lock = LockService.getScriptLock();
  var acquired = false;
  try {
    acquired = lock.tryLock(0);
    if (!acquired) phcepFail_('BUSY');
    phcepLockDepth_++;
    return fn();
  } finally {
    if (acquired) {
      phcepLockDepth_--;
      lock.releaseLock();
    }
  }
}

function phcepSheet_(ss, name) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) phcepFail_('CONFIGURATION');
  return sheet;
}

function phcepRows_(sheet, columns) {
  var count = sheet.getLastRow() - 1;
  return count > 0 ? sheet.getRange(2, 1, count, columns).getValues() : [];
}

function phcepDigest_(value) {
  return Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256, value, Utilities.Charset.UTF_8)
    .map(function (byte) { return ('0' + (byte & 255).toString(16)).slice(-2); }).join('');
}

function phcepConsumeNonce_(ss, nonce, timestamp) {
  var sheet = phcepSheet_(ss, 'PHCEP請求');
  var digest = phcepDigest_(nonce.toLowerCase());
  var rows = phcepRows_(sheet, 2);
  for (var i = 0; i < rows.length; i++) {
    if (rows[i][0] === digest) phcepFail_('REPLAY');
  }
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, 2)
    .setValues([[digest, new Date(timestamp + 300000)]]);
  SpreadsheetApp.flush();
}

/** Operator maintenance: only expired nonce hashes; retain event/outbox journals. */
function phcepCleanupExpiredNonces() {
  return phcepWithLock_(function () {
    var sheet = phcepSheet_(phcepSpreadsheet_(), 'PHCEP請求');
    var rows = phcepRows_(sheet, 2);
    var removed = 0;
    var now = Date.now();
    for (var i = rows.length - 1; i >= 0; i--) {
      var expires = rows[i][1] instanceof Date ? rows[i][1].getTime() : NaN;
      // Small grace keeps cleanup safe at the inclusive authentication boundary.
      if (Number.isFinite(expires) && expires < now - 60000) {
        sheet.deleteRow(i + 2);
        removed++;
      }
    }
    SpreadsheetApp.flush();
    return { ok: true, removed: removed };
  });
}

function phcepLineHttpError_(code, body) {
  if (code === 429 && /monthly limit/i.test(body || '')) return 'LINE_MONTHLY_QUOTA_EXCEEDED';
  return 'LINE_HTTP_' + code;
}

/** Read-only LINE checks: no patient data, messages, tokens or response bodies are logged. */
function diagnosePHCEPLineSend() {
  phcepAuthorizeClinician_();
  var token = phcepProperty_('LINE_CHANNEL_ACCESS_TOKEN', ['CHANNEL_ACCESS_TOKEN']);
  var report = { tokenConfigured: !!token };
  if (!token) {
    report.error = 'LINE_TOKEN_MISSING';
  } else {
    ['info', 'message/quota', 'message/quota/consumption'].forEach(function(endpoint) {
      var name = endpoint === 'info' ? 'authentication' :
        endpoint === 'message/quota' ? 'quota' : 'consumption';
      var response;
      try {
        response = UrlFetchApp.fetch('https://api.line.me/v2/bot/' + endpoint, {
          headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true
        });
      } catch (error) {
        report[name] = { error: 'LINE_FETCH_FAILED' };
        return;
      }
      var code = response.getResponseCode();
      report[name] = { httpStatus: code };
      if (code !== 200) {
        report[name].error = phcepLineHttpError_(code, response.getContentText());
      } else if (name !== 'authentication') {
        try {
          var data = JSON.parse(response.getContentText());
          if (name === 'quota' && data.type === 'none') report[name].unlimited = true;
          else {
            var value = name === 'quota' ? data.value : data.totalUsage;
            if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
              throw new Error('Invalid quota response');
            }
            report[name].messages = value;
          }
        } catch (error) {
          report[name].error = 'LINE_INVALID_RESPONSE';
        }
      }
    });
    if (report.quota.messages !== undefined && report.consumption.messages !== undefined) {
      report.monthlyQuotaReached = report.consumption.messages >= report.quota.messages;
    }
  }
  console.log(JSON.stringify(report));
  return report;
}

/** Caller must hold phcepWithLock_; persist the retry key before any HTTP send. */
function phcepPush_(key, userId, messages) {
  if (!phcepLockDepth_) phcepFail_('LOCK_REQUIRED');
  if (typeof key !== 'string' || !key || typeof userId !== 'string' || !userId ||
      !/^U[0-9a-f]{32}$/.test(userId) ||
      !Array.isArray(messages) || !messages.length ||
      messages.length > 5) return { ok: false, error: 'INVALID_OUTBOUND' };
  var sheet = phcepSheet_(phcepSpreadsheet_(), 'PHCEP寄件匣');
  var storedKey = phcepDigest_(String(key));
  var rows = phcepRows_(sheet, 8);
  var row = 0;
  var record;
  for (var i = 0; i < rows.length; i++) {
    if (rows[i][0] === storedKey) {
      row = i + 2;
      record = rows[i];
      break;
    }
  }
  var json = JSON.stringify(messages);
  if (record) {
    if (record[3] !== userId || record[4] !== json)
      return { ok: false, error: 'OUTBOUND_CONFLICT' };
    if (record[2] === 'SENT') return { ok: true };
    if (record[2] === 'AMBIGUOUS_EXPIRED') return { ok: false, error: 'AMBIGUOUS_EXPIRED' };
    var created = record[7] instanceof Date ? record[7].getTime() : NaN;
    if (!Number.isFinite(created) || Date.now() - created > 23 * 60 * 60 * 1000) {
      sheet.getRange(row, 3).setValue('AMBIGUOUS_EXPIRED');
      sheet.getRange(row, 6, 1, 2).setValues([[new Date(), 'AMBIGUOUS_EXPIRED']]);
      SpreadsheetApp.flush();
      return { ok: false, error: 'AMBIGUOUS_EXPIRED' };
    }
  } else {
    row = sheet.getLastRow() + 1;
    record = [storedKey, Utilities.getUuid(), 'PENDING',
      userId, json, new Date(), '', new Date()];
    sheet.getRange(row, 1, 1, 8).setValues([record]);
  }
  SpreadsheetApp.flush();
  var accepted = false;
  var sendError = 'LINE_TOKEN_MISSING';
  var token = phcepProperty_('LINE_CHANNEL_ACCESS_TOKEN', ['CHANNEL_ACCESS_TOKEN']);
  try {
    if (token) {
      sendError = 'LINE_FETCH_FAILED';
      var response = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
        method: 'post',
        contentType: 'application/json',
        headers: { Authorization: 'Bearer ' + token, 'X-Line-Retry-Key': record[1] },
        payload: JSON.stringify({ to: userId, messages: messages }),
        muteHttpExceptions: true
      });
      var code = response.getResponseCode();
      var headers = response.getAllHeaders();
      var retryAccepted = Object.keys(headers).some(function (name) {
        return name.toLowerCase() === 'x-line-accepted-request-id' && !!headers[name];
      });
      accepted = (code >= 200 && code < 300) || (code === 409 && retryAccepted);
      if (!accepted) sendError = phcepLineHttpError_(code, response.getContentText());
    }
  } catch (ignored) {
    accepted = false;
  }
  sheet.getRange(row, 3).setValue(accepted ? 'SENT' : 'FAILED');
  sheet.getRange(row, 6, 1, 2).setValues([[new Date(), accepted ? '' : sendError]]);
  SpreadsheetApp.flush();
  return accepted ? { ok: true } : { ok: false, error: sendError };
}
