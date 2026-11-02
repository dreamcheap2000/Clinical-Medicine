'use strict';

const crypto = require('node:crypto');
const express = require('express');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const { GoogleAuth } = require('google-auth-library');

const MAX_RESPONSE_BYTES = 1024 * 1024;
const TIMEOUT_MS = 15000;
const PATIENT_KEYS = [
  'rowId', 'patientId', 'name', 'birthday', 'gender', 'visitDate', 'enrollmentDate',
  'careStage', 'acuteAdmissionDate', 'physicianId', 'physicianName',
  'primaryDiagnosisCategory', 'primaryDiagnosisCode', 'examDate', 'heightCm',
  'weightKg', 'waistCm', 'labDate', 'hba1cPercent', 'glycatedAlbuminPercent',
  'fastingGlucoseMgDl', 'totalCholesterolMgDl', 'triglyceridesMgDl',
  'ldlCMgDl', 'hdlCMgDl', 'systolicMmHg', 'diastolicMmHg',
  'smoking', 'alcohol', 'betelNut'
];
const NESTED_KEYS = {
  history: [
    'acuteCoronarySyndrome', 'coronaryRevascularization', 'intracranialOrCarotidStenosis',
    'aorticArchAtherosclerosis', 'coronaryArteryDisease', 'peripheralArteryDisease',
    'coronaryAngiography', 'coronaryOrPeripheralCT', 'carotidOrPeripheralUltrasound',
    'miWithinOneYear', 'twoOrMoreMIs', 'multivesselCoronaryObstruction', 'acsWithDiabetes',
    'padOrCarotidStenosis', 'coronaryArteryDiseaseCriterion', 'carotidStenosisCriterion'
  ],
  lifestyleScores: [
    'positiveSocialConnection', 'physicalActivity', 'harmfulSubstanceAvoidance',
    'sleepAndStressManagement', 'nutrition'
  ]
};

class ApiError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

function configuration(env = process.env) {
  if (!env.PATIENT_API_TOKEN || env.PATIENT_API_TOKEN.length < 32 ||
      /REPLACE/i.test(env.PATIENT_API_TOKEN) || /\s/.test(env.PATIENT_API_TOKEN) ||
      [env.LINE_CHANNEL_SECRET, env.GATEWAY_SIGNING_SECRET,
        env.PATIENT_APPS_SCRIPT_SIGNING_SECRET].includes(env.PATIENT_API_TOKEN)) {
    throw new Error('Configure PATIENT_API_TOKEN with at least 32 random non-whitespace characters.');
  }
  const mode = env.PATIENT_BACKEND || 'GOOGLE_SHEETS';
  const config = { mode, token: env.PATIENT_API_TOKEN };
  if (mode === 'GOOGLE_SHEETS') {
    let credentials;
    try {
      credentials = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON || '');
    } catch {
      throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON must be valid service-account JSON.');
    }
    if (credentials.type !== 'service_account' ||
        typeof credentials.client_email !== 'string' ||
        typeof credentials.private_key !== 'string' ||
        !credentials.private_key.includes('-----BEGIN PRIVATE KEY-----') ||
        !/^[A-Za-z0-9_-]+$/.test(env.GOOGLE_SHEET_ID || '') ||
        /REPLACE/i.test(env.GOOGLE_SHEET_ID)) {
      throw new Error('Configure service-account credentials and GOOGLE_SHEET_ID.');
    }
    config.credentials = {
      client_email: credentials.client_email,
      private_key: credentials.private_key
    };
    config.sheetId = env.GOOGLE_SHEET_ID;
    config.tab = env.GOOGLE_SHEET_TAB || 'NHI高血脂個案';
  } else if (mode === 'APPS_SCRIPT') {
    let url;
    try {
      url = new URL(env.PHCEP_PATIENT_APPS_SCRIPT_URL);
    } catch {
      throw new Error('Configure PHCEP_PATIENT_APPS_SCRIPT_URL.');
    }
    if (url.protocol !== 'https:' || url.hostname !== 'script.google.com' ||
        url.port || url.username || url.password || url.search || url.hash ||
        !/^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url.pathname) ||
        /REPLACE/i.test(url.pathname)) {
      throw new Error('Invalid PHCEP_PATIENT_APPS_SCRIPT_URL.');
    }
    const secret = env.PATIENT_APPS_SCRIPT_SIGNING_SECRET;
    if (!secret || secret.length < 32 || /REPLACE/i.test(secret) ||
        secret === config.token) {
      throw new Error('Configure a distinct PATIENT_APPS_SCRIPT_SIGNING_SECRET.');
    }
    config.url = url.href;
    config.signingSecret = secret;
  } else {
    throw new Error('PATIENT_BACKEND must be GOOGLE_SHEETS or APPS_SCRIPT.');
  }
  return config;
}

