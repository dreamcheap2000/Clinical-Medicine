/**
 * modules/settings-view.js
 * Settings page — configure GitHub auto-commit and Firebase Firestore sync.
 */

import { esc, showToast } from '../app.js';
import { getGithubSettings, saveGithubSettings, testGithubConnection } from './github-sync.js';
import { getFirebaseSettings, saveFirebaseSettings, testFirebaseConnection, exportSessionAsFhirBundle } from './firebase-sync.js';

export function renderSettings() {
  const container = document.getElementById('main-content');
  const gh  = getGithubSettings();
  const fb  = getFirebaseSettings();

  container.innerHTML = `
    <h2 class="page-title">⚙️ Sync Settings</h2>
    <p class="subtitle">Configure cloud backup — GitHub auto-commit and Google Firebase Firestore</p>

    <!-- GitHub -->
    <div class="card settings-card" id="card-github">
      <div class="card-title">🐙 GitHub Auto-Commit</div>
      <p class="hint" style="margin-bottom:.75rem">
        After every save, the day's sessions are committed to a JSON file in your GitHub repository.
        Requires a <a href="https://github.com/settings/tokens" target="_blank" rel="noopener">Personal Access Token</a>
        with <code>repo</code> (contents write) permission.
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
            <input type="checkbox" id="gh-enabled" ${gh.enabled ? 'checked' : ''}>
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
}
