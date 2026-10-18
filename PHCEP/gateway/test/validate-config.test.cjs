'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { validate } = require('../scripts/validate-config.cjs');

const env = {
  LINE_CHANNEL_SECRET: 'synthetic-line-secret',
  GATEWAY_SIGNING_SECRET: 'synthetic-distinct-internal-key-for-tests',
  PHCEP_BACKEND_MODE: 'APPS_SCRIPT',
  PHCEP_APPS_SCRIPT_URL: 'https://script.google.com/macros/s/TEST/exec',
  PHCEP_SPRING_BOOT_URL: 'https://backend.example/internal/events'
};
const passes = values => validate(values).every(([, ok]) => ok);

test('validator accepts both explicit modes and requires each relevant variable', () => {
  for (const mode of ['APPS_SCRIPT', 'SPRING_BOOT']) {
    const values = { ...env, PHCEP_BACKEND_MODE: mode };
    assert.equal(passes(values), true);
    for (const name of ['LINE_CHANNEL_SECRET', 'GATEWAY_SIGNING_SECRET', 'PHCEP_BACKEND_MODE',
      mode === 'APPS_SCRIPT' ? 'PHCEP_APPS_SCRIPT_URL' : 'PHCEP_SPRING_BOOT_URL']) {
      assert.equal(passes({ ...values, [name]: undefined }), false, name);
      assert.equal(passes({ ...values, [name]: '' }), false, name);
    }
  }
  for (const overrides of [
    { LINE_CHANNEL_SECRET: '   ' },
    { GATEWAY_SIGNING_SECRET: 'x'.repeat(31) },
    { GATEWAY_SIGNING_SECRET: ' '.repeat(32) },
    { LINE_CHANNEL_SECRET: env.GATEWAY_SIGNING_SECRET },
    { PHCEP_BACKEND_MODE: 'MIRROR' }
  ]) assert.equal(passes({ ...env, ...overrides }), false);
  assert.equal(passes({ ...env, GATEWAY_SIGNING_SECRET: 'x'.repeat(32) }), true);
  assert.equal(passes({ ...env, PHCEP_BACKEND_MODE: 'SPRING_BOOT',
    PHCEP_SPRING_BOOT_URL: 'https://backend.example:443/internal/events' }), true);
});

test('validator rejects unsafe or non-canonical URLs without exposing input', () => {
  for (const url of [
    'http://script.google.com/macros/s/TEST/exec', 'https://evil.example/macros/s/TEST/exec',
    'https://script.google.com/macros/s/TEST/dev', `${env.PHCEP_APPS_SCRIPT_URL}/`,
    `${env.PHCEP_APPS_SCRIPT_URL}?secret=synthetic-private`,
    `${env.PHCEP_APPS_SCRIPT_URL}#synthetic-private`,
    'https://synthetic-private@script.google.com/macros/s/TEST/exec',
    'https://script.google.com:444/macros/s/TEST/exec', 'not a URL synthetic-private'
  ]) assert.equal(passes({ ...env, PHCEP_APPS_SCRIPT_URL: url }), false);
  for (const url of ['http://backend.example/internal/events',
    'https://backend.example/internal/events/', 'https://backend.example/other',
    'https://synthetic-private@backend.example/internal/events',
    `${env.PHCEP_SPRING_BOOT_URL}?secret=synthetic-private`]) {
    assert.equal(passes({ ...env, PHCEP_BACKEND_MODE: 'SPRING_BOOT', PHCEP_SPRING_BOOT_URL: url }), false);
  }
});

test('CLI is read-only, deterministic, returns exit status, and never prints values', () => {
  const script = path.join(__dirname, '../scripts/validate-config.cjs');
  for (const args of [[], ['--check']]) {
    const result = spawnSync(process.execPath, [script, ...args], { env, encoding: 'utf8' });
    assert.equal(result.status, 0);
    assert.equal(result.stdout, [
      'PASS LINE_CHANNEL_SECRET', 'PASS GATEWAY_SIGNING_SECRET',
      'PASS PHCEP_BACKEND_MODE', 'PASS PHCEP_APPS_SCRIPT_URL', ''
    ].join('\n'));
  }
  for (const values of [{}, { ...env, PHCEP_APPS_SCRIPT_URL: 'synthetic-private' }]) {
    const result = spawnSync(process.execPath, [script, '--check'], { env: values, encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stdout, /FAIL/);
    for (const value of [env.LINE_CHANNEL_SECRET, env.GATEWAY_SIGNING_SECRET,
      env.PHCEP_APPS_SCRIPT_URL, env.PHCEP_SPRING_BOOT_URL, 'synthetic-private'])
      assert.equal(`${result.stdout}${result.stderr}`.includes(value), false);
  }
  const result = spawnSync(process.execPath, [script, 'synthetic-private'], { env, encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.equal(result.stderr.includes('synthetic-private'), false);
});
