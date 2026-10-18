'use strict';
const { configuredUrl } = require('../server.cjs');

function validate(env = process.env) {
  const mode = env.PHCEP_BACKEND_MODE;
  const results = [
    ['LINE_CHANNEL_SECRET', typeof env.LINE_CHANNEL_SECRET === 'string' &&
      env.LINE_CHANNEL_SECRET.trim().length > 0, 'required non-blank value'],
    ['GATEWAY_SIGNING_SECRET', typeof env.GATEWAY_SIGNING_SECRET === 'string' &&
      env.GATEWAY_SIGNING_SECRET.trim().length >= 32 &&
      env.GATEWAY_SIGNING_SECRET !== env.LINE_CHANNEL_SECRET,
    'at least 32 characters and distinct from LINE_CHANNEL_SECRET'],
    ['PHCEP_BACKEND_MODE', ['APPS_SCRIPT', 'SPRING_BOOT'].includes(mode),
      'explicitly set APPS_SCRIPT or SPRING_BOOT']
  ];
  if (['APPS_SCRIPT', 'SPRING_BOOT'].includes(mode)) {
    const name = mode === 'APPS_SCRIPT' ? 'PHCEP_APPS_SCRIPT_URL' : 'PHCEP_SPRING_BOOT_URL';
    let valid = false;
    try {
      const value = env[name];
      if (typeof value === 'string' && value === value.trim()) {
        configuredUrl(value, mode);
        valid = mode !== 'APPS_SCRIPT' ||
          /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(value);
      }
    } catch { /* Report only the variable name and static guidance. */ }
    results.push([name, valid, mode === 'APPS_SCRIPT'
      ? 'expected https://script.google.com/macros/s/<id>/exec'
      : 'expected HTTPS URL ending in /internal/events; no credentials, query, or fragment']);
  }
  return results;
}

if (require.main === module) {
  if (process.argv.slice(2).some(arg => arg !== '--check')) {
    console.error('Usage: node scripts/validate-config.cjs [--check]');
    process.exitCode = 1;
  } else {
    const results = validate();
    for (const [name, ok, guidance] of results)
      console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `: ${guidance}`}`);
    process.exitCode = results.every(([, ok]) => ok) ? 0 : 1;
  }
}

module.exports = { validate };