function authorized(header, token) {
  if (typeof header !== 'string') return false;
  const expected = crypto.createHash('sha256').update('Bearer ' + token).digest();
  const actual = crypto.createHash('sha256').update(header).digest();
  return crypto.timingSafeEqual(actual, expected);
}

async function jsonResponse(response) {
  if (!response.ok) throw new ApiError(502, 'GOOGLE_HTTP_ERROR');
  const parts = [];
  let length = 0;
  for await (const part of response.body) {
    length += part.length;
    if (length > MAX_RESPONSE_BYTES) throw new ApiError(502, 'GOOGLE_RESPONSE_TOO_LARGE');
    parts.push(Buffer.from(part));
  }
  try {
    return JSON.parse(Buffer.concat(parts).toString('utf8'));
  } catch {
    throw new ApiError(502, 'GOOGLE_INVALID_JSON');
  }
}

function validPatient(patient) {
  return patient && typeof patient === 'object' && !Array.isArray(patient) &&
    Number.isSafeInteger(patient.rowId) && patient.rowId > 0 &&
    ['patientId'].every(key =>
      typeof patient[key] === 'string' && patient[key].trim().length > 0);
}

function validateResult(result, pending) {
  if (!result || result.success !== true) throw new ApiError(502, 'BACKEND_REJECTED');
  if (pending && result.patient !== null && !validPatient(result.patient)) {
    throw new ApiError(502, 'INVALID_PATIENT_RECORD');
  }
  if (!pending) return { success: true };
  if (result.patient === null) return { success: true, patient: null };
  const patient = {};
  PATIENT_KEYS.forEach(key => {
    if (Object.hasOwn(result.patient, key)) patient[key] = result.patient[key];
  });
  Object.entries(NESTED_KEYS).forEach(([group, keys]) => {
    const source = result.patient[group];
    if (!source || typeof source !== 'object' || Array.isArray(source)) return;
    patient[group] = {};
    keys.forEach(key => {
      if (Object.hasOwn(source, key)) patient[group][key] = source[key];
    });
  });
  return { success: true, patient };
}

function appsScriptBackend(config, fetcher = fetch) {
  async function call(action, payload) {
    const envelope = {
      version: 1, action, timestamp: Date.now(), nonce: crypto.randomUUID(),
      rawBody: Buffer.from(JSON.stringify(payload)).toString('base64')
    };
    const canonical = `1\n${action}\n${envelope.timestamp}\n${envelope.nonce}\n${envelope.rawBody}`;
    envelope.signature = crypto.createHmac('sha256', config.signingSecret)
      .update(canonical).digest('base64');
    const signal = AbortSignal.timeout(30000);
    let response = await fetcher(config.url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(envelope), redirect: 'manual', signal
    });
    // ContentService redirects the result, not the signed POST body.
    if ([302, 303].includes(response.status)) {
      let location;
      try {
        location = new URL(response.headers.get('location'));
      } catch {
        throw new ApiError(502, 'GOOGLE_REDIRECT_REJECTED');
      }
      if (location.protocol !== 'https:' || location.hostname !== 'script.googleusercontent.com' ||
          location.port || location.username || location.password || location.hash ||
          location.pathname !== '/macros/echo') {
        throw new ApiError(502, 'GOOGLE_REDIRECT_REJECTED');
      }
      response = await fetcher(location.href, { method: 'GET', redirect: 'error', signal });
    }
    const result = await jsonResponse(response);
    if (result.success !== true && Number.isInteger(result.status) &&
        [400, 404, 409, 503].includes(result.status) && /^[A-Z_]+$/.test(result.error || '')) {
      throw new ApiError(result.status, result.error);
    }
    return action === 'patient.pending' || action === 'patient.complete' ?
      validateResult(result, action === 'patient.pending') : result;
  }
  return {
    pending: () => call('patient.pending', {}),
    complete: rowId => call('patient.complete', { rowId }),
    preview: patient => call('patient.preview', { patient }),
    extract: payload => call('patient.extract', payload)
  };
}

function columnName(index) {
  let result = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    result = String.fromCharCode(65 + (n - 1) % 26) + result;
  }
  return result;
}

