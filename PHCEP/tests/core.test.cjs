const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const recipient = 'U' + '1'.repeat(32);
const otherRecipient = 'U' + '2'.repeat(32);

test('runtime schemas match Setup journal, nonce, inbox key, and eight-column outbox contract', () => {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../apps-script/Setup.gs'), 'utf8'), context);
  const schemas = JSON.parse(vm.runInContext('JSON.stringify(PHCEP_SCHEMAS_)', context));
  assert.deepEqual(schemas['PHCEP事件'], ['Event Key', 'Status', 'Message ID', 'Updated At']);
  assert.deepEqual(schemas['PHCEP請求'], ['Nonce Hash', 'Expires At']);
  assert.deepEqual(schemas['PHCEP寄件匣'],
    ['Key', 'Retry Key', 'Status', 'Recipient', 'Messages JSON', 'Updated At', 'Error', 'Created At']);
  assert.equal(schemas['LINE對話'][10], 'Event Key');
  assert.equal(schemas['LINE對話'][11], '操作狀態');
});

function environment() {
  const state = {
    properties: {
      SPREADSHEET_ID: 'spreadsheet',
      GATEWAY_SIGNING_SECRET: 'gateway-test-secret-at-least-32-characters',
      LINE_CHANNEL_SECRET: 'different-line-test-secret',
      LINE_CHANNEL_ACCESS_TOKEN: 'test-access-token',
      IMAGE_FOLDER_ID: 'private-folder'
    },
    locked: false, releases: 0, failLock: false, requests: [],
    files: [], folderAccess: 'PRIVATE', pushCode: 200, pushHeaders: {},
    failProfile: false, flushes: 0, failWrite: null, validations: {},
    pushBody: '{}', failPush: false
  };
  function sheet(name, columns) {
    const data = [Array.from({ length: columns }, (_, i) => `Header ${i}`)];
    return {
      name, data,
      getLastRow: () => data.length,
      getMaxRows: () => Math.max(20, data.length),
      getMaxColumns: () => data[0].length,
      insertRowsAfter: (row, count) => {
        data.splice(row, 0, ...Array.from({ length: count }, () => []));
      },
      deleteRow: row => { data.splice(row - 1, 1); },
      getRange(row, column, height = 1, width = 1) {
        const write = values => {
          if (state.failWrite && state.failWrite(name, row, column, values))
            throw new Error('sensitive error must not escape');
          for (let r = 0; r < height; r++) {
            data[row - 1 + r] ||= [];
            for (let c = 0; c < width; c++) data[row - 1 + r][column - 1 + c] = values[r][c];
          }
        };
        return {
          getValues: () => Array.from({ length: height }, (_, r) =>
            Array.from({ length: width }, (_, c) => data[row - 1 + r]?.[column - 1 + c] ?? '')),
          getValue: () => data[row - 1]?.[column - 1] ?? '',
          setValues: write,
          setValue: value => write([[value]]),
          setRichTextValue: value => write([[value]]),
          setFontWeight(value) { state.formats ||= {}; state.formats[`${name}:${row}:weight`] = value; return this; },
          setBackground(value) { state.formats ||= {}; state.formats[`${name}:${row}:background`] = value; return this; },
          clearDataValidations() { delete state.validations[`${name}:${row}:${column}`]; return this; },
          setDataValidation(rule) { state.validations[`${name}:${row}:${column}`] = rule; return this; }
        };
      }
    };
  }
  state.sheets = Object.fromEntries([
    ['LINE對話', 11], ['PHCEP事件', 4], ['PHCEP請求', 2], ['PHCEP寄件匣', 8]
  ].map(([name, columns]) => [name, sheet(name, columns)]));
  const blob = value => {
    const bytes = typeof value === 'string' ? Buffer.from(value) : Buffer.from(value);
    return {
      name: '', getBytes: () => [...bytes], getDataAsString: () => bytes.toString('utf8'),
      setName(name) { this.name = name; return this; }
    };
  };
  const response = (code, text = '{}', headers = {}) => ({
    getResponseCode: () => code, getContentText: () => text,
    getAllHeaders: () => headers, getBlob: () => blob('media')
  });
  const context = vm.createContext({
    PropertiesService: { getScriptProperties: () => ({
      getProperty: name => state.properties[name] || null
    }) },
    SpreadsheetApp: {
      openById(id) {
        assert.equal(id, 'spreadsheet');
        assert.ok(state.locked);
        return { getSheetByName: name => state.sheets[name] };
      },
      flush: () => { state.flushes++; },
      newDataValidation: () => {
        const rule = {};
        return {
          requireValueInList(values) { rule.values = [...values]; return this; },
          requireCheckbox() { rule.checkbox = true; return this; },
          setAllowInvalid(value) { rule.allowInvalid = value; return this; },
          build: () => rule
        };
      },
      newRichTextValue: () => ({
        setText(text) { this.text = text; return this; },
        setLinkUrl(url) { this.url = url; return this; },
        build() { return { text: this.text, url: this.url }; }
      })
    },
    LockService: { getScriptLock: () => ({
      tryLock(wait) {
        assert.ok(wait === 0 || wait === 20000);
        state.lockWait = wait;
        if (state.failLock) return false;
        state.locked = true;
        return true;
      },
      releaseLock() { assert.ok(state.locked); state.locked = false; state.releases++; }
    }) },
    Utilities: {
      Charset: { UTF_8: 'UTF-8' }, DigestAlgorithm: { SHA_256: 'SHA256' },
      computeDigest: (_, value) => [...crypto.createHash('sha256').update(value).digest()],
      computeHmacSha256Signature: (value, secret) =>
        [...crypto.createHmac('sha256', secret).update(value).digest()],
      base64Encode: bytes => Buffer.from(bytes).toString('base64'),
      base64Decode: value => [...Buffer.from(value, 'base64')],
      newBlob: blob, getUuid: () => crypto.randomUUID()
    },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: content => ({
        content, setMimeType(type) { this.type = type; return this; }
      })
    },
    UrlFetchApp: {
      fetch(url, options) {
        state.requests.push({ url, options });
        if (url.includes('/profile/')) {
          if (state.failProfile) throw new Error('private profile failure');
          return response(200, JSON.stringify({ displayName: '=malicious profile' }));
        }
        assert.ok(state.locked);
        if (url.endsWith('/push')) {
          assert.ok(state.flushes > 0);
          if (state.failPush) throw new Error('private transport exception');
          return response(state.pushCode, state.pushBody, state.pushHeaders);
        }
        return response(200);
      }
    },
    DriveApp: {
      Access: { PRIVATE: 'PRIVATE' },
      getFolderById(id) {
        assert.equal(id, 'private-folder');
        return {
          getSharingAccess: () => state.folderAccess,
          getFilesByName(name) {
            const matching = state.files.filter(file => file.name === name);
            let index = 0;
            return { hasNext: () => index < matching.length, next: () => matching[index++] };
          },
          createFile(blob) {
            const file = {
              name: blob.name, getSharingAccess: () => 'PRIVATE',
              getUrl: () => `https://drive.google.com/file/d/file-${state.files.length}/view`
            };
            state.files.push(file);
            return file;
          }
        };
      }
    },
    console: { log() { throw new Error('No logging allowed'); }, error() { throw new Error('No logging allowed'); } },
    Logger: { log() { throw new Error('No logging allowed'); } }
  });
  for (const name of ['Storage.gs', 'Matcher.gs', 'Workflow.gs', 'Core.gs'])
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../apps-script', name), 'utf8'), context);
  const sign = (events = [], changes = {}, raw) => {
    const envelope = {
      version: 1, action: 'events', timestamp: Date.now(), nonce: crypto.randomUUID(),
      rawBody: Buffer.from(raw ?? JSON.stringify({ events })).toString('base64'), ...changes
    };
    const canonical = `1\n${envelope.action}\n${envelope.timestamp}\n${envelope.nonce}\n${envelope.rawBody}`;
    envelope.signature = crypto.createHmac('sha256', state.properties.GATEWAY_SIGNING_SECRET || '')
      .update(canonical).digest('base64');
    return envelope;
  };
  const post = envelope => {
    const result = context.doPost({ postData: { contents: JSON.stringify(envelope) } });
    assert.equal(result.type, 'application/json');
    return JSON.parse(result.content);
  };
  return { state, context, sign, post };
}

