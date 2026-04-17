/**
 * modules/firebase-sync.js
 * Syncs OPD session data to Google Firebase Firestore using FHIR-native granularity.
 *
 * FHIR mapping:
 *   S/O (Subjective/Objective)  → fhir/Observation
 *   A   (Assessment)            → fhir/Condition + fhir/ClinicalImpression
 *   P   (Plan)                  → fhir/CarePlan
 *
 * Uses the Firebase JS SDK loaded from CDN (no bundler required).
 * Firebase project config is stored in localStorage under FIREBASE_SETTINGS_KEY
 * and configured through the Settings page.
 * A default project config is baked in as a fallback when no settings are saved yet.
 *
 * Firestore collections:
 *   "opdSessions"               — raw session document (document ID = session.id)
 *   "fhir/Observation"          — FHIR Observation resources
 *   "fhir/Condition"            — FHIR Condition resources
 *   "fhir/ClinicalImpression"   — FHIR ClinicalImpression resources
 *   "fhir/CarePlan"             — FHIR CarePlan resources
 */

const FIREBASE_SETTINGS_KEY = 'firebaseSync_v1';

/** Default project config (phcep-94e92). Overridden by settings saved in localStorage. */
const DEFAULT_FIREBASE_CONFIG = {
  apiKey:            'AIzaSyB5mafJ-B7bgAqmjCzW2ePmfwMKfR9kZJA',
  authDomain:        'phcep-94e92.firebaseapp.com',
  projectId:         'phcep-94e92',
  storageBucket:     'phcep-94e92.firebasestorage.app',
  messagingSenderId: '1003364373709',
  appId:             '1:1003364373709:web:aa6fc1d0fcca7bb7690584',
  measurementId:     'G-XBEWNC7K1W',
};

export function getFirebaseSettings() {
  try {
    const stored = JSON.parse(localStorage.getItem(FIREBASE_SETTINGS_KEY) || 'null');
    /* Merge default config so all required fields are always present */
    return stored?.apiKey ? stored : { ...DEFAULT_FIREBASE_CONFIG, enabled: false };
  }
  catch { return { ...DEFAULT_FIREBASE_CONFIG, enabled: false }; }
}

export function saveFirebaseSettings(settings) {
  localStorage.setItem(FIREBASE_SETTINGS_KEY, JSON.stringify(settings));
}

/* Lazy-loaded Firebase instances */
let _db  = null;
let _app = null;

async function getDb() {
  if (_db) return _db;

  const cfg = getFirebaseSettings();
  if (!cfg.apiKey || !cfg.projectId) throw new Error('Firebase not configured.');

  /* Dynamically import Firebase SDK from CDN */
  const { initializeApp, getApps } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js');
  const { getFirestore, doc, setDoc, getDoc, collection, addDoc } =
    await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');

  /* Reuse existing app if already initialised for this project */
  const existingApp = getApps().find(a => a.options.projectId === cfg.projectId);
  _app = existingApp || initializeApp(cfg, `opd-${cfg.projectId}`);
  _db  = getFirestore(_app);

  /* Expose helpers on the cached db object for later use */
  _db._doc       = doc;
  _db._setDoc    = setDoc;
  _db._getDoc    = getDoc;
  _db._collection = collection;
  _db._addDoc    = addDoc;

  return _db;
}

/* ------------------------------------------------------------------ */
/* FHIR resource builders                                               */
/* ------------------------------------------------------------------ */

/**
 * Build a minimal FHIR R4 Observation resource from the S/O SOAP text.
 * Reference: https://www.hl7.org/fhir/observation.html
 */
function buildFhirObservation(session) {
  return {
    resourceType: 'Observation',
    id:           `${session.id}-obs`,
    status:       'final',
    code: {
      coding: [{
        system:  'http://loinc.org',
        code:    '55607006',
        display: 'Clinical observation',
      }],
      text: 'Clinical S/O Note',
    },
    subject: session.patientId
      ? { reference: `Patient/${session.patientId}` }
      : { display: 'Unknown patient' },
    effectiveDateTime: session.timestamp
      ? new Date(session.timestamp).toISOString()
      : new Date(session.date).toISOString(),
    valueString: [session.soap?.s, session.soap?.o]
      .filter(Boolean).join('\n') || session.soapText || '',
    note: session.ebm || session.keyLearning
      ? [{ text: session.ebm || session.keyLearning }]
      : undefined,
    _opdSessionId: session.id,
  };
}

/**
 * Build a minimal FHIR R4 Condition resource from the A (Assessment) SOAP section.
 * Reference: https://www.hl7.org/fhir/condition.html
 */
function buildFhirCondition(session) {
  return {
    resourceType: 'Condition',
    id:           `${session.id}-cond`,
    clinicalStatus: {
      coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-clinical', code: 'active' }],
    },
    verificationStatus: {
      coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-ver-status', code: 'provisional' }],
    },
    code: session.icdCode ? {
      coding: [{
        system:  'http://hl7.org/fhir/sid/icd-10-cm',
        code:    session.icdCode,
        display: session.icdDescription || '',
      }],
      text: session.icdDescription || session.icdCode,
    } : { text: session.condition || 'Unknown' },
    subject: session.patientId
      ? { reference: `Patient/${session.patientId}` }
      : { display: 'Unknown patient' },
    recordedDate:   new Date(session.date).toISOString(),
    note: session.soap?.a
      ? [{ text: session.soap.a }]
      : undefined,
    _opdSessionId: session.id,
  };
}