function sheetRecords(values) {
  if (!Array.isArray(values) || !Array.isArray(values[0])) {
    throw new ApiError(502, 'SHEET_SCHEMA_ERROR');
  }
  const headers = values[0];
  const required = ['rowId', 'patientId', 'name', 'birthday', 'workflowStatus'];
  if (required.some(key => headers.filter(header => header === key).length !== 1) ||
      new Set(headers).size !== headers.length ||
      headers.some(header => typeof header !== 'string' || !header ||
        /(^|\.)(__proto__|constructor|prototype)(\.|$)/.test(header))) {
    throw new ApiError(502, 'SHEET_SCHEMA_ERROR');
  }
  const records = [];
  const ids = new Set();
  values.slice(1).forEach((row, index) => {
    if (!row.some(value => value !== '' && value !== null && value !== undefined)) return;
    const rawId = row[headers.indexOf('rowId')];
    const id = typeof rawId === 'number' ? rawId :
      typeof rawId === 'string' && /^[1-9]\d*$/.test(rawId) ? Number(rawId) : NaN;
    if (!Number.isSafeInteger(id) || id <= 0 || ids.has(id)) {
      throw new ApiError(502, 'SHEET_ROW_ID_ERROR');
    }
    ids.add(id);
    const patient = { rowId: id };
    headers.forEach((key, column) => {
      const value = row[column];
      if (value === undefined || value === '') return;
      if (/^(history|lifestyleScores)\.[A-Za-z]+$/.test(key)) {
        const [group, field] = key.split('.');
        patient[group] ||= {};
        if (group === 'history') {
          if (value !== true && value !== false) throw new ApiError(502, 'SHEET_BOOLEAN_ERROR');
        }
        patient[group][field] = value;
      } else if (PATIENT_KEYS.includes(key) && key !== 'rowId') {
        patient[key] = value;
      }
    });
    const status = row[headers.indexOf('workflowStatus')];
    if (!['DRAFT', 'PENDING', 'COMPLETE'].includes(status)) {
      throw new ApiError(502, 'SHEET_STATUS_ERROR');
    }
    records.push({ patient, status, sheetRow: index + 2 });
  });
  return { headers, records };
}