const event = (id = 'message-1', changes = {}) => ({
  type: 'message', webhookEventId: `webhook-${id}`, timestamp: Date.now(),
  source: { userId: 'user-1' }, message: { id, type: 'text', text: '中文 text' }, ...changes
});

test('only authenticated signed envelopes accept events', () => {
  const { post, sign, state } = environment();
  assert.equal(post(sign([event()])).ok, true);
  assert.equal(state.sheets['LINE對話'].data.length, 2);
  assert.equal(state.sheets['LINE對話'].data[1][5], '中文 text');
  assert.equal(post({ events: [event()] }).error, 'INVALID_ENVELOPE');
});

test('new messages go below the header with controls; existing rows and retries stay intact', () => {
  const { post, sign, state, context } = environment();
  const inbox = state.sheets['LINE對話'];
  const headers = Array.from({ length: 12 }, (_, i) => `Header ${i}`);
  headers.push(...context.PHCEP_LINE_CONTROL_HEADERS_, ...context.PHCEP_LINE_HISTORY_HEADERS_);
  inbox.data[0] = headers;
  const previous = ['older', false, recipient, '', '', 'old question', { url: 'private-link' },
    '', 'pending draft', 'latest reply', 'event:older', '{"reply":{"status":"PENDING"}}',
    '發送草稿', false, '草稿 (未發送)', 4, false, '', 'pending', 'previous reply'];
  inbox.data.push([...previous]);
  assert.equal(post(sign([event('first'), event('second')])).ok, true);
  assert.deepEqual(inbox.data[0], headers);
  assert.deepEqual(inbox.data.slice(1, 3).map(row => row[0]), ['second', 'first']);
  assert.deepEqual(inbox.data[3], previous);
  assert.equal(state.validations['LINE對話:2:2'].checkbox, true);
  assert.equal(state.validations['LINE對話:2:14'].checkbox, true);
  assert.equal(state.validations['LINE對話:2:17'].checkbox, true);
  assert.ok(state.validations['LINE對話:2:15'].values.includes('草稿 (未發送)'));
  assert.deepEqual(state.validations['LINE對話:2:16'].values, ['1', '2', '3', '4', '5']);
  assert.equal(state.validations['LINE對話:2:13'].allowInvalid, false);
  assert.equal(state.formats['LINE對話:2:weight'], 'normal');
  assert.equal(state.formats['LINE對話:2:background'], null);
  assert.equal(post(sign([event('first'), event('second')])).ok, true);
  assert.deepEqual(inbox.data.slice(1, 3).map(row => row[0]), ['second', 'first']);
  assert.equal(inbox.data.length, 4);
});

