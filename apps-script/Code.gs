/**
 * -------------------------------------------------------------
 * 1. LINE Official Account Helpers
 * -------------------------------------------------------------
 */

const QA_CACHE_KEY = 'qa-index-v3';
const QA_CACHE_SECONDS = 600;
const QA_HEADERS = ['Question', 'Answer', 'Keywords', 'Enabled', 'Q_VEC', 'A_VEC', 'Updated At'];
const UNMATCHED_HEADERS = ['Timestamp', 'User ID', 'User Name', 'Message', 'Best Score', 'Best Question'];

// Fetch LINE user display name
function getLineUserName(userId, channelAccessToken) {
  if (!userId || !channelAccessToken) return '';
  try {
    const url = 'https://api.line.me/v2/bot/profile/' + encodeURIComponent(userId);
    const response = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: { Authorization: 'Bearer ' + channelAccessToken },
      muteHttpExceptions: true
    });
    if (response.getResponseCode() === 200) {
      const data = JSON.parse(response.getContentText());
      return data.displayName || '';
    }
  } catch (err) {
    console.error('Failed to get user name:', err);
  }
  return '';
}

// Push message to LINE user
function pushLineMessage(userId, messageText, channelAccessToken) {
  if (!userId || !messageText || !channelAccessToken) return false;
  try {
    const url = 'https://api.line.me/v2/bot/message/push';
    const payload = {
      to: userId,
      messages: [{ type: 'text', text: messageText }]
    };
    const response = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + channelAccessToken },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    return response.getResponseCode() === 200;
  } catch (err) {
    console.error('Failed to push LINE message:', err);
    return false;
  }
}

function replyLineMessage(replyToken, messageText, channelAccessToken) {
  if (!replyToken || !messageText || !channelAccessToken) return false;
  try {
    const response = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/reply', {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + channelAccessToken },
      payload: JSON.stringify({
        replyToken: replyToken,
        messages: [{ type: 'text', text: messageText }]
      }),
      muteHttpExceptions: true
    });
    return response.getResponseCode() === 200;
  } catch (err) {
    console.error('Failed to reply LINE message:', err);
    return false;
  }
}

function getUserProfile(userId) {
  const token = PropertiesService.getScriptProperties().getProperty('LINE_CHANNEL_ACCESS_TOKEN');
  if (!userId || !token) return '';

  const url = 'https://api.line.me/v2/bot/profile/' + userId;
  const response = UrlFetchApp.fetch(url, {
    headers: {
      Authorization: 'Bearer ' + token
    },
    muteHttpExceptions: true
  });

  if (response.getResponseCode() === 200) {
    const data = JSON.parse(response.getContentText());
    return data.displayName;
  }
  return ''; // Returns empty if profile cannot be fetched
}

/**
 * -------------------------------------------------------------
 * 2. InstallOnEdit Trigger: Shift content rightward & lock pointer in Col F
 * -------------------------------------------------------------
 */
function installonEdit(e) {
  if (!e || !e.range) return;

  const range = e.range;
  const sheet = range.getSheet();

  // Only run on the main conversation sheet
  if (sheet.getName() !== '工作表1') return;

  const row = range.getRow();
  const col = range.getColumn();

  // Trigger when editing Column F (Column 6) below header
  if (col === 6 && row > 1) {
    const enteredText = String(e.value || range.getValue() || '').trim();
    if (!enteredText) return;

    // 1. Send reply via LINE Push API
    const userId = sheet.getRange(row, 2).getValue(); // Col B: User ID
    const token = PropertiesService.getScriptProperties().getProperty('LINE_CHANNEL_ACCESS_TOKEN');
    if (userId && token) {
      pushLineMessage(userId, enteredText, token);
    }

    // 2. Shift existing replies (G onwards) one cell rightward, latest stays at G
    appendReplyHistory_(sheet, row, enteredText);

    // 3. Clear Column F so it acts as an open input box
    range.clearContent();

    // 4. Pointer Lock: Keep cursor focused in the exact same cell in Column F
    SpreadsheetApp.flush();
    range.activate();
  }
}

/**
 * -------------------------------------------------------------
 * 3. QA Sync, Similarity Matching, and Admin Helpers
 * -------------------------------------------------------------
 */
function jsonResponse_(body) {
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON);
}