/**
 * Build a minimal FHIR R4 ClinicalImpression from assessment data.
 */
function buildFhirClinicalImpression(session) {
  return {
    resourceType: 'ClinicalImpression',
    id:           `${session.id}-ci`,
    status:       'completed',
    subject: session.patientId
      ? { reference: `Patient/${session.patientId}` }
      : { display: 'Unknown patient' },
    date:         new Date(session.date).toISOString(),
    description:  session.condition || '',
    summary:      session.soap?.a || '',
    finding: session.icdCode ? [{
      itemCodeableConcept: {
        coding: [{
          system:  'http://hl7.org/fhir/sid/icd-10-cm',
          code:    session.icdCode,
          display: session.icdDescription || '',
        }],
      },
    }] : undefined,
    note: session.ebm || session.keyLearning
      ? [{ text: session.ebm || session.keyLearning }]
      : undefined,
    _opdSessionId: session.id,
  };
}

/**
 * Build a minimal FHIR R4 CarePlan resource from the P (Plan) SOAP section.
 * Reference: https://www.hl7.org/fhir/careplan.html
 */
function buildFhirCarePlan(session) {
  return {
    resourceType: 'CarePlan',
    id:           `${session.id}-cp`,
    status:       'active',
    intent:       'plan',
    subject: session.patientId
      ? { reference: `Patient/${session.patientId}` }
      : { display: 'Unknown patient' },
    period:  { start: new Date(session.date).toISOString() },
    description: session.soap?.p || '',
    note: session.soap?.p
      ? [{ text: session.soap.p }]
      : undefined,
    addresses: session.icdCode ? [{
      reference: `Condition/${session.id}-cond`,
    }] : undefined,
    _opdSessionId: session.id,
  };
}

/**
 * Write FHIR resources to dedicated Firestore collections.
 */
async function syncFhirResources(db, session) {
  const upsert = async (col, resource) => {
    const ref = db._doc(db, col, resource.id);
    await db._setDoc(ref, { ...resource, _syncedAt: new Date().toISOString() }, { merge: true });
  };

  const soText = (session.soap?.s || '') + (session.soap?.o || '') + (session.soapText || '');
  if (soText.trim()) await upsert('fhir/Observation', buildFhirObservation(session));

  if (session.icdCode || session.condition) {
    await upsert('fhir/Condition',          buildFhirCondition(session));
    await upsert('fhir/ClinicalImpression', buildFhirClinicalImpression(session));
  }

  const planText = session.soap?.p || '';
  if (planText.trim()) await upsert('fhir/CarePlan', buildFhirCarePlan(session));
}

/* ------------------------------------------------------------------ */
/* Public API                                                           */
/* ------------------------------------------------------------------ */

/**
 * Write (upsert) one session to Firestore and also write FHIR sub-resources.
 * Returns true on success, false if not configured, throws on error.
 */
export async function syncSessionToFirestore(session) {
  const cfg = getFirebaseSettings();
  if (!cfg.apiKey || !cfg.projectId) return false; /* not configured */

  const db  = await getDb();

  /* Raw session document */
  const ref = db._doc(db, 'opdSessions', session.id);
  await db._setDoc(ref, { ...session, syncedAt: new Date().toISOString() }, { merge: true });

  /* FHIR sub-resources */
  await syncFhirResources(db, session);

  return true;
}

/** Quick connectivity test — returns { ok, message } */
export async function testFirebaseConnection() {
  const cfg = getFirebaseSettings();
  if (!cfg.apiKey || !cfg.projectId) {
    return { ok: false, message: 'Settings incomplete. Fill in the Firebase config JSON.' };
  }
  try {
    const db  = await getDb();
    const ref = db._doc(db, 'opdSessions', '__probe__');
    await db._getDoc(ref);
    return { ok: true, message: `Connected ✓ — project: ${cfg.projectId}` };
  } catch(e) {
    if (e.code === 'permission-denied') {
      return { ok: true, message: `Connected ✓ — project: ${cfg.projectId} (permissions limited, but reachable)` };
    }
    return { ok: false, message: e.message };
  }
}

/**
 * Export a single session as a FHIR Bundle JSON string.
 * Useful for FHIR-compatible EHR integrations.
 */
export function exportSessionAsFhirBundle(session) {
  const entries = [];
  const soText  = (session.soap?.s || '') + (session.soap?.o || '') + (session.soapText || '');
  if (soText.trim())
    entries.push({ resource: buildFhirObservation(session) });
  if (session.icdCode || session.condition) {
    entries.push({ resource: buildFhirCondition(session) });
    entries.push({ resource: buildFhirClinicalImpression(session) });
  }
  if (session.soap?.p?.trim())
    entries.push({ resource: buildFhirCarePlan(session) });

  const bundle = {
    resourceType: 'Bundle',
    id:   session.id,
    type: 'collection',
    timestamp:   new Date().toISOString(),
    entry:       entries,
  };

  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/fhir+json' });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), {
    href:     url,
    download: `fhir-bundle-${session.id}.json`,
  });
  a.click();
  URL.revokeObjectURL(url);
}