test('actual gateway envelope authenticates exact UTF8 bytes and deduplicates fresh-nonce retries', () => {
  const { envelope } = require('../gateway/server.cjs');
  const { post, state } = environment();
  const message = event('cross-module', {
    message: { id: 'cross-module', type: 'text', text: '中文🙂\n=literal' }
  });
  const raw = Buffer.from(` { "events" : ${JSON.stringify([message])} } \n`, 'utf8');
  const signed = envelope(raw, state.properties.GATEWAY_SIGNING_SECRET);
  assert.deepEqual(Buffer.from(signed.rawBody, 'base64'), raw);
  assert.equal(post(signed).ok, true);
  assert.equal(post(signed).error, 'REPLAY');
  assert.equal(post(envelope(raw, state.properties.GATEWAY_SIGNING_SECRET)).ok, true);
  assert.equal(state.sheets['LINE對話'].data.length, 2);
  assert.equal(state.sheets['LINE對話'].data[1][5], message.message.text);
  assert.equal(state.sheets['PHCEP事件'].data[1][1], 'COMPLETE');
});

test('tampering with each signed field is rejected without storage', () => {
  for (const [field, value] of [
    ['version', 2], ['action', 'push'], ['timestamp', Date.now() - 1000],
    ['nonce', crypto.randomUUID()], ['rawBody', Buffer.from('{"events":[]} ').toString('base64')],
    ['signature', 'x'.repeat(44)]
  ]) {
    const { post, sign, state } = environment();
    assert.equal(post({ ...sign([event()]), [field]: value }).ok, false, field);
    assert.equal(state.sheets['PHCEP請求'].data.length, 1);
    assert.equal(state.requests.length, 0);
  }
});