function getActiveSpreadsheet_() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function getMainSheet_(ss) {
  return ss.getSheetByName('工作表1') || ss.getSheets()[0];
}

function ensureSheetHeaders_(sheet, headers) {
  if (!sheet) return;
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
}

function getOrCreateQASheet(ss) {
  let qaSheet = ss.getSheetByName('QA') || ss.getSheetByName('QA_BASE');
  if (!qaSheet) {
    qaSheet = ss.insertSheet('QA');
  }
  ensureSheetHeaders_(qaSheet, QA_HEADERS);
  return qaSheet;
}

function getOrCreateUnmatchedSheet_(ss) {
  let sheet = ss.getSheetByName('UNMATCHED_QA');
  if (!sheet) {
    sheet = ss.insertSheet('UNMATCHED_QA');
  }
  ensureSheetHeaders_(sheet, UNMATCHED_HEADERS);
  return sheet;
}

function appendReplyHistory_(sheet, row, messageText) {
  if (!sheet || !row || !messageText) return;
  const lastCol = Math.max(sheet.getLastColumn(), 7);
  if (lastCol >= 7) {
    const numHistoryCols = lastCol - 7 + 1;
    const historyRange = sheet.getRange(row, 7, 1, numHistoryCols);
    const existingReplies = historyRange.getValues()[0];
    sheet.getRange(row, 7, 1, numHistoryCols + 1).setValues([[messageText].concat(existingReplies)]);
  } else {
    sheet.getRange(row, 7).setValue(messageText);
  }
}

function getScriptProperty_(name, fallback) {
  const value = PropertiesService.getScriptProperties().getProperty(name);
  return value == null || value === '' ? fallback : value;
}

function getQaThreshold_() {
  const raw = parseFloat(getScriptProperty_('QA_THRESHOLD', '0.35'));
  return isNaN(raw) ? 0.35 : raw;
}

function getQaReplyField_() {
  return String(getScriptProperty_('QA_REPLY_FIELD', 'ANSWER')).toUpperCase();
}

function clearQaCache_() {
  try {
    CacheService.getScriptCache().remove(QA_CACHE_KEY);
  } catch (err) {
    console.warn('Unable to clear QA cache:', err);
  }
}

function listQaPairs_(ss) {
  const qaSheet = getOrCreateQASheet(ss);
  const lastRow = qaSheet.getLastRow();
  if (lastRow <= 1) return [];
  const rows = qaSheet.getRange(2, 1, lastRow - 1, QA_HEADERS.length).getValues();
  return rows
    .filter(function(row) {
      return String(row[0] || '').trim();
    })
    .map(function(row) {
      return {
        question: String(row[0] || ''),
        answer: String(row[1] || ''),
        keywords: String(row[2] || ''),
        enabled: row[3] !== false && String(row[3] || '').toUpperCase() !== 'FALSE' && String(row[3] || '') !== '0',
        q_vec: row[4] || '',
        a_vec: row[5] || '',
        updatedAt: row[6] || ''
      };
    });
}

