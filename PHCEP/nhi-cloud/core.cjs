'use strict';
const crypto = require('node:crypto');

class CloudError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}
const fail = (status, code) => { throw new CloudError(status, code); };
const hash = value => crypto.createHash('sha256').update(value).digest('base64url');
const random = () => crypto.randomBytes(32).toString('base64url');
const uuid = value => typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const email = value => typeof value === 'string' && value.length <= 254 &&
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

function configuration(env = process.env) {
  const names = ['PUBLIC_ORIGIN', 'DATABASE_URL', 'DATA_ENCRYPTION_KEY',
    'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'EXTENSION_IDS'];
  if (names.some(k => !env[k] || /REPLACE/.test(env[k]))) fail(503, 'CONFIGURATION_REQUIRED');
  const origin = new URL(env.PUBLIC_ORIGIN);
  if (origin.protocol !== 'https:' || origin.origin !== env.PUBLIC_ORIGIN ||
      origin.username || origin.password) fail(503, 'INVALID_PUBLIC_ORIGIN');
  const key = Buffer.from(env.DATA_ENCRYPTION_KEY, 'base64');
  if (key.length !== 32 || key.toString('base64') !== env.DATA_ENCRYPTION_KEY) fail(503, 'INVALID_ENCRYPTION_KEY');
  const extensionIds = env.EXTENSION_IDS.split(',').map(s => s.trim());
  if (extensionIds.some(s => !/^[a-p]{32}$/.test(s))) fail(503, 'INVALID_EXTENSION_IDS');
  if (!['true', 'false'].includes(env.CLINICAL_DATA_ENABLED || 'false')) fail(503, 'INVALID_DATA_POLICY');
  return {
    origin: origin.origin, databaseUrl: env.DATABASE_URL, key, extensionIds,
    clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET,
    clinicalEnabled: env.CLINICAL_DATA_ENABLED === 'true'
  };
}

function vault(key) {
  return {
    seal(value, context) {
      const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      cipher.setAAD(Buffer.from(context));
      const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64');
    },
    open(value, context) {
      try {
        const bytes = Buffer.from(value, 'base64'), decipher = crypto.createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
        decipher.setAAD(Buffer.from(context)); decipher.setAuthTag(bytes.subarray(12, 28));
        return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8'));
      } catch { fail(503, 'CREDENTIAL_DECRYPTION_FAILED'); }
    }
  };
}
function receiverUrl(value) {
  let url;
  try { url = new URL(value); } catch { fail(400, 'INVALID_RECEIVER_URL'); }
  if (url.protocol !== 'https:' || url.hostname !== 'script.google.com' || url.port ||
      url.username || url.password || url.search || url.hash ||
      !/^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url.pathname)) fail(400, 'INVALID_RECEIVER_URL');
  return url.href;
}
function exact(body, keys) {
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
      Object.keys(body).some(k => !keys.includes(k))) fail(400, 'INVALID_REQUEST');
}
module.exports = { CloudError, fail, hash, random, uuid, email, configuration, vault, receiverUrl, exact };
