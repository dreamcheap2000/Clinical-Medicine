'use strict';
const crypto = require('node:crypto');
const express = require('express');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const { Pool } = require('pg');
const path = require('node:path');
const { CloudError, fail, hash, random, uuid, email, configuration, vault, receiverUrl, exact } = require('./core.cjs');
const { Store } = require('./store.cjs');
const { Google } = require('./google.cjs');
const receiver = require('./receiver.cjs');
const { validateExtraction, validateResult } = require('../gateway/patient-api.cjs');

function createApp(config, store, google, secrets, transport = receiver) {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    const origin = req.get('Origin');
    const allowed = config.extensionIds.map(id => 'chrome-extension://' + id);
    if (origin && !allowed.includes(origin) && origin !== config.origin) return next(new CloudError(403, 'ORIGIN_REJECTED'));
    if (origin && allowed.includes(origin)) {
      res.set('Access-Control-Allow-Origin', origin);
      res.set('Vary', 'Origin');
      res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-NHI-Clinic');
      res.set('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });
  app.get('/healthz', async (req, res) => {
    await store.query('SELECT 1');
    res.json({ success: true, clinicalEnabled: config.clinicalEnabled });
  });
  app.use(rateLimit({ windowMs: 60000, limit: 300, keyGenerator: () => 'nhi-cloud',
    standardHeaders: 'draft-8', legacyHeaders: false,
    handler: (req, res) => res.status(429).json({ success: false, error: 'RATE_LIMITED' }) }));
  app.use(express.json({ limit: '30kb', strict: true }));
  app.get('/auth/start', async (req, res) => {
    const { extension, challenge } = req.query;
    if (!config.extensionIds.includes(extension) || !/^[A-Za-z0-9_-]{43}$/.test(challenge || '')) fail(400, 'INVALID_AUTH_REQUEST');
    const state = random(), verifier = random(), nonce = random();
    await store.query(`DELETE FROM nhi_auth_states WHERE expires<=now()`);
    await store.query(`INSERT INTO nhi_auth_states(hash,google_verifier,nonce,extension_id,challenge,expires)
      VALUES($1,$2,$3,$4,$5,now()+interval '5 minutes')`,
    [hash(state), secrets.seal(verifier, 'oauth:' + hash(state)), nonce, extension, challenge]);
    res.redirect(google.client().generateAuthUrl({
      access_type: 'offline', prompt: 'consent', scope: ['openid', 'email',
        'https://www.googleapis.com/auth/drive.file',
        'https://www.googleapis.com/auth/drive.metadata.readonly',
        'https://www.googleapis.com/auth/spreadsheets'], state, nonce,
      code_challenge: hash(verifier), code_challenge_method: 'S256'
    }));
  });
  app.get('/auth/callback', async (req, res) => {
    if (typeof req.query.state !== 'string' || typeof req.query.code !== 'string') fail(400, 'GOOGLE_LOGIN_CANCELLED');
    const state = await store.one('DELETE FROM nhi_auth_states WHERE hash=$1 AND expires>now() RETURNING *', [hash(req.query.state)]);
    if (!state) fail(401, 'AUTH_STATE_EXPIRED');
    const client = google.client();
    let tokens, identity;
    try {
      tokens = (await client.getToken({ code: req.query.code,
        codeVerifier: secrets.open(state.google_verifier, 'oauth:' + hash(req.query.state)) })).tokens;
      identity = (await client.verifyIdToken({ idToken: tokens.id_token, audience: config.clientId })).getPayload();
    } catch { fail(401, 'GOOGLE_LOGIN_FAILED'); }
    if (!identity || identity.nonce !== state.nonce || identity.email_verified !== true ||
        !email(identity.email) || !identity.sub) fail(401, 'GOOGLE_IDENTITY_REJECTED');
    const old = await store.one('SELECT credentials FROM nhi_users WHERE subject=$1', [identity.sub]);
    const refresh = tokens.refresh_token || (old && secrets.open(old.credentials, 'google:' + identity.sub).refresh_token);
    if (!refresh) fail(401, 'GOOGLE_OFFLINE_ACCESS_REQUIRED');
    await store.query(`INSERT INTO nhi_users(subject,email,credentials) VALUES($1,$2,$3)
      ON CONFLICT(subject) DO UPDATE SET email=$2,credentials=$3`, [identity.sub,
      identity.email.toLowerCase(), secrets.seal({ ...tokens, refresh_token: refresh }, 'google:' + identity.sub)]);
    const code = random();
    await store.query('DELETE FROM nhi_auth_codes WHERE expires<=now()');
    await store.query(`INSERT INTO nhi_auth_codes(hash,subject,challenge,expires)
      VALUES($1,$2,$3,now()+interval '1 minute')`, [hash(code), identity.sub, state.challenge]);
    res.redirect('https://' + state.extension_id + '.chromiumapp.org/nhi#code=' + code);
  });
  app.post('/auth/exchange', async (req, res) => {
    exact(req.body, ['code', 'verifier']);
    if (!/^[A-Za-z0-9_-]{43}$/.test(req.body.code || '') || !/^[A-Za-z0-9_-]{43}$/.test(req.body.verifier || '')) fail(400, 'INVALID_AUTH_REQUEST');
    const code = await store.one(`DELETE FROM nhi_auth_codes WHERE hash=$1 AND challenge=$2
      AND expires>now() RETURNING subject`, [hash(req.body.code), hash(req.body.verifier)]);
    if (!code) fail(401, 'AUTH_CODE_EXPIRED');
    const token = random();
    await store.query('DELETE FROM nhi_sessions WHERE expires<=now()');
    await store.query(`INSERT INTO nhi_sessions(hash,subject,expires) VALUES($1,$2,now()+interval '8 hours')`,
      [hash(token), code.subject]);
    res.json({ success: true, token, expiresAt: Date.now() + 8 * 60 * 60 * 1000 });
  });
  app.use('/api', async (req, res, next) => {
    const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.get('Authorization') || '');
    req.user = await store.session(match && match[1]);
    req.token = match[1];
    next();
  });
  app.get('/api/me', async (req, res) => res.json({
    success: true, email: req.user.email, clinics: await store.clinics(req.user),
    clinicalEnabled: config.clinicalEnabled
  }));
  app.post('/api/logout', async (req, res) => {
    await store.query('DELETE FROM nhi_sessions WHERE hash=$1', [hash(req.token)]);
    res.json({ success: true });
  });
  app.post('/api/clinics', async (req, res) => {
    exact(req.body, ['name']);
    if (typeof req.body.name !== 'string' || !req.body.name.trim() || req.body.name.length > 80 ||
        /[\u0000-\u001f]/.test(req.body.name)) fail(400, 'INVALID_CLINIC_NAME');
    const id = crypto.randomUUID(), key = secrets.seal(random(), 'clinic:' + id);
    await store.query(`WITH clinic AS (INSERT INTO nhi_clinics(id,name,owner_subject,signing_key)
      VALUES($1,$2,$3,$4) RETURNING id)
      INSERT INTO nhi_members(clinic_id,email,subject,role) SELECT id,$5,$3,'admin' FROM clinic`,
    [id, req.body.name.trim(), req.user.subject, key, req.user.email]);
    await store.audit(req.user, id, 'clinic.create', 'success');
    res.status(201).json({ success: true, id });
  });
  app.use('/api/clinic', async (req, res, next) => {
    const id = req.get('X-NHI-Clinic');
    if (!uuid(id)) fail(400, 'WORKSPACE_REQUIRED');
    req.clinic = await store.member(req.user, id);
    next();
  });
  const admin = (req, res, next) => {
    if (req.clinic.role !== 'admin') fail(403, 'ADMIN_REQUIRED');
    next();
  };
  const owner = (req, res, next) => {
    if (req.clinic.owner_subject !== req.user.subject) fail(403, 'WORKSPACE_OWNER_REQUIRED');
    next();
  };
  app.get('/api/clinic/setup', admin, async (req, res) => res.json({
    success: true, id: req.clinic.id, sheetId: req.clinic.sheet_id,
    receiverUrl: req.clinic.receiver_url, ready: req.clinic.ready
  }));
  app.post('/api/clinic/sheet', admin, owner, async (req, res) => {
    exact(req.body, ['sheetId']);
    await store.locked(req.clinic.id, async client => {
      const clinic = (await client.query('SELECT * FROM nhi_clinics WHERE id=$1', [req.clinic.id])).rows[0];
      if (clinic.sheet_id && req.body.sheetId && clinic.sheet_id !== req.body.sheetId) fail(409, 'SHEET_ALREADY_CONNECTED');
      const googleClient = await google.clientFor(req.user);
      const id = clinic.sheet_id || req.body.sheetId || await google.createSheet(googleClient, req.user, clinic);
      await google.owns(googleClient, req.user, id);
      if (req.body.sheetId) await google.validateSheet(googleClient, id);
      else await google.initialize(googleClient, id);
      await client.query('UPDATE nhi_clinics SET sheet_id=$2 WHERE id=$1', [clinic.id, id]);
      await store.audit(req.user, clinic.id, 'sheet.connect', 'success');
      res.json({ success: true, sheetId: id, url: 'https://docs.google.com/spreadsheets/d/' + id + '/edit' });
    });
  });
  app.post('/api/clinic/setup-key', admin, owner, async (req, res) => {
    if (!req.clinic.sheet_id) fail(409, 'SHEET_REQUIRED');
    await store.audit(req.user, req.clinic.id, 'setup.key.view', 'success');
    res.json({ success: true, key: secrets.open(req.clinic.signing_key, 'clinic:' + req.clinic.id) });
  });
  app.post('/api/clinic/receiver', admin, owner, async (req, res) => {
    exact(req.body, ['url']);
    if (!req.clinic.sheet_id) fail(409, 'SHEET_REQUIRED');
    const url = receiverUrl(req.body.url);
    const health = await transport.health(url, secrets.open(req.clinic.signing_key, 'clinic:' + req.clinic.id));
    if (health.sheetId !== req.clinic.sheet_id) fail(409, 'RECEIVER_SHEET_MISMATCH');
    await store.query('UPDATE nhi_clinics SET receiver_url=$2,ready=true WHERE id=$1', [req.clinic.id, url]);
    await store.audit(req.user, req.clinic.id, 'receiver.connect', 'success');
    res.json({ success: true });
  });
  app.get('/api/clinic/members', admin, async (req, res) => res.json({
    success: true, members: (await store.query('SELECT email,role FROM nhi_members WHERE clinic_id=$1 ORDER BY email',
      [req.clinic.id])).rows
  }));
  app.post('/api/clinic/members', admin, async (req, res) => {
    exact(req.body, ['email', 'role']);
    if (!email(req.body.email) || !['admin', 'clinician'].includes(req.body.role)) fail(400, 'INVALID_MEMBER');
    const address = req.body.email.toLowerCase();
    if (address === req.user.email || (await store.one('SELECT email FROM nhi_users WHERE subject=$1',
      [req.clinic.owner_subject])).email === address) fail(409, 'OWNER_ROLE_PROTECTED');
    await store.query(`INSERT INTO nhi_members(clinic_id,email,role) VALUES($1,$2,$3)
      ON CONFLICT(clinic_id,email) DO UPDATE SET role=$3`, [req.clinic.id, address, req.body.role]);
    await store.audit(req.user, req.clinic.id, 'member.grant', 'success');
    res.json({ success: true });
  });
  app.delete('/api/clinic/members', admin, async (req, res) => {
    exact(req.body, ['email']);
    if (!email(req.body.email)) fail(400, 'INVALID_MEMBER');
    const address = req.body.email.toLowerCase();
    const clinicOwner = await store.one('SELECT email FROM nhi_users WHERE subject=$1', [req.clinic.owner_subject]);
    if (address === clinicOwner.email || address === req.user.email) fail(409, 'OWNER_ROLE_PROTECTED');
    await store.query('DELETE FROM nhi_members WHERE clinic_id=$1 AND email=$2', [req.clinic.id, address]);
    await store.audit(req.user, req.clinic.id, 'member.revoke', 'success');
    res.json({ success: true });
  });
  for (const [name, method] of [['pending', 'get'], ['complete', 'post'], ['preview', 'post'], ['extract', 'post']]) {
    app[method]('/api/clinic/' + name, async (req, res) => {
      if (!config.clinicalEnabled) fail(403, 'CLINICAL_DATA_NOT_APPROVED');
      if (!req.clinic.ready) fail(409, 'SETUP_REQUIRED');
      if (name === 'complete') {
        exact(req.body, ['rowId']);
        if (!Number.isSafeInteger(req.body.rowId) || req.body.rowId < 1) fail(400, 'INVALID_ROW_ID');
      } else if (name !== 'pending') validateExtraction(req.body, name === 'extract');
      const api = transport.backend(req.clinic.receiver_url,
        secrets.open(req.clinic.signing_key, 'clinic:' + req.clinic.id));
      await store.audit(req.user, req.clinic.id, 'patient.' + name, 'attempt');
      const result = await api[name](name === 'complete' ? req.body.rowId :
        name === 'preview' ? req.body.patient : name === 'extract' ? req.body : undefined);
      if (!result || result.success !== true) fail(502, 'RECEIVER_INVALID_RESPONSE');
      if (name === 'preview' && (!Number.isSafeInteger(result.existingCount) || result.existingCount < 0 ||
          typeof result.sameVisitExists !== 'boolean' || !/^[A-Za-z0-9+/]{43}=$/.test(result.previewToken || '') ||
          ['previousVisitDate', 'suggestedEnrollmentDate'].some(k => result[k] !== null &&
            !/^\d{4}\/\d{2}\/\d{2}$/.test(result[k] || '')))) fail(502, 'INVALID_PREVIEW');
      if (name === 'extract' && (!Number.isSafeInteger(result.rowId) || result.rowId < 1 ||
          result.workflowStatus !== 'DRAFT')) fail(502, 'INVALID_EXTRACTION_RESULT');
      await store.audit(req.user, req.clinic.id, 'patient.' + name, 'success');
      res.json(name === 'pending' || name === 'complete' ? validateResult(result, name === 'pending') :
        name === 'preview' ? Object.fromEntries(['success', 'existingCount', 'sameVisitExists',
          'previousVisitDate', 'suggestedEnrollmentDate', 'previewToken'].map(k => [k, result[k]])) :
          { success: true, rowId: result.rowId, workflowStatus: result.workflowStatus });
    });
  }
  app.use('/downloads', express.static(path.join(__dirname, '.build', 'receiver'), { dotfiles: 'deny' }));
  app.use((req, res) => res.status(404).json({ success: false, error: 'NOT_FOUND' }));
  app.use((error, req, res, next) => {
    const status = Number.isInteger(error.status) && error.status >= 400 && error.status <= 599 ? error.status : 502;
    const code = error instanceof CloudError ? error.code :
      error.name === 'Error' && error.constructor.name === 'ApiError' ? error.code :
      error.type === 'entity.parse.failed' ? 'INVALID_JSON' :
      error.type === 'entity.too.large' ? 'PAYLOAD_TOO_LARGE' :
      error.code === '23505' ? 'WORKSPACE_CONFLICT' : 'SERVICE_UNAVAILABLE';
    console.error('nhi_cloud_error', JSON.stringify({ status, code }));
    res.status(status).json({ success: false, error: code });
  });
  return app;
}
if (require.main === module) {
  try {
    const config = configuration(), pool = new Pool({ connectionString: config.databaseUrl });
    const store = new Store(pool), secrets = vault(config.key), google = new Google(config, store, secrets);
    pool.on('error', () => console.error('NHI_DATABASE_CONNECTION_FAILED'));
    const server = createApp(config, store, google, secrets).listen(process.env.PORT || 8080,
      () => console.log('NHI clinic service listening'));
    const stop = () => server.close(() => pool.end());
    process.on('SIGTERM', stop);
  } catch (error) { console.error(error instanceof CloudError ? error.code : 'NHI_STARTUP_FAILED'); process.exitCode = 1; }
}
module.exports = { createApp };