function upsertQaPairs_(items, ss, options) {
  const qaSheet = getOrCreateQASheet(ss);
  const overwrite = !!(options && options.overwrite);
  const normalizedItems = (items || []).map(function(item) {
    return {
      question: String(item.question || '').trim(),
      answer: String(item.answer || '').trim(),
      keywords: String(item.keywords || '').trim(),
      enabled: item.enabled === false || String(item.enabled).toLowerCase() === 'false' ? 'FALSE' : 'TRUE',
      q_vec: typeof item.q_vec === 'object' ? JSON.stringify(item.q_vec) : String(item.q_vec || ''),
      a_vec: typeof item.a_vec === 'object' ? JSON.stringify(item.a_vec) : String(item.a_vec || ''),
      updatedAt: new Date()
    };
  }).filter(function(item) {
    return item.question;
  });

  if (overwrite) {
    const keepRows = normalizedItems.map(function(item) {
      return [item.question, item.answer, item.keywords, item.enabled, item.q_vec, item.a_vec, item.updatedAt];
    });
    qaSheet.clearContents();
    ensureSheetHeaders_(qaSheet, QA_HEADERS);
    if (keepRows.length > 0) {
      qaSheet.getRange(2, 1, keepRows.length, QA_HEADERS.length).setValues(keepRows);
    }
    clearQaCache_();
    return { inserted: keepRows.length, updated: 0, total: keepRows.length };
  }

  const existingLastRow = qaSheet.getLastRow();
  const existingRows = existingLastRow > 1
    ? qaSheet.getRange(2, 1, existingLastRow - 1, QA_HEADERS.length).getValues()
    : [];
  const existingMap = {};

  existingRows.forEach(function(row, index) {
    const question = String(row[0] || '').trim();
    if (question) {
      existingMap[question] = index + 2;
    }
  });

  let inserted = 0;
  let updated = 0;
  const nextRows = existingRows.slice();

  normalizedItems.forEach(function(item) {
    const rowValues = [item.question, item.answer, item.keywords, item.enabled, item.q_vec, item.a_vec, item.updatedAt];
    const existingRow = existingMap[item.question];
    if (existingRow) {
      nextRows[existingRow - 2] = rowValues;
      updated += 1;
    } else {
      nextRows.push(rowValues);
      inserted += 1;
    }
  });

  if (existingLastRow > 1) {
    qaSheet.getRange(2, 1, existingLastRow - 1, QA_HEADERS.length).clearContent();
  }
  if (nextRows.length > 0) {
    qaSheet.getRange(2, 1, nextRows.length, QA_HEADERS.length).setValues(nextRows);
  }

  clearQaCache_();
  return { inserted: inserted, updated: updated, total: nextRows.length };
}

function loadQaIndex_(ss) {
  const cache = CacheService.getScriptCache();
  try {
    const cached = cache.get(QA_CACHE_KEY);
    if (cached) {
      return JSON.parse(cached);
    }
  } catch (err) {
    console.warn('Failed to read QA cache:', err);
  }

  const pairs = listQaPairs_(ss).filter(function(item) {
    return item.enabled;
  });
  const index = SimilarityUtils.buildIndex(pairs);

  try {
    cache.put(QA_CACHE_KEY, JSON.stringify(index), QA_CACHE_SECONDS);
  } catch (err) {
    console.warn('Failed to write QA cache:', err);
  }

  return index;
}

function resolveReplyText_(item) {
  if (!item) return '';
  const mode = getQaReplyField_();
  if (mode === 'QUESTION') {
    return item.question || '';
  }
  if (mode === 'QUESTION_AND_ANSWER') {
    return [item.question, item.answer].filter(Boolean).join('\n');
  }
  return item.answer || item.question || '';
}

function logUnmatchedQuestion_(ss, userId, userName, message, bestScore, bestQuestion) {
  const sheet = getOrCreateUnmatchedSheet_(ss);
  sheet.appendRow([new Date(), userId || '', userName || '', message || '', bestScore || 0, bestQuestion || '']);
}

function handleQaAdminAction_(action, payload, ss) {
  if (action === 'health') {
    return jsonResponse_({
      status: 'ok',
      qaCount: listQaPairs_(ss).length,
      threshold: getQaThreshold_()
    });
  }

  if (action === 'list_qa') {
    return jsonResponse_({ status: 'success', items: listQaPairs_(ss) });
  }

  if (action === 'sync_qa' || action === 'upsert_qa') {
    const items = Array.isArray(payload)
      ? payload
      : Array.isArray(payload.items)
        ? payload.items
        : payload.question
          ? [payload]
          : [];
    const result = upsertQaPairs_(items, ss, { overwrite: action === 'sync_qa' || payload.overwrite === true });
    return jsonResponse_(Object.assign({ status: 'success' }, result));
  }

  return jsonResponse_({ status: 'error', message: 'Unsupported action' });
}

function isAuthorized_(payload, e) {
  const expectedSecret = getScriptProperty_('GS_WEBAPP_SECRET', '');
  if (!expectedSecret) return false;
  const payloadSecret = payload && payload.secret;
  const paramSecret = e && e.parameter && e.parameter.secret;
  return payloadSecret === expectedSecret || paramSecret === expectedSecret;
}

function parseRequestBody_(e) {
  if (!e || !e.postData || !e.postData.contents) {
    return {};
  }
  try {
    return JSON.parse(e.postData.contents);
  } catch (err) {
    console.warn('Invalid JSON payload:', err);
    return {};
  }
}

