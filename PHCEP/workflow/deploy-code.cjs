const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { isDeepStrictEqual } = require('node:util');

const SCRIPT_ID = '1CpdImaCVfjNxJvBnD4xrxf5j2zAKI0mzQS-ZXeQ0H2w3aNMBaDLgCeVD';
const HELPER_SHA256 = 'eb69f5b41208f77302229e53f1598e7b54088eacfd3a343c0fd54df78db27af7';
const SOURCES = [
  'Core.gs', 'Storage.gs', 'Embeddings.gs', 'Setup.gs', 'Forms.gs',
  'UI.gs', 'Matcher.gs', 'Workflow.gs', 'ManualMigration.gs', 'appsscript.json',
];

function requireCondition(condition, code) {
  if (!condition) throw new Error(code);
}

function project(directory) {
  const result = {};
  for (const name of fs.readdirSync(directory)) {
    if (name.startsWith('.')) continue;
    requireCondition(name === 'appsscript.json' || /\.(gs|js)$/.test(name), 'UNEXPECTED_REMOTE_FILE');
    const key = name.replace(/\.(gs|js)$/, '');
    requireCondition(!Object.hasOwn(result, key), 'DUPLICATE_SOURCE_NAME');
    const text = fs.readFileSync(path.join(directory, name), 'utf8').replace(/\r\n/g, '\n');
    result[key] = name === 'appsscript.json' ? JSON.parse(text) : text;
  }
  return result;
}

function prepare(source, backup, upload) {
  const remote = project(backup);
  const allowed = new Set(SOURCES.map(name => name.replace(/\.gs$/, '')));
  allowed.add('test');
  requireCondition(Object.keys(remote).every(name => allowed.has(name)), 'UNREVIEWED_REMOTE_FILES');
  requireCondition(typeof remote.test === 'string', 'DIAGNOSTIC_HELPER_MISSING');
  const digest = crypto.createHash('sha256').update(remote.test).digest('hex');
  requireCondition(digest === HELPER_SHA256, 'DIAGNOSTIC_HELPER_CHANGED');
  const manifest = JSON.parse(fs.readFileSync(path.join(source, 'appsscript.json'), 'utf8'));
  requireCondition(isDeepStrictEqual(remote['appsscript.json'].webapp, manifest.webapp),
    'WEBAPP_CONFIGURATION_CHANGED');
  fs.mkdirSync(upload);
  for (const name of SOURCES) fs.copyFileSync(path.join(source, name), path.join(upload, name));
  fs.writeFileSync(path.join(upload, 'test.js'), remote.test);
  fs.writeFileSync(path.join(upload, '.clasp.json'), JSON.stringify({ scriptId: SCRIPT_ID, rootDir: '.' }));
  fs.writeFileSync(path.join(upload, '.claspignore'), [
    '**/**', ...SOURCES.map(name => `!${name}`), '!test.js', '',
  ].join('\n'));
}

