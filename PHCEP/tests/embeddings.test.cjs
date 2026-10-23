const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
function harness(properties, rows = [], compact = false) {
  const requests = [];
  const writes = [];
  const headers = compact ?
    ['ID', '重要性分級 (1-5)', '訊息', 'Line Friend 連結備註', '回覆', '連結備註',
      '問題 Embedding', '回覆 Embedding', '備註 Embedding', '行內使用次數', '全域使用次數'] :
    ['ID', '重要性分級 (1-5)', '訊息', 'LINE Friend 訊息 1', 'LINE Friend 訊息 2', 'Line Friend 連結備註',
      '回覆', '檔案/媒體連結', '檔案/網址名稱', '連結備註', '問題 Embedding', '回覆 Embedding', '備註 Embedding', '行內使用次數', '全域使用次數'];
  const sheet = {
    getLastRow: () => rows.length + 1,
    getLastColumn: () => headers.length,
    getRange: (...args) => ({
      getValues: () => args[0] === 1 ? [headers] : rows,
      setValue: value => writes.push([args, value])
    })
  };
  const context = vm.createContext({
    phcepAuthorizeClinician_: () => {},
    phcepProperty_: name => properties[name],
    phcepWithLock_: callback => callback(),
    phcepSpreadsheet_: () => ({ getSheetByName: () => sheet }),
    SpreadsheetApp: { flush() {} },
    UrlFetchApp: { fetch: (url, options) => {
      requests.push([url, options]);
      return { getResponseCode: () => 200, getContentText: () => '{"embedding":{"values":[0.1,0.2]}}' };
    } }
  });
  for (const file of ['Matcher.gs', 'Embeddings.gs']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'apps-script', file), 'utf8'), context);
  }
  return { context, requests, writes };
}
test('optional AI disabled and missing key cause no external calls', () => {
  for (const [props, status] of [[{}, 'DISABLED'], [{ AI_CURATED_QA_OPT_IN: 'true' }, 'MISSING_KEY']]) {
    const h = harness(props);
    assert.equal(h.context.buildCuratedQAEmbeddings().status, status);
    assert.equal(h.requests.length, 0);
  }
});
test('compact QA embeddings use the retained question-vector column and named approval field', () => {
  const h = harness({ AI_CURATED_QA_OPT_IN: 'true', GEMINI_API_KEY: 'synthetic-key' },
    [['qa', '', 'synthetic compact question', '', 'reply', 'APPROVED_DEIDENTIFIED_QA']], true);
  assert.equal(h.context.buildCuratedQAEmbeddings().count, 1);
  assert.equal(h.writes[0][0][1], 7);
  assert.equal(JSON.parse(h.requests[0][1].payload).content.parts[0].text, 'synthetic compact question');
});
test('empty QA avoids zero height ranges', () => {
  const h = harness({ AI_CURATED_QA_OPT_IN: 'true', GEMINI_API_KEY: 'synthetic-key' });
  assert.equal(h.context.buildCuratedQAEmbeddings().status, 'EMPTY');
});
test('only approved curated questions sent, header API key and private inline vectors', () => {
  const row = (question, approval) => ['', '', question, '', '', '', 'synthetic reply', '', '', approval];
  const h = harness({ AI_CURATED_QA_OPT_IN: 'true', GEMINI_API_KEY: 'synthetic-key' },
    [row('synthetic curated question', 'APPROVED_DEIDENTIFIED_QA'), row('unapproved content', '')]);
  assert.equal(h.context.buildCuratedQAEmbeddings().count, 1);
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0][0].includes('?'), false);
  assert.equal(h.requests[0][1].headers['x-goog-api-key'], 'synthetic-key');
  assert.equal(JSON.parse(h.requests[0][1].payload).content.parts[0].text, 'synthetic curated question');
  assert.equal(h.writes[0][0][1], 11);
});