function getAction_(e, payload) {
  return (e && e.parameter && e.parameter.action) || (payload && payload.action) || '';
}

function matchQaPair_(message, ss) {
  const index = loadQaIndex_(ss);
  if (!index || !index.items || index.items.length === 0) {
    return { match: null, score: 0, bestQuestion: '' };
  }

  const result = SimilarityUtils.findBestMatch(message, index, {
    threshold: getQaThreshold_()
  });

  return {
    match: result.match,
    score: result.score,
    bestQuestion: result.bestQuestion || ''
  };
}

/**
 * -------------------------------------------------------------
 * 4. Main Webhook Handler (doGet / doPost)
 * -------------------------------------------------------------
 */
function doGet(e) {
  const ss = getActiveSpreadsheet_();
  const payload = {};
  const action = getAction_(e, payload);
  if (action === 'health' || action === 'list_qa') {
    if (!isAuthorized_(payload, e)) {
      return jsonResponse_({ status: 'error', message: 'Unauthorized' });
    }
    return handleQaAdminAction_(action, payload, ss);
  }
  return jsonResponse_({ status: 'ok' });
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (lockErr) {
    return jsonResponse_({ status: 'error', message: 'Lock timeout' });
  }

  const ss = getActiveSpreadsheet_();
  const mainSheet = getMainSheet_(ss);

  try {
    const payload = parseRequestBody_(e);
    const action = getAction_(e, payload);

    if (action === 'health' || action === 'sync_qa' || action === 'upsert_qa' || action === 'list_qa') {
      if (!isAuthorized_(payload, e)) {
        return jsonResponse_({ status: 'error', message: 'Unauthorized' });
      }
      return handleQaAdminAction_(action, payload, ss);
    }

    // Route 2: LINE Webhook
    const events = payload.events;
    if (!events || events.length === 0) {
      return ContentService.createTextOutput('OK');
    }

    const channelAccessToken = getScriptProperty_('LINE_CHANNEL_ACCESS_TOKEN', '');
    const cache = CacheService.getScriptCache();
    const existingIdSet = {};
    const lastRow = mainSheet.getLastRow();

    if (lastRow > 1) {
      const rawIds = mainSheet.getRange(2, 1, lastRow - 1, 1).getValues();
      rawIds.forEach(function(row) {
        if (row[0]) existingIdSet[String(row[0]).trim()] = true;
      });
    }

    events.forEach(function(event) {
      if (event.type !== 'message' || !event.message || event.message.type !== 'text') {
        return;
      }

      const messageId = String(event.message.id || '').trim();
      if (messageId) {
        if (cache.get(messageId) || existingIdSet[messageId]) {
          cache.put(messageId, '1', 21600);
          return;
        }
        cache.put(messageId, '1', 21600);
        existingIdSet[messageId] = true;
      }

      const userId = event.source && event.source.userId ? event.source.userId : '';
      const time = new Date(event.timestamp || Date.now());
      const message = event.message.text || '';
      const userName = getLineUserName(userId, channelAccessToken);
      const reply = ''; // Column F remains clear for new replies

      // Row Format: A: MESSAGE_ID | B: ID | C: TIME | D: NAME | E: MESSAGE | F: REPLY
      mainSheet.appendRow([messageId, userId, time, userName, message, reply]);
      const currentRow = mainSheet.getLastRow();

      const qaResult = matchQaPair_(message, ss);
      const matchedText = resolveReplyText_(qaResult.match);
      const fallbackReply = String(getScriptProperty_('DEFAULT_FALLBACK_REPLY', '') || '').trim();
      const replyText = matchedText || fallbackReply;

      if (replyText && event.replyToken && channelAccessToken) {
        const sent = replyLineMessage(event.replyToken, replyText, channelAccessToken);
        if (sent) {
          appendReplyHistory_(mainSheet, currentRow, replyText);
        }
      }

      if (!matchedText) {
        logUnmatchedQuestion_(ss, userId, userName, message, qaResult.score, qaResult.bestQuestion);
      }
    });

    return jsonResponse_({ status: 'success' });
  } catch (error) {
    try {
      mainSheet.appendRow(['ERROR', error.name, new Date(), 'Script Error', error.message, '']);
    } catch (_) {}

    return jsonResponse_({ status: 'error', message: error.message });
  } finally {
    lock.releaseLock();
  }
}