function runClasp(directory, args) {
  try {
    return execFileSync('clasp', args, {
      cwd: directory, encoding: 'utf8', timeout: 120000,
      maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    // Do not copy clasp errors containing credentials or remote source into CI logs.
    throw new Error('CLASP_COMMAND_FAILED');
  }
}

function versionNumber(result) {
  const number = JSON.parse(result).versionNumber;
  requireCondition(Number.isInteger(number) && number > 0, 'INVALID_VERSION_RESPONSE');
  return number;
}

function deploy(env, root, report, clasp = runClasp) {
  requireCondition(env.GITHUB_REF === 'refs/heads/main' && env.PHCEP_CONFIRMATION === 'DEPLOY',
    'MAIN_AND_CONFIRMATION_REQUIRED');
  requireCondition(env.CLASP_SCRIPT_ID === SCRIPT_ID, 'SCRIPT_ID_MISMATCH');
  const deploymentId = env.CLASP_DEPLOYMENT_ID;
  requireCondition(typeof deploymentId === 'string' && /^AKfy[A-Za-z0-9_-]{20,150}$/.test(deploymentId),
    'DEPLOYMENT_ID_REQUIRED');
  requireCondition(/^[a-f0-9]{40}$/.test(env.GITHUB_SHA || ''), 'COMMIT_REQUIRED');
  const workspace = fs.mkdtempSync(path.join(env.RUNNER_TEMP || os.tmpdir(), 'phcep-code-'));
  try {
    const backup = path.join(workspace, 'before');
    const upload = path.join(workspace, 'upload');
    const verified = path.join(workspace, 'verified');
    fs.mkdirSync(backup);
    report.stage = 'read_only_preflight';
    clasp(backup, ['clone', SCRIPT_ID]);
    const deployments = JSON.parse(clasp(backup, ['--json', 'list-deployments']));
    const current = deployments.find(item => item.deploymentId === deploymentId);
    requireCondition(current && Number.isInteger(current.versionNumber), 'EXISTING_VERSIONED_DEPLOYMENT_REQUIRED');
    report.previousDeploymentVersion = current.versionNumber;
    prepare(path.join(root, 'PHCEP', 'apps-script'), backup, upload);
    const intended = project(upload);
    report.stage = 'backup_version';
    report.backupVersion = versionNumber(clasp(backup, [
      '--json', 'create-version', `Before PHCEP code ${env.GITHUB_SHA.slice(0, 12)}`,
    ]));
    const savedBackup = path.join(workspace, 'saved-backup');
    fs.mkdirSync(savedBackup);
    clasp(savedBackup, ['clone', SCRIPT_ID, String(report.backupVersion)]);
    requireCondition(isDeepStrictEqual(project(savedBackup), project(backup)), 'REMOTE_CHANGED_DURING_BACKUP');
    report.stage = 'source_upload';
    report.sourceUpload = 'outcome_unknown';
    clasp(upload, ['push', '--force']);
    fs.mkdirSync(verified);
    clasp(verified, ['clone', SCRIPT_ID]);
    requireCondition(isDeepStrictEqual(project(verified), intended), 'UPLOADED_SOURCE_MISMATCH');
    report.sourceUpload = 'verified';
    report.stage = 'version_creation';
    report.newVersion = versionNumber(clasp(upload, [
      '--json', 'create-version', `PHCEP code ${env.GITHUB_SHA.slice(0, 12)}; helpers preserved`,
    ]));
    const frozen = path.join(workspace, 'frozen');
    fs.mkdirSync(frozen);
    clasp(frozen, ['clone', SCRIPT_ID, String(report.newVersion)]);
    requireCondition(isDeepStrictEqual(project(frozen), intended), 'VERSION_SOURCE_MISMATCH');
    report.stage = 'redeploy';
    report.deployment = 'outcome_unknown';
    clasp(upload, ['redeploy', deploymentId, '--versionNumber', String(report.newVersion),
      '--description', `PHCEP code ${env.GITHUB_SHA.slice(0, 12)}; no migration`]);
    const after = JSON.parse(clasp(upload, ['--json', 'list-deployments']));
    requireCondition(after.some(item => item.deploymentId === deploymentId &&
      item.versionNumber === report.newVersion), 'DEPLOYMENT_VERIFICATION_FAILED');
    report.deployment = 'verified';
    report.status = 'deployed';
    report.stage = 'complete';
    report.helpers = 'preserved_exactly';
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
}

async function verifyWebApp(deploymentId, request = fetch) {
  const response = await request(`https://script.google.com/macros/s/${deploymentId}/exec`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: '{}', redirect: 'follow', signal: AbortSignal.timeout(60000),
  });
  requireCondition(response.ok, 'WEBAPP_HTTP_FAILED');
  const body = await response.json();
  requireCondition(body && body.ok === false, 'WEBAPP_INVALID_RESPONSE');
  requireCondition(body.error !== 'CONFIGURATION', 'WEBAPP_RUNTIME_CONFIGURATION_REQUIRED');
  requireCondition(body.error === 'INVALID_ENVELOPE', 'WEBAPP_UNSIGNED_REQUEST_NOT_REJECTED');
}

async function main() {
  const report = {
    status: 'failed', stage: 'guards', sourceUpload: 'not_attempted',
    deployment: 'not_attempted', migration: 'not_attempted',
  };
  try {
    deploy(process.env, path.resolve(__dirname, '..', '..'), report);
    report.stage = 'webapp_smoke_test';
    await verifyWebApp(process.env.CLASP_DEPLOYMENT_ID);
    report.webApp = 'verified_unsigned_request_rejected';
    report.stage = 'complete';
  } catch (error) {
    if (report.deployment === 'verified') report.status = 'deployed_smoke_failed';
    report.error = /^[A-Z][A-Z_]+$/.test(error.message) ? error.message : 'DEPLOYMENT_FAILED';
    process.exitCode = 1;
  } finally {
    const text = JSON.stringify(report, null, 2) + '\n';
    if (process.env.PHCEP_CODE_REPORT_PATH) {
      fs.writeFileSync(process.env.PHCEP_CODE_REPORT_PATH, text, { mode: 0o600 });
    }
    console.log(text);
  }
}

if (require.main === module) main();

module.exports = { deploy, prepare, project, verifyWebApp, SCRIPT_ID };
