'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');

function replaceOnce(source, before, after) {
  if (source.split(before).length !== 2) throw new Error('Upstream contract changed: ' + before.slice(0, 60));
  return source.replace(before, after);
}
function build(origin) {
  const url = new URL(origin);
  if (url.protocol !== 'https:' || url.origin !== origin || url.username || url.password ||
      url.hostname === 'clinical-medicine.onrender.com') throw new Error('Use a NEW HTTPS service origin, never the LINE gateway.');
  const dest = path.join(__dirname, '.build');
  const ext = path.join(dest, 'extension'), receiver = path.join(dest, 'receiver');
  fs.mkdirSync(ext, { recursive: true }); fs.mkdirSync(receiver, { recursive: true });
  for (const name of ['background.js', 'options.html', 'options.js', 'options.css']) {
    fs.copyFileSync(path.join(__dirname, 'extension', name), path.join(ext, name));
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'extension', 'manifest.json')));
  manifest.host_permissions = [origin + '/*', 'https://medvpn.nhi.gov.tw/qmue1000/QMUE1002S01.aspx*'];
  fs.writeFileSync(path.join(ext, 'manifest.json'), JSON.stringify(manifest, null, 2));
  fs.writeFileSync(path.join(ext, 'config.js'), "'use strict';\nconst NHI_ORIGIN = " + JSON.stringify(origin) + ';\n');
  const upstream = fs.readFileSync(path.join(__dirname, 'vendor', 'NHI_High_Risk_Hyperlipidemia.user.js'));
  if (crypto.createHash('sha256').update(upstream).digest('hex') !==
      '88ed53c45596dcb80a3261f77eda1ded44d93314862e278412f10c5a691e0127') throw new Error('Review the changed upstream userscript before building.');
  let body = upstream.toString('utf8').replace(/\r\n/g, '\n');
  body = body.slice(body.indexOf("  const CONFIG ="), body.lastIndexOf('})();'));
  body = replaceOnce(body, "apiBaseUrl: 'https://clinical-medicine.onrender.com'", 'apiBaseUrl: bootstrap.origin');
  const tokenStart = body.indexOf("  const TOKEN_KEY");
  const fieldsStart = body.indexOf('  const OPTIONAL_TOP_LEVEL_KEYS');
  if (tokenStart < 0 || fieldsStart < tokenStart) throw new Error('Upstream token block changed.');
  body = body.slice(0, tokenStart) + body.slice(fieldsStart);
  const urlStart = body.indexOf('  function buildApiUrl('), requestStart = body.indexOf('  function requestJson(');
  if (urlStart < 0 || requestStart < urlStart) throw new Error('Upstream request block changed.');
  body = body.slice(0, urlStart) + `  function buildApiUrl(path) {
    return bootstrap.origin + path;
  }
  function requestHeaders() { return { Accept: 'application/json' }; }

` + body.slice(requestStart);
  const menus = body.indexOf("    GM_registerMenuCommand('Configure clinician token'");
  const end = body.indexOf('\n  }\n\n  createPanel();', menus);
  if (menus < 0 || end < menus) throw new Error('Upstream panel menu block changed.');
  body = body.slice(0, menus) + body.slice(end);
  body = replaceOnce(body, 'Render rejected clinician authorization. Reconfigure your token.',
    'Login expired or was revoked. Open NHI clinic setup and sign in again.');
  body = replaceOnce(body, 'Could not reach Render. Check the hostname, @connect permission, and authorization.',
    'Could not reach the clinic service. Open NHI clinic setup and check the connection.');
  if (/GM_getValue|GM_setValue|GM_deleteValue|TOKEN_KEY|clinical-medicine\.onrender\.com/.test(body)) throw new Error('Legacy credential handling survived migration.');
  const bridge = fs.readFileSync(path.join(__dirname, 'extension', 'content-bridge.js'), 'utf8');
  const content = replaceOnce(bridge, '  /* NHI_ASSISTANT_BODY */', body);
  new vm.Script(content);
  fs.writeFileSync(path.join(ext, 'content.js'), content);
  const shared = path.join(__dirname, '..', 'nhi-sheet-script');
  for (const name of ['NhiSheet.gs', 'NhiImportDialog.html']) fs.copyFileSync(path.join(shared, name), path.join(receiver, name));
  let api = fs.readFileSync(path.join(shared, 'NhiPatientApi.gs'), 'utf8').replace(/\r\n/g, '\n');
  api = replaceOnce(api, "!['patient.pending', 'patient.complete', 'patient.preview', 'patient.extract'].includes(envelope.action)",
    "!['patient.pending', 'patient.complete', 'patient.preview', 'patient.extract', 'patient.health'].includes(envelope.action)");
  api = replaceOnce(api, '  const rows = nhiApiRecords_(sheet);',
    `  if (action === 'patient.health') {
    const headers = sheet.getRange(1, 1, 1, NHI_HEADERS_.length).getValues()[0];
    if (headers.some(function(key, i) { return key !== NHI_HEADERS_[i]; })) nhiApiError_(503, 'SHEET_SETUP_REQUIRED');
    return { success: true, schemaVersion: 1, sheetId: sheet.getParent().getId() };
  }
  const rows = nhiApiRecords_(sheet);`);
  fs.writeFileSync(path.join(receiver, 'NhiPatientApi.gs'), api);
  fs.copyFileSync(path.join(__dirname, 'receiver', 'NhiCloudPair.gs'), path.join(receiver, 'NhiCloudPair.gs'));
  const appManifest = JSON.parse(fs.readFileSync(path.join(shared, 'appsscript.json')));
  appManifest.webapp = { access: 'ANYONE_ANONYMOUS', executeAs: 'USER_DEPLOYING' };
  fs.writeFileSync(path.join(receiver, 'appsscript.json'), JSON.stringify(appManifest, null, 2));
  return dest;
}
if (require.main === module) {
  try { console.log(build(process.env.PUBLIC_ORIGIN)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { build };
