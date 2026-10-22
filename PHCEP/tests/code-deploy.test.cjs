const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { deploy, prepare, verifyWebApp, SCRIPT_ID } = require('../workflow/deploy-code.cjs');

const root = path.resolve(__dirname, '..', '..');
const source = path.join(root, 'PHCEP', 'apps-script');
const deploymentId = 'AKfy' + 'x'.repeat(40);
const helper = `function phcepCheckpointSafe() {
  var out = {
    hasSpreadsheetId: false,
    spreadsheetAccessible: false,
    requiredSheets: {},
    doPostExists: typeof doPost === 'function',
    validateExists: typeof validatePHCEPConfiguration === 'function'
  };

  try {
    var props = PropertiesService.getScriptProperties();
    var id = (props.getProperty('SPREADSHEET_ID') || '').trim();
    out.hasSpreadsheetId = !!id;

    if (id) {
      var ss = SpreadsheetApp.openById(id);
      out.spreadsheetAccessible = true;

      ['LINE對話', 'PHCEP事件', 'PHCEP請求'].forEach(function (name) {
        out.requiredSheets[name] = !!ss.getSheetByName(name);
      });
    }
  } catch (ignored) {
    out.error = 'CHECKPOINT_FAILED';
  }

  console.log('PHCEP_CHECKPOINT ' + JSON.stringify(out));
  return out;
}

function phcepSyntheticEventTest() {
  // Uses existing helpers in your project; writes one synthetic message event.
  var raw = JSON.stringify({
    destination: 'Uxxxxxxxx',
    events: [{
      type: 'message',
      timestamp: Date.now(),
      webhookEventId: 'test_' + Utilities.getUuid().replace(/-/g, ''),
      source: { type: 'user', userId: 'U_TEST_USER' },
      message: { id: 'm' + Date.now(), type: 'text', text: 'PHCEP synthetic test' }
    }]
  });

  var secret = PropertiesService.getScriptProperties().getProperty('GATEWAY_SIGNING_SECRET');
  if (!secret || secret.trim().length < 32) return { ok: false, error: 'MISSING_SIGNING_SECRET' };

  var nonce = Utilities.getUuid();
  var timestamp = Date.now();
  var rawBody = Utilities.base64Encode(Utilities.newBlob(raw).getBytes());
  var canonical = '1\\nevents\\n' + timestamp + '\\n' + nonce + '\\n' + rawBody;
  var signature = Utilities.base64Encode(
    Utilities.computeHmacSha256Signature(canonical, secret, Utilities.Charset.UTF_8)
  );

  var event = {
    postData: {
      contents: JSON.stringify({
        version: 1,
        action: 'events',
        timestamp: timestamp,
        nonce: nonce,
        rawBody: rawBody,
        signature: signature
      })
    }
  };

  var res = doPost(event);
  return { ok: true, response: res.getContent() };
}`;

function harness(t, options = {}) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'phcep-code-test-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const env = {
    GITHUB_REF: 'refs/heads/main', PHCEP_CONFIRMATION: 'DEPLOY',
    CLASP_SCRIPT_ID: SCRIPT_ID, CLASP_DEPLOYMENT_ID: deploymentId,
    GITHUB_SHA: 'a'.repeat(40), RUNNER_TEMP: temp,
  };
  const calls = [];
  let uploaded;
  let version = 8;
  let deployed = 8;
  function clasp(directory, args) {
    calls.push(args);
    if (args[0] === 'clone') {
      if (uploaded && !['before', 'saved-backup'].includes(path.basename(directory))) {
        for (const name of fs.readdirSync(uploaded)) {
          fs.copyFileSync(path.join(uploaded, name), path.join(directory, name));
        }
        if (options.corruptSource) fs.appendFileSync(path.join(directory, 'Core.gs'), '\n// drift');
      } else {
        for (const name of fs.readdirSync(source).filter(name => /\.(gs|json)$/.test(name) && !name.startsWith('.'))) {
          fs.copyFileSync(path.join(source, name), path.join(directory, name));
        }
        fs.writeFileSync(path.join(directory, 'test.js'), helper + (options.changedHelper ? '\n' : ''));
        if (options.extraFile) fs.writeFileSync(path.join(directory, 'Other.gs'), 'function other() {}');
      }
      return '';
    }
    if (args.includes('list-deployments')) {
      return JSON.stringify([{ deploymentId: options.wrongDeployment ? 'another' : deploymentId,
        versionNumber: deployed }]);
    }
    if (args.includes('create-version')) return JSON.stringify({ versionNumber: ++version });
    if (args[0] === 'push') {
      uploaded = directory;
      assert.equal(fs.readFileSync(path.join(directory, 'test.js'), 'utf8'), helper);
      return '';
    }
    if (args[0] === 'redeploy') {
      deployed = Number(args[args.indexOf('--versionNumber') + 1]);
      return '';
    }
    assert.fail('Unexpected clasp operation');
  }
  return { env, calls, clasp, temp };
}

