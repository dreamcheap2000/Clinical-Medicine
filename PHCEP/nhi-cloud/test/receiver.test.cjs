'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { health } = require('../receiver.cjs');
const schema = require('../sheet-schema.cjs');
const { build } = require('../build.cjs');
test('health follows only Google result redirects without re-posting a signed envelope', async () => {
  const calls = [];
  const result = await health('https://script.google.com/macros/s/synthetic/exec', 'synthetic-secret',
    async (url, options) => {
      calls.push({ url, options });
      return calls.length === 1 ? { status: 302, headers: new Headers({
        location: 'https://script.googleusercontent.com/macros/echo?synthetic=1'
      }) } : new Response(JSON.stringify({ success: true, schemaVersion: 1, sheetId: 'synthetic-sheet' }));
    });
  assert.equal(result.sheetId, 'synthetic-sheet');
  assert.equal(calls.length, 2);
  assert.ok(!calls[1].options.body);
  await assert.rejects(health('https://script.google.com/macros/s/synthetic/exec', 'synthetic-secret',
    async () => ({ status: 302, headers: new Headers({ location: 'https://attacker.example/macros/echo' }) })),
  { code: 'RECEIVER_REDIRECT_REJECTED' });
});
test('generated signed health verifies schema and target without reading patient rows', () => {
  const dest = build('https://nhi-workflow.example'), reads = [];
  const secret = 'synthetic-test-secret-32-characters-minimum';
  const context = vm.createContext({
    console, PropertiesService: { getScriptProperties: () => ({ getProperty: () => secret }) },
    Utilities: {
      computeHmacSha256Signature: (text, key) => crypto.createHmac('sha256', key).update(text).digest(),
      base64Encode: bytes => Buffer.from(bytes).toString('base64'),
      base64Decode: text => Buffer.from(text, 'base64'),
      newBlob: bytes => ({ getDataAsString: () => Buffer.from(bytes).toString('utf8') })
    },
    CacheService: { getScriptCache: () => ({ get: () => null, put() {} }) },
    ContentService: { MimeType: { JSON: 'json' },
      createTextOutput: text => ({ setMimeType: () => JSON.parse(text) }) },
    NHI_TAB_: schema.tab, NHI_HEADERS_: schema.headers,
    nhiWithLock_: fn => fn(),
    nhiSpreadsheet_: () => ({ getSheetByName: () => ({
      getRange: () => ({ getValues: () => { reads.push('headers'); return [schema.headers]; } }),
      getParent: () => ({ getId: () => 'synthetic-sheet' }),
      getDataRange: () => { throw new Error('Health must not read patient rows'); }
    }) })
  });
  vm.runInContext(fs.readFileSync(path.join(dest, 'receiver', 'NhiPatientApi.gs'), 'utf8'), context);
  const env = { version: 1, action: 'patient.health', timestamp: Date.now(),
    nonce: crypto.randomUUID(), rawBody: Buffer.from('{}').toString('base64') };
  env.signature = crypto.createHmac('sha256', secret)
    .update(`1\n${env.action}\n${env.timestamp}\n${env.nonce}\n${env.rawBody}`).digest('base64');
  const result = context.doPost({ postData: { contents: JSON.stringify(env) } });
  assert.equal(result.success, true);
  assert.equal(result.sheetId, 'synthetic-sheet');
  assert.deepEqual(reads, ['headers']);
  env.signature = 'bad';
  assert.equal(context.doPost({ postData: { contents: JSON.stringify(env) } }).error, 'INVALID_SIGNATURE');
  assert.equal(reads.length, 1);
});