test('configuration requires distinct gateway and LINE secrets', () => {
  for (const modification of [
    properties => { delete properties.GATEWAY_SIGNING_SECRET; },
    properties => { properties.GATEWAY_SIGNING_SECRET = 'short'; },
    properties => { delete properties.LINE_CHANNEL_SECRET; },
    properties => { properties.LINE_CHANNEL_SECRET = properties.GATEWAY_SIGNING_SECRET; },
    properties => { delete properties.SPREADSHEET_ID; }
  ]) {
    const { post, sign, state } = environment();
    modification(state.properties);
    assert.equal(post(sign()).error, 'CONFIGURATION');
  }
});

test('stale and future timestamps fail; malformed envelope and payload fail safely', () => {
  const { post, sign, state } = environment();
  assert.equal(post(sign([], { timestamp: Date.now() - 300001 })).error, 'EXPIRED');
  assert.equal(post(sign([], { timestamp: Date.now() + 300001 })).error, 'EXPIRED');
  assert.equal(post(sign([], { timestamp: String(Date.now()) })).error, 'INVALID_ENVELOPE');
  assert.equal(post(sign([], { extra: true })).error, 'INVALID_ENVELOPE');
  assert.equal(post(sign([], {}, '{"events":false}')).error, 'INVALID_PAYLOAD');
  assert.equal(post(sign([], {}, 'not JSON')).error, 'INVALID_PAYLOAD');
  assert.equal(post(sign(Array.from({ length: 101 }, () => event()))).error, 'INVALID_PAYLOAD');
  assert.equal(state.requests.length, 0);
});

test('nonmessage events are explicitly durably acknowledged with no inbox row', () => {
  const { post, sign, state } = environment();
  const unsupported = { type: 'follow', webhookEventId: 'follow-event' };
  assert.equal(post(sign([unsupported, unsupported])).ok, true);
  assert.equal(state.sheets['PHCEP事件'].data.length, 2);
  assert.equal(state.sheets['PHCEP事件'].data[1][1], 'COMPLETE');
  assert.equal(state.sheets['LINE對話'].data.length, 1);
});

test('malicious or oversized message and event IDs fail closed', () => {
  for (const invalid of [
    event('=formula'), event('x'.repeat(129)), event('valid', { webhookEventId: '+formula' }),
    { type: 'follow' }
  ]) {
    const { post, sign, state } = environment();
    assert.equal(post(sign([invalid])).error, 'INVALID_PAYLOAD');
    assert.equal(state.sheets['LINE對話'].data.length, 1);
  }
});

test('noncanonical base64 and invalid UTF8 are rejected', () => {
  const { post, sign } = environment();
  assert.equal(post(sign([], { rawBody: 'e30' })).error, 'INVALID_PAYLOAD');
  assert.equal(post(sign([], { rawBody: Buffer.from([0xff]).toString('base64') })).error, 'INVALID_PAYLOAD');
  assert.equal(post(sign([], {}, 'x'.repeat(1048577))).error, 'INVALID_PAYLOAD');
});

test('nonce replay survives fresh runtime; nonce is stored only as digest', () => {
  const first = environment();
  const envelope = first.sign([event()]);
  assert.equal(first.post(envelope).ok, true);
  assert.equal(first.post(envelope).error, 'REPLAY');
  const second = environment();
  second.state.sheets = first.state.sheets;
  assert.equal(second.post(envelope).error, 'REPLAY');
  const nonceRow = first.state.sheets['PHCEP請求'].data[1];
  assert.equal(nonceRow[0], crypto.createHash('sha256').update(envelope.nonce).digest('hex'));
  assert.equal(JSON.stringify(first.state.sheets).includes(envelope.nonce), false);
});

test('UUID case variation cannot bypass replay protection', () => {
  const { post, sign } = environment();
  const envelope = sign();
  assert.equal(post(envelope).ok, true);
  assert.equal(post(sign([], { nonce: envelope.nonce.toUpperCase() })).error, 'REPLAY');
});