function sheetsBackend(config, fetcher = fetch, auth = new GoogleAuth({
  credentials: config.credentials,
  scopes: ['https://www.googleapis.com/auth/spreadsheets']
})) {
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${config.sheetId}/values/`;
  const tab = "'" + config.tab.replace(/'/g, "''") + "'";
  async function call(range, method = 'GET', body) {
    const headers = await auth.getRequestHeaders();
    const url = base + encodeURIComponent(range) +
      (method === 'GET' ? '?valueRenderOption=UNFORMATTED_VALUE' : '?valueInputOption=RAW');
    const response = await fetcher(url, {
      method, headers: {
        Authorization: headers.get('authorization'), 'Content-Type': 'application/json'
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    return jsonResponse(response);
  }
  async function read() {
    return sheetRecords((await call(tab)).values);
  }
  return {
    async pending() {
      const { records } = await read();
      const next = records.find(record => record.status === 'PENDING');
      return validateResult({ success: true, patient: next ? next.patient : null }, true);
    },
    async complete(rowId) {
      // Row insertion cannot be made atomic with this API's read-then-write.
      throw new ApiError(503, 'LOCKED_WRITER_REQUIRED');
    }
  };
}

function createApp(config, backend) {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.get('/healthz', (req, res) => res.json({ success: true }));
  // A per-process global cap avoids relying on spoofable forwarding headers.
  app.use('/api', rateLimit({
    windowMs: 60000, limit: 60, keyGenerator: () => 'patient-api',
    standardHeaders: 'draft-8', legacyHeaders: false,
    handler: (req, res) => res.status(429).json({ success: false, error: 'RATE_LIMITED' })
  }));
  app.use('/api', (req, res, next) => {
    if (!authorized(req.headers.authorization, config.token)) {
      return res.status(401).json({ success: false, error: 'UNAUTHORIZED' });
    }
    next();
  });
  app.get('/api/pending', async (req, res) => {
    if (Object.keys(req.query).length) throw new ApiError(400, 'INVALID_QUERY');
    res.json(validateResult(await backend.pending(), true));
  });
  app.post('/api/complete', express.json({ limit: '2kb', strict: true }), async (req, res) => {
    if (!req.is('application/json')) throw new ApiError(415, 'JSON_REQUIRED');
    if (Object.keys(req.query).length || !req.body ||
        Object.keys(req.body).join(',') !== 'rowId' ||
        !Number.isSafeInteger(req.body.rowId) || req.body.rowId < 1) {
      throw new ApiError(400, 'INVALID_ROW_ID');
    }
    res.json(validateResult(await backend.complete(req.body.rowId), false));
  });
  for (const [path, method] of [['preview', 'preview'], ['extract', 'extract']]) {
    app.post('/api/' + path, express.json({ limit: '16kb', strict: true }), async (req, res) => {
      if (!req.is('application/json')) throw new ApiError(415, 'JSON_REQUIRED');
      if (Object.keys(req.query).length) throw new ApiError(400, 'INVALID_QUERY');
      const payload = validateExtraction(req.body, method === 'extract');
      if (typeof backend[method] !== 'function') throw new ApiError(503, 'LOCKED_WRITER_REQUIRED');
      const result = await backend[method](method === 'preview' ? payload.patient : payload);
      if (!result || result.success !== true) throw new ApiError(502, 'BACKEND_REJECTED');
      if (method === 'preview') {
        if (!Number.isSafeInteger(result.existingCount) || result.existingCount < 0 ||
            typeof result.sameVisitExists !== 'boolean' ||
            typeof result.previewToken !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(result.previewToken) ||
            ['previousVisitDate', 'suggestedEnrollmentDate'].some(key => result[key] !== null &&
              (typeof result[key] !== 'string' || !/^\d{4}\/\d{2}\/\d{2}$/.test(result[key])))) {
          throw new ApiError(502, 'INVALID_PREVIEW');
        }
        res.json({
          success: true, existingCount: result.existingCount, sameVisitExists: result.sameVisitExists,
          previousVisitDate: result.previousVisitDate, suggestedEnrollmentDate: result.suggestedEnrollmentDate,
          previewToken: result.previewToken
        });
      } else {
        if (!Number.isSafeInteger(result.rowId) || result.rowId < 1 || result.workflowStatus !== 'DRAFT') {
          throw new ApiError(502, 'INVALID_EXTRACTION_RESULT');
        }
        res.json({ success: true, rowId: result.rowId, workflowStatus: 'DRAFT' });
      }
    });
  }
  app.use((req, res) => res.status(404).json({ success: false, error: 'NOT_FOUND' }));
  app.use((error, req, res, next) => {
    const status = error instanceof ApiError ? error.status :
      error.type === 'entity.too.large' ? 413 :
      error.type === 'entity.parse.failed' ? 400 : 502;
    const code = error instanceof ApiError ? error.code :
      status === 413 ? 'PAYLOAD_TOO_LARGE' :
      status === 400 ? 'INVALID_JSON' : 'BACKEND_UNAVAILABLE';
    console.error('patient_gateway_error', JSON.stringify({ status, code }));
    res.status(status).json({ success: false, error: code });
  });
  return app;
}

function validateExtraction(body, saving) {
  const allowed = saving ? ['patient', 'previewToken', 'useSuggestedEnrollmentDate', 'requestId'] : ['patient'];
  if (!body || Array.isArray(body) || Object.keys(body).some(key => !allowed.includes(key)) ||
      !body.patient || Array.isArray(body.patient) || typeof body.patient !== 'object') {
    throw new ApiError(400, 'INVALID_EXTRACTION');
  }
  const patient = body.patient;
  if (typeof patient.patientId !== 'string' || !/^[A-Z][A-Z0-9]\d{8}$/.test(patient.patientId) ||
      Object.keys(patient).some(key => key === 'rowId' ||
        (!PATIENT_KEYS.includes(key) && !Object.hasOwn(NESTED_KEYS, key)))) {
    throw new ApiError(400, 'INVALID_EXTRACTION');
  }
  for (const [key, value] of Object.entries(patient)) {
    if (Object.hasOwn(NESTED_KEYS, key)) {
      if (!value || Array.isArray(value) || typeof value !== 'object' ||
          Object.entries(value).some(([field, v]) => !NESTED_KEYS[key].includes(field) ||
            (key === 'history' ? typeof v !== 'boolean' :
              !Number.isInteger(v) || v < 0 || v > 10))) throw new ApiError(400, 'INVALID_EXTRACTION');
    } else if (!['string', 'number'].includes(typeof value) ||
        (typeof value === 'number' && !Number.isFinite(value)) ||
        String(value).length > 100 || /^[=+\-@]/.test(String(value)) ||
        /[\u0000-\u001f\u007f]/.test(String(value))) {
      throw new ApiError(400, 'INVALID_EXTRACTION');
    }
  }
  if (saving && (typeof body.previewToken !== 'string' || body.previewToken.length > 200 ||
      typeof body.useSuggestedEnrollmentDate !== 'boolean' ||
      typeof body.requestId !== 'string' || !/^[a-zA-Z0-9-]{20,80}$/.test(body.requestId))) {
    throw new ApiError(400, 'INVALID_EXTRACTION');
  }
  return body;
}

module.exports = { configuration, authorized, createApp, appsScriptBackend, validateExtraction,
  sheetsBackend, sheetRecords, columnName, validateResult };