test('code-only deployment backs up first, preserves helpers, verifies version and redeploys existing URL', t => {
  const h = harness(t);
  const report = {};
  deploy(h.env, root, report, h.clasp);
  assert.deepEqual(report, {
    stage: 'complete', previousDeploymentVersion: 8, backupVersion: 9,
    sourceUpload: 'verified', newVersion: 10, deployment: 'verified',
    status: 'deployed', helpers: 'preserved_exactly',
  });
  const backup = h.calls.findIndex(args => args.includes('create-version'));
  const push = h.calls.findIndex(args => args[0] === 'push');
  const redeploy = h.calls.find(args => args[0] === 'redeploy');
  assert.ok(backup < push);
  assert.equal(redeploy[1], deploymentId);
  assert.equal(h.calls.filter(args => args[0] === 'clone').length, 4);
  assert.equal(h.calls.some(args => args.includes('run')), false);
  assert.deepEqual(fs.readdirSync(h.temp), []);
});

test('guards reject wrong branch, confirmation, target, or missing deployment before Google access', t => {
  const h = harness(t);
  for (const change of [
    { GITHUB_REF: 'refs/heads/other' }, { PHCEP_CONFIRMATION: '' },
    { CLASP_SCRIPT_ID: 'wrong' }, { CLASP_DEPLOYMENT_ID: '' },
  ]) {
    assert.throws(() => deploy({ ...h.env, ...change }, root, {}, h.clasp));
  }
  assert.equal(h.calls.length, 0);
});

for (const [option, error] of [
  ['changedHelper', 'DIAGNOSTIC_HELPER_CHANGED'],
  ['extraFile', 'UNREVIEWED_REMOTE_FILES'],
  ['wrongDeployment', 'EXISTING_VERSIONED_DEPLOYMENT_REQUIRED'],
]) {
  test(`${error} blocks all remote writes`, t => {
    const h = harness(t, { [option]: true });
    assert.throws(() => deploy(h.env, root, {}, h.clasp), new RegExp(error));
    assert.equal(h.calls.some(args => args.includes('create-version') || args[0] === 'push'), false);
    assert.deepEqual(fs.readdirSync(h.temp), []);
  });
}

test('uploaded source mismatch blocks redeployment and reports an uncertain upload', t => {
  const h = harness(t, { corruptSource: true });
  const report = {};
  assert.throws(() => deploy(h.env, root, report, h.clasp), /UPLOADED_SOURCE_MISMATCH/);
  assert.equal(report.sourceUpload, 'outcome_unknown');
  assert.equal(h.calls.some(args => args[0] === 'redeploy'), false);
});

test('web-app execution identity and access must remain unchanged', t => {
  const h = harness(t);
  const backup = path.join(h.temp, 'before');
  fs.mkdirSync(backup);
  h.clasp(backup, ['clone', SCRIPT_ID]);
  const manifestPath = path.join(backup, 'appsscript.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath));
  manifest.webapp.access = 'MYSELF';
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  assert.throws(() => prepare(source, backup, path.join(h.temp, 'upload')), /WEBAPP_CONFIGURATION_CHANGED/);
});

test('web-app smoke test sends no signed envelope or clinical event and requires explicit rejection', async () => {
  await verifyWebApp(deploymentId, async (url, options) => {
    assert.equal(url, `https://script.google.com/macros/s/${deploymentId}/exec`);
    assert.equal(options.body, '{}');
    return { ok: true, json: async () => ({ ok: false, error: 'INVALID_ENVELOPE' }) };
  });
  for (const body of [
    { ok: true }, { ok: false, error: 'CONFIGURATION' }, { ok: false, error: 'ACCEPTANCE_FAILED' },
  ]) {
    await assert.rejects(verifyWebApp(deploymentId, async () => ({ ok: true, json: async () => body })));
  }
  await assert.rejects(verifyWebApp(deploymentId, async () => ({ ok: false })), /WEBAPP_HTTP_FAILED/);
});