test('operator nonce cleanup retains live/recent/invalid rows and event journals', () => {
  const { post, sign, state, context } = environment();
  assert.equal(post(sign([event()])).ok, true);
  const rows = state.sheets['PHCEP請求'].data;
  const date = rows[1][1];
  const makeDate = time => { const value = new date.constructor(time); return value; };
  rows.push(['old', makeDate(Date.now() - 120000)]);
  rows.push(['recent', makeDate(Date.now() - 1000)]);
  rows.push(['invalid', 'not-a-date']);
  const result = context.phcepCleanupExpiredNonces();
  assert.equal(result.ok, true);
  assert.equal(result.removed, 1);
  assert.equal(rows.length, 4);
  assert.equal(state.sheets['PHCEP事件'].data.length, 2);
  assert.equal(state.sheets['PHCEP寄件匣'].data.length, 1);
  assert.equal(post(sign([], { timestamp: Date.now() - 420000 })).error, 'EXPIRED');
});

test('lock contention fails immediately without touching storage or releasing foreign lock', () => {
  const { post, sign, state } = environment();
  state.failLock = true;
  assert.equal(post(sign([event()])).error, 'BUSY');
  assert.equal(state.releases, 0);
  assert.equal(state.sheets['PHCEP請求'].data.length, 1);
});

test('new nonces deduplicate events across batches and durable restarts', () => {
  const first = environment();
  assert.equal(first.post(first.sign([event(), event(), event('message-2')])).ok, true);
  const second = environment();
  second.state.sheets = first.state.sheets;
  assert.equal(second.post(second.sign([event(), event('message-2')])).ok, true);
  assert.equal(first.state.sheets['LINE對話'].data.length, 3);
  assert.equal(first.state.sheets['PHCEP事件'].data.length, 3);
});

test('fallback message id also deduplicates changed webhook IDs', () => {
  const { post, sign, state } = environment();
  assert.equal(post(sign([event('same', { webhookEventId: undefined })])).ok, true);
  assert.equal(post(sign([event('same', { webhookEventId: 'other' })])).ok, true);
  assert.equal(state.sheets['LINE對話'].data.length, 2);
});

test('retry completes after partially accepted multi-event batch', () => {
  const { post, sign, state } = environment();
  state.failWrite = (name, row, column, values) =>
    name === 'LINE對話' && column === 1 && values[0][0] === 'message-2';
  assert.equal(post(sign([event(), event('message-2')])).error, 'ACCEPTANCE_FAILED');
  assert.equal(state.sheets['LINE對話'].data.filter(row => row[0] === 'message-1').length, 1);
  assert.equal(state.releases, 1);
  state.failWrite = null;
  assert.equal(post(sign([event(), event('message-2')])).ok, true);
  assert.deepEqual(state.sheets['LINE對話'].data.slice(1).filter(row => row[0]).map(row => row[0]),
    ['message-2', 'message-1']);
});

test('K event key deduplicates crash after inbox write before journal update', () => {
  const { post, sign, state } = environment();
  state.failWrite = (name, row, column) => name === 'PHCEP事件' && column === 2;
  assert.equal(post(sign([event()])).error, 'ACCEPTANCE_FAILED');
  assert.equal(state.sheets['LINE對話'].data.length, 2);
  state.failWrite = null;
  assert.equal(post(sign([event()])).ok, true);
  assert.equal(state.sheets['LINE對話'].data.length, 2);
  assert.equal(state.sheets['PHCEP事件'].data[1][1], 'COMPLETE');
});

test('literal text and profiles are formula-safe, links are rich text not formulas', () => {
  const { post, sign, state, context } = environment();
  const message = { id: '1', type: 'text', text: '=IMPORTXML("https://example.com","x")' };
  assert.equal(post(sign([event('1', { message })])).ok, true);
  const row = state.sheets['LINE對話'].data[1];
  assert.equal(row[5], `'${message.text}`);
  assert.equal(row[4], "'=malicious profile");
  assert.equal(row[6].text, '開啟連結');
  assert.ok(row[6].url.startsWith('https://'));
  for (const value of ['=x', '+x', '-x', '@x', ' \t=x', '\n=x'])
    assert.equal(context.phcepLiteral_(value), `'${value}`);
});

test('profile errors are optional and never trigger autonomous reply', () => {
  const { post, sign, state } = environment();
  state.failProfile = true;
  assert.equal(post(sign([event()])).ok, true);
  assert.equal(state.sheets['LINE對話'].data[1][4], '');
  assert.equal(state.requests.some(request => request.url.includes('/reply') || request.url.includes('/push')), false);
});

