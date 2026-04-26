/**
 * modules/settings-view.js
 * Settings page — configure GitHub auto-commit, Firebase Firestore sync,
 * and keyboard shortcut keys.
 */

import { esc, showToast } from '../app.js';
import { getGithubSettings, saveGithubSettings, testGithubConnection } from './github-sync.js';
import { getFirebaseSettings, saveFirebaseSettings, testFirebaseConnection, exportSessionAsFhirBundle } from './firebase-sync.js';
import { getShortcutKeys, saveShortcutKeys, DEFAULT_SHORTCUTS } from '../app.js';

export function renderSettings() {
  const container = document.getElementById('main-content');
  const gh  = getGithubSettings();
  const fb  = getFirebaseSettings();
  const sc  = getShortcutKeys();

  container.innerHTML = `
    <h2 class="page-title">⚙️ Sync Settings</h2>
    <p class="subtitle">Configure cloud backup — GitHub auto-commit and Google Firebase Firestore</p>

    <!-- Shortcut Keys -->
    <div class="card settings-card" id="card-shortcuts">
      <div class="card-title">⌨️ Shortcut Keys</div>
      <p class="hint" style="margin-bottom:.75rem">
        Customise the keyboard shortcuts used throughout the app. Use format like
        <code>Shift+C</code>, <code>C</code>, <code>Ctrl+S</code> etc.
        Keys are case-insensitive. Changes take effect immediately on save.
      </p>
      <form id="form-shortcuts" autocomplete="off">
        <div class="form-row-2">
          <div class="field-group">
            <label class="field-label" for="sc-insert-soap">SOAP Ghost Panel — Insert All</label>
            <input class="field-input" type="text" id="sc-insert-soap"
              placeholder="${esc(DEFAULT_SHORTCUTS.insertSoap)}"
              value="${esc(sc.insertSoap)}">
            <span class="hint">Inserts all checked items in the SOAP reference panel (entry form)</span>
          </div>
          <div class="field-group">
            <label class="field-label" for="sc-insert-soap-all">SOAP Templates Page — Insert All</label>
            <input class="field-input" type="text" id="sc-insert-soap-all"
              placeholder="${esc(DEFAULT_SHORTCUTS.insertSoapAll)}"
              value="${esc(sc.insertSoapAll)}">
            <span class="hint">Inserts all checked items on the SOAP Templates page</span>
          </div>
        </div>
        <div class="form-row-2">
          <div class="field-group">
            <label class="field-label" for="sc-insert-icd">ICD Browser — Insert Selected</label>
            <input class="field-input" type="text" id="sc-insert-icd"
              placeholder="${esc(DEFAULT_SHORTCUTS.insertIcd)}"
              value="${esc(sc.insertIcd)}">
            <span class="hint">Inserts selected ICD codes from the recent-50 panel</span>
          </div>
          <div class="field-group">
            <label class="field-label" for="sc-insert-all">Insert All (global)</label>
            <input class="field-input" type="text" id="sc-insert-all"
              placeholder="${esc(DEFAULT_SHORTCUTS.insertAll)}"
              value="${esc(sc.insertAll)}">
            <span class="hint">Inserts all selected items on the currently active page</span>
          </div>
        </div>
        <div class="form-row-2">
          <div class="field-group">
            <label class="field-label" for="sc-save-quad">Quad View — Save New Entry</label>
            <input class="field-input" type="text" id="sc-save-quad"
              placeholder="${esc(DEFAULT_SHORTCUTS.saveNewEntryFromQuad)}"
              value="${esc(sc.saveNewEntryFromQuad || DEFAULT_SHORTCUTS.saveNewEntryFromQuad)}">
            <span class="hint">Saves entry directly from quad view and clears panels (default: Shift+R)</span>
          </div>
        </div>
        <div class="row-gap">
          <button type="submit" class="btn btn-primary">💾 Save Shortcuts</button>
          <button type="button" class="btn btn-outline" id="btn-reset-shortcuts">↩ Reset to Defaults</button>
        </div>
      </form>
    </div>

    <!-- GitHub -->
    <div class="card settings-card" id="card-github">
      <div class="card-title">🐙 GitHub Auto-Commit</div>
      <p class="hint" style="margin-bottom:.75rem">
        After every save, the day's sessions are committed to a JSON file in your GitHub repository.
        Requires a <a href="https://github.com/settings/tokens" target="_blank" rel="noopener">Personal Access Token</a>
        with <code>repo</code> (contents write) permission.
        For enhanced security, enable
        <a href="https://github.com/settings/security" target="_blank" rel="noopener">Two-Factor Authentication (2FA)</a>
        on your GitHub account.
      </p>
      <form id="form-github" autocomplete="off">
        <div class="form-row-2">
          <div class="field-group">
            <label class="field-label" for="gh-owner">Repository Owner <span class="req">*</span></label>
            <input class="field-input" type="text" id="gh-owner" placeholder="your-username"
              value="${esc(gh.owner || '')}">
          </div>
          <div class="field-group">
            <label class="field-label" for="gh-repo">Repository Name <span class="req">*</span></label>
            <input class="field-input" type="text" id="gh-repo" placeholder="Clinical-Medicine"
              value="${esc(gh.repo || '')}">
          </div>
        </div>
        <div class="form-row-2">
          <div class="field-group">
            <label class="field-label" for="gh-branch">Branch</label>
            <input class="field-input" type="text" id="gh-branch" placeholder="main"
              value="${esc(gh.branch || 'main')}">
          </div>
          <div class="field-group">
            <label class="field-label" for="gh-folder">Folder Path</label>
            <input class="field-input" type="text" id="gh-folder" placeholder="Daily/sessions"
              value="${esc(gh.folder || 'Daily/sessions')}">
          </div>
        </div>
        <div class="field-group">
          <label class="field-label" for="gh-token">Personal Access Token <span class="req">*</span></label>
          <input class="field-input" type="password" id="gh-token" placeholder="ghp_…"
            value="${esc(gh.token || '')}">
          <span class="hint">Stored only in your browser's localStorage — never sent to any third party.</span>
        </div>
        <div class="field-group">
          <label class="settings-toggle">
            <input type="checkbox" id="gh-enabled" ${_githubAutoEnableChecked(gh) ? 'checked' : ''}>
            <span>Enable GitHub auto-commit on save</span>
          </label>
        </div>
        <div class="row-gap">
          <button type="submit" class="btn btn-primary">💾 Save GitHub Settings</button>
          <button type="button" class="btn btn-outline" id="btn-test-github">🔗 Test Connection</button>
          <span id="github-status" class="settings-status"></span>
        </div>
      </form>
    </div>

    <!-- Firebase -->
    <div class="card settings-card" id="card-firebase">
      <div class="card-title">🔥 Firebase Firestore Sync</div>
      <p class="hint" style="margin-bottom:.75rem">
        After every save, the session is written to Firestore collection <code>opdSessions</code>.
        Paste your Firebase project config JSON from the
        <a href="https://console.firebase.google.com/" target="_blank" rel="noopener">Firebase Console</a>
        (Project settings → Your apps → SDK setup → Config).
      </p>
      <form id="form-firebase" autocomplete="off">
        <div class="field-group">
          <label class="field-label" for="fb-config">Firebase Config JSON <span class="req">*</span></label>
          <textarea class="field-input field-textarea" id="fb-config" rows="8"
            placeholder='{"apiKey":"...","authDomain":"...","projectId":"...","storageBucket":"...","messagingSenderId":"...","appId":"..."}'
            style="font-family:monospace;font-size:.82rem">${esc(fb.apiKey ? JSON.stringify(fb, null, 2) : JSON.stringify({
              apiKey:            fb.apiKey            || 'AIzaSyB5mafJ-B7bgAqmjCzW2ePmfwMKfR9kZJA',
              authDomain:        fb.authDomain        || 'phcep-94e92.firebaseapp.com',
              projectId:         fb.projectId         || 'phcep-94e92',
              storageBucket:     fb.storageBucket     || 'phcep-94e92.firebasestorage.app',
              messagingSenderId: fb.messagingSenderId || '1003364373709',
              appId:             fb.appId             || '1:1003364373709:web:aa6fc1d0fcca7bb7690584',
              measurementId:     fb.measurementId     || 'G-XBEWNC7K1W',
            }, null, 2))}</textarea>
          <span class="hint">⚠️ Stored only in your browser's localStorage. Do not share screenshots of this page as they may expose your API keys.</span>
        </div>
        <div class="field-group">
          <label class="settings-toggle">
            <input type="checkbox" id="fb-enabled" ${fb.enabled ? 'checked' : ''}>
            <span>Enable Firestore sync on save</span>
          </label>
        </div>
        <div class="row-gap">
          <button type="submit" class="btn btn-primary">💾 Save Firebase Settings</button>
          <button type="button" class="btn btn-outline" id="btn-test-firebase">🔗 Test Connection</button>
          <span id="firebase-status" class="settings-status"></span>
        </div>
      </form>
    </div>
  `;

  /* GitHub form */
  const ghForm = container.querySelector('#form-github');
  ghForm.addEventListener('submit', e => {
    e.preventDefault();
    const token  = container.querySelector('#gh-token').value.trim();
    const owner  = container.querySelector('#gh-owner').value.trim();
    const repo   = container.querySelector('#gh-repo').value.trim();
    const branch = container.querySelector('#gh-branch').value.trim() || 'main';
    const folder = container.querySelector('#gh-folder').value.trim() || 'Daily/sessions';
    const enabled = container.querySelector('#gh-enabled').checked;
    if (!token || !owner || !repo) { showToast('error', 'Token, owner and repo are required.'); return; }
    saveGithubSettings({ token, owner, repo, branch, folder, enabled });
    showToast('success', 'GitHub settings saved.');
  });

  container.querySelector('#btn-test-github').addEventListener('click', async () => {
    /* Save current field values first */
    const token  = container.querySelector('#gh-token').value.trim();
    const owner  = container.querySelector('#gh-owner').value.trim();
    const repo   = container.querySelector('#gh-repo').value.trim();
    const branch = container.querySelector('#gh-branch').value.trim() || 'main';
    const folder = container.querySelector('#gh-folder').value.trim() || 'Daily/sessions';
    saveGithubSettings({ token, owner, repo, branch, folder, enabled: container.querySelector('#gh-enabled').checked });

    const statusEl = container.querySelector('#github-status');
    statusEl.textContent = '⏳ Testing…';
    statusEl.className   = 'settings-status';
    const { ok, message } = await testGithubConnection();
    statusEl.textContent = message;
    statusEl.className   = `settings-status ${ok ? 'status-ok' : 'status-err'}`;
  });

  /* Firebase form */
  const fbForm = container.querySelector('#form-firebase');
  fbForm.addEventListener('submit', e => {
    e.preventDefault();
    const raw = container.querySelector('#fb-config').value.trim();
    if (!raw) { showToast('error', 'Firebase config JSON is required.'); return; }
    let cfg;
    try { cfg = JSON.parse(raw); } catch { showToast('error', 'Invalid JSON.'); return; }
    if (!cfg.apiKey || !cfg.projectId) { showToast('error', 'Config must include apiKey and projectId.'); return; }
    cfg.enabled = container.querySelector('#fb-enabled').checked;
    saveFirebaseSettings(cfg);
    showToast('success', 'Firebase settings saved.');
  });

  container.querySelector('#btn-test-firebase').addEventListener('click', async () => {
    const raw = container.querySelector('#fb-config').value.trim();
    if (raw) {
      try {
        const cfg = JSON.parse(raw);
        cfg.enabled = container.querySelector('#fb-enabled').checked;
        saveFirebaseSettings(cfg);
      } catch { showToast('error', 'Invalid JSON.'); return; }
    }
    const statusEl = container.querySelector('#firebase-status');
    statusEl.textContent = '⏳ Testing…';
    statusEl.className   = 'settings-status';
    const { ok, message } = await testFirebaseConnection();
    statusEl.textContent = message;
    statusEl.className   = `settings-status ${ok ? 'status-ok' : 'status-err'}`;
  });

  /* Shortcut keys form */
  const scForm = container.querySelector('#form-shortcuts');
  scForm.addEventListener('submit', e => {
    e.preventDefault();
    const keys = {
      insertSoap:           container.querySelector('#sc-insert-soap').value.trim()     || DEFAULT_SHORTCUTS.insertSoap,
      insertSoapAll:        container.querySelector('#sc-insert-soap-all').value.trim() || DEFAULT_SHORTCUTS.insertSoapAll,
      insertIcd:            container.querySelector('#sc-insert-icd').value.trim()      || DEFAULT_SHORTCUTS.insertIcd,
      insertAll:            container.querySelector('#sc-insert-all').value.trim()      || DEFAULT_SHORTCUTS.insertAll,
      saveNewEntryFromQuad: container.querySelector('#sc-save-quad').value.trim()       || DEFAULT_SHORTCUTS.saveNewEntryFromQuad,
    };
    saveShortcutKeys(keys);
    showToast('success', 'Shortcut keys saved.');
  });

  container.querySelector('#btn-reset-shortcuts').addEventListener('click', () => {
    container.querySelector('#sc-insert-soap').value     = DEFAULT_SHORTCUTS.insertSoap;
    container.querySelector('#sc-insert-soap-all').value = DEFAULT_SHORTCUTS.insertSoapAll;
    container.querySelector('#sc-insert-icd').value      = DEFAULT_SHORTCUTS.insertIcd;
    container.querySelector('#sc-insert-all').value      = DEFAULT_SHORTCUTS.insertAll;
    container.querySelector('#sc-save-quad').value       = DEFAULT_SHORTCUTS.saveNewEntryFromQuad;
    saveShortcutKeys({ ...DEFAULT_SHORTCUTS });
    showToast('success', 'Shortcuts reset to defaults.');
  });
}

/**
 * Returns true if GitHub auto-commit should be checked by default.
 * Enabled if explicitly saved as enabled, or if a PAT exists but the
 * `enabled` flag hasn't been set yet (first-time users with a stored token).
 */
function _githubAutoEnableChecked(gh) {
  if (gh.enabled) return true;
  /* Auto-enable for existing PAT users who haven't explicitly toggled the flag */
  return !!(gh.token && !('enabled' in gh));
}
