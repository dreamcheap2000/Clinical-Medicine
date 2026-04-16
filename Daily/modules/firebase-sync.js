/**
 * modules/firebase-sync.js
 * Syncs OPD session data to Google Firebase Firestore.
 *
 * Uses the Firebase JS SDK loaded from CDN (no bundler required).
 * Firebase project config is stored in localStorage under FIREBASE_SETTINGS_KEY
 * and configured through the Settings page.
 *
 * Firestore collection: "opdSessions"
 * Document ID = session.id
 */

const FIREBASE_SETTINGS_KEY = 'firebaseSync_v1';

export function getFirebaseSettings() {
  try { return JSON.parse(localStorage.getItem(FIREBASE_SETTINGS_KEY) || 'null') || {}; }
  catch { return {}; }
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
  const { getFirestore, doc, setDoc, getDoc } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');

  /* Reuse existing app if already initialised for this project */
  const existingApp = getApps().find(a => a.options.projectId === cfg.projectId);
  _app = existingApp || initializeApp(cfg, `opd-${cfg.projectId}`);
  _db  = getFirestore(_app);

  /* Expose helpers on the cached db object for later use */
  _db._doc    = doc;
  _db._setDoc = setDoc;
  _db._getDoc = getDoc;

  return _db;
}

/**
 * Write (upsert) one session to Firestore.
 * Collection: "opdSessions", document ID: session.id
 * Returns true on success, false if not configured, throws on error.
 */
export async function syncSessionToFirestore(session) {
  const cfg = getFirebaseSettings();
  if (!cfg.apiKey || !cfg.projectId) return false; /* not configured */

  const db  = await getDb();
  const ref = db._doc(db, 'opdSessions', session.id);
  await db._setDoc(ref, { ...session, syncedAt: new Date().toISOString() }, { merge: true });
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
    /* Try reading a harmless probe doc */
    const ref = db._doc(db, 'opdSessions', '__probe__');
    await db._getDoc(ref);
    return { ok: true, message: `Connected ✓ — project: ${cfg.projectId}` };
  } catch(e) {
    /* Firestore may return a permissions error which still proves connectivity */
    if (e.code === 'permission-denied') {
      return { ok: true, message: `Connected ✓ — project: ${cfg.projectId} (permissions limited, but reachable)` };
    }
    return { ok: false, message: e.message };
  }
}