test('private media reuses deterministic file after acceptance crash', () => {
  const { post, sign, state } = environment();
  const media = event('media', { message: { id: 'media', type: 'file', fileName: '=malicious' } });
  state.failWrite = name => name === 'LINE對話';
  assert.equal(post(sign([media])).error, 'ACCEPTANCE_FAILED');
  assert.equal(state.files.length, 1);
  state.failWrite = null;
  assert.equal(post(sign([media])).ok, true);
  assert.equal(state.files.length, 1);
  assert.equal(state.requests.filter(request => request.url.includes('/content')).length, 1);
  assert.equal(state.sheets['LINE對話'].data[1][6].text, '=malicious');
});

test('media decoration crash retries without creating a second file or inbox row', () => {
  const { post, sign, state } = environment();
  const media = event('media', { message: { id: 'media', type: 'image' } });
  state.failWrite = (name, row, column) => name === 'LINE對話' && column === 7;
  assert.equal(post(sign([media])).error, 'ACCEPTANCE_FAILED');
  state.failWrite = null;
  assert.equal(post(sign([media])).ok, true);
  assert.equal(state.files.length, 1);
  assert.equal(state.sheets['LINE對話'].data.length, 2);
  assert.ok(state.sheets['LINE對話'].data[1][6].url);
});

test('public media folders fail closed', () => {
  const { post, sign, state } = environment();
  state.folderAccess = 'ANYONE_WITH_LINK';
  assert.equal(post(sign([event('media', { message: { id: 'media', type: 'image' } })])).error, 'CONFIGURATION');
  assert.equal(state.files.length, 0);
});

test('operator callers can wait for the script lock while webhook callers remain nonblocking', () => {
  const { context, state } = environment();
  assert.equal(context.phcepWithLock_(() => 'operator', 20000), 'operator');
  assert.equal(state.lockWait, 20000);
  assert.equal(context.phcepWithLock_(() => 'webhook'), 'webhook');
  assert.equal(state.lockWait, 0);
  assert.equal(state.releases, 2);
});

test('push requires a lock and persists stable retry key before sending', () => {
  const { context, state } = environment();
  const messages = [{ type: 'text', text: 'clinician approved' }];
  assert.throws(() => context.phcepPush_('send-1', recipient, messages), /LOCK_REQUIRED/);
  state.pushCode = 503;
  assert.equal(context.phcepWithLock_(() => context.phcepPush_('send-1', recipient, messages)).ok, false);
  const retryKey = state.sheets['PHCEP寄件匣'].data[1][1];
  const createdAt = state.sheets['PHCEP寄件匣'].data[1][7].getTime();
  assert.equal(state.sheets['PHCEP寄件匣'].data[1][2], 'FAILED');
  state.pushCode = 409;
  state.pushHeaders = { 'x-line-accepted-request-id': 'accepted' };
  assert.equal(context.phcepWithLock_(() => context.phcepPush_('send-1', recipient, messages)).ok, true);
  const sends = state.requests.filter(request => request.url.endsWith('/push'));
  assert.equal(sends.length, 2);
  assert.ok(sends.every(request => request.options.headers['X-Line-Retry-Key'] === retryKey));
  assert.equal(state.sheets['PHCEP寄件匣'].data[1][2], 'SENT');
  assert.equal(state.sheets['PHCEP寄件匣'].data[1][7].getTime(), createdAt);
  assert.equal(context.phcepWithLock_(() => context.phcepPush_('send-1', recipient, messages)).ok, true);
  assert.equal(state.requests.length, 2);
});

test('409 without accepted retry-key header remains failed; changed content conflicts', () => {
  const { context, state } = environment();
  state.pushCode = 409;
  const messages = [{ type: 'text', text: 'one' }];
  assert.equal(context.phcepWithLock_(() => context.phcepPush_('send-1', recipient, messages)).error, 'LINE_HTTP_409');
  assert.equal(context.phcepWithLock_(() => context.phcepPush_('send-1', otherRecipient, messages)).error, 'OUTBOUND_CONFLICT');
  assert.equal(state.requests.length, 1);
});

test('LINE failures expose safe codes and retain the same outbox retry key', () => {
  for (const [code, body, expected] of [
    [400, '{"message":"private recipient"}', 'LINE_HTTP_400'],
    [401, '{"message":"private token"}', 'LINE_HTTP_401'],
    [403, '{}', 'LINE_HTTP_403'],
    [429, '{"message":"You have reached your monthly limit."}', 'LINE_MONTHLY_QUOTA_EXCEEDED'],
    [429, '{"message":"Too many requests"}', 'LINE_HTTP_429'],
    [503, '{}', 'LINE_HTTP_503']
  ]) {
    const { context, state } = environment();
    state.pushCode = code;
    state.pushBody = body;
    const send = () => context.phcepWithLock_(() =>
      context.phcepPush_('send-1', recipient, [{ type: 'text', text: 'draft' }]));
    assert.equal(send().error, expected);
    const row = state.sheets['PHCEP寄件匣'].data[1];
    const retryKey = row[1];
    assert.equal(row[6], expected);
    state.pushCode = 200;
    assert.equal(send().ok, true);
    assert.equal(row[1], retryKey);
    assert.equal(row[6], '');
  }
});

test('missing token and transport errors are distinct without leaking exception text', () => {
  const { context, state } = environment();
  delete state.properties.LINE_CHANNEL_ACCESS_TOKEN;
  const send = () => context.phcepWithLock_(() =>
    context.phcepPush_('send-1', recipient, [{ type: 'text', text: 'draft' }]));
  assert.equal(send().error, 'LINE_TOKEN_MISSING');
  assert.equal(state.requests.length, 0);
  state.properties.CHANNEL_ACCESS_TOKEN = 'legacy-token';
  state.failPush = true;
  assert.equal(send().error, 'LINE_FETCH_FAILED');
  assert.equal(state.sheets['PHCEP寄件匣'].data[1][6], 'LINE_FETCH_FAILED');
  state.failPush = false;
  assert.equal(send().ok, true);
});

test('send diagnostic is authorized, read-only and logs only safe authentication and quota results', () => {
  const { context, state } = environment();
  const logs = [];
  let authorized = false;
  context.phcepAuthorizeClinician_ = () => { authorized = true; };
  context.console = { log: text => logs.push(text) };
  context.UrlFetchApp.fetch = (url, options) => {
    assert.equal(authorized, true);
    assert.equal(options.payload, undefined);
    assert.equal(options.method, undefined);
    assert.ok(!url.endsWith('/push'));
    state.requests.push({ url });
    const body = url.endsWith('/consumption') ? { totalUsage: 200 } :
      url.endsWith('/quota') ? { type: 'limited', value: 200 } : { userId: 'private bot identity' };
    return { getResponseCode: () => 200, getContentText: () => JSON.stringify(body) };
  };
  const report = context.diagnosePHCEPLineSend();
  assert.equal(report.authentication.httpStatus, 200);
  assert.equal(report.monthlyQuotaReached, true);
  assert.equal(state.requests.length, 3);
  assert.equal(state.sheets['PHCEP寄件匣'].data.length, 1);
  assert.ok(!logs[0].includes('private'));
  assert.ok(!logs[0].includes(state.properties.LINE_CHANNEL_ACCESS_TOKEN));
  delete state.properties.LINE_CHANNEL_ACCESS_TOKEN;
  assert.equal(context.diagnosePHCEPLineSend().error, 'LINE_TOKEN_MISSING');
  assert.equal(state.requests.length, 3);
  context.phcepAuthorizeClinician_ = () => { throw new Error('Unauthorized'); };
  assert.throws(() => context.diagnosePHCEPLineSend(), /Unauthorized/);
});

test('pending and failed sends older than 23h are quarantined without another send', () => {
  for (const status of ['PENDING', 'FAILED']) {
    const { context, state } = environment();
    state.pushCode = 503;
    const messages = [{ type: 'text', text: 'one' }];
    assert.equal(context.phcepWithLock_(() => context.phcepPush_('send-1', recipient, messages)).ok, false);
    const row = state.sheets['PHCEP寄件匣'].data[1];
    row[2] = status;
    row[7].setTime(Date.now() - 23 * 60 * 60 * 1000 - 1000);
    state.pushCode = 200;
    assert.equal(context.phcepWithLock_(() => context.phcepPush_('send-1', recipient, messages)).error, 'AMBIGUOUS_EXPIRED');
    assert.equal(row[2], 'AMBIGUOUS_EXPIRED');
    assert.equal(state.requests.length, 1);
    assert.equal(context.phcepWithLock_(() => context.phcepPush_('send-1', recipient, messages)).error, 'AMBIGUOUS_EXPIRED');
    assert.equal(state.requests.length, 1);
  }
});

test('successful sends remain successful after retry-key expiry', () => {
  const { context, state } = environment();
  const messages = [{ type: 'text', text: 'one' }];
  assert.equal(context.phcepWithLock_(() => context.phcepPush_('send-1', recipient, messages)).ok, true);
  state.sheets['PHCEP寄件匣'].data[1][7].setTime(0);
  assert.equal(context.phcepWithLock_(() => context.phcepPush_('send-1', recipient, messages)).ok, true);
  assert.equal(state.requests.length, 1);
});

test('legacy retry records without Created At fail closed instead of minting new keys', () => {
  const { context, state } = environment();
  state.pushCode = 503;
  const messages = [{ type: 'text', text: 'one' }];
  context.phcepWithLock_(() => context.phcepPush_('send-1', recipient, messages));
  const row = state.sheets['PHCEP寄件匣'].data[1];
  const retryKey = row[1];
  row[7] = '';
  assert.equal(context.phcepWithLock_(() =>
    context.phcepPush_('send-1', recipient, messages)).error, 'AMBIGUOUS_EXPIRED');
  assert.equal(row[1], retryKey);
  assert.equal(state.requests.length, 1);
});

test('push recipient must be a strict LINE user ID', () => {
  for (const invalid of ['=formula', 'user-1', 'U123', 'U' + 'A'.repeat(32), 'C' + '1'.repeat(32)]) {
    const { context, state } = environment();
    assert.equal(context.phcepWithLock_(() =>
      context.phcepPush_('send-1', invalid, [{ type: 'text', text: 'one' }])).error, 'INVALID_OUTBOUND');
    assert.equal(state.requests.length, 0);
    assert.equal(state.sheets['PHCEP寄件匣'].data.length, 1);
  }
});

test('text ingestion adds bounded local QA suggestions to H without network calls or sending', () => {
  const { post, sign, state } = environment();
  const qaRows = [['ID', '重要性分級 (1-5)', '訊息', 'LINE Friend 訊息 1', 'LINE Friend 訊息 2', 'Line Friend 連結備註',
    '回覆', '檔案/媒體連結', '檔案/網址名稱', '連結備註', '問題 Embedding', '回覆 Embedding', '備註 Embedding', '行內使用次數', '全域使用次數'],
    ['1', '', '如何預約門診', '', '', '', '預約說明', '', '', '', '', '', '', 0, 0],
    ['2', '', '停車資訊', '', '', '', '停車說明', '', '', '', '', '', '', 0, 0]];
  state.sheets['QA知識庫'] = {
    getLastRow: () => qaRows.length,
    getLastColumn: () => 15,
    getRange: (row, column, height, width) => ({
      getValues: () => qaRows.slice(row - 1, row - 1 + height).map(values => values.slice(column - 1, column - 1 + width)),
      getRichTextValues: () => Array.from({ length: height }, () => Array(width).fill(null))
    })
  };
  const message = event('qa-1', { message: { id: 'qa-1', type: 'text', text: '請問如何預約門診？' } });
  assert.equal(post(sign([message])).ok, true);
  assert.deepEqual(state.validations['LINE對話:2:8'].values, ['預約說明']);
  assert.equal(state.sheets['LINE對話'].data[1][8], '');
  assert.equal(state.requests.filter(request => !request.url.includes('/profile/')).length, 0);
  assert.equal(state.sheets['PHCEP事件'].data[1][1], 'COMPLETE');
});

test('suggestion failures never block durable ingestion', () => {
  const { post, sign, state } = environment();
  state.sheets['QA知識庫'] = { getLastRow() { throw new Error('private QA failure'); } };
  assert.equal(post(sign([event()])).ok, true);
  assert.equal(state.sheets['LINE對話'].data[1][5], '中文 text');
  assert.equal(state.sheets['PHCEP事件'].data[1][1], 'COMPLETE');
});
