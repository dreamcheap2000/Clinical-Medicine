/**
 * modules/github-sync.js
 * Commits OPD session data to a GitHub repository via the Contents API.
 *
 * Settings are stored in localStorage under GITHUB_SETTINGS_KEY and configured
 * through the Settings page.  No server required — uses a Personal Access Token
 * (classic PAT with repo:contents write permission).
 *
 * File written: <folder>/<YYYY-MM-DD>.json
 * Each daily file is an array of all sessions recorded on that date.
 */

const GITHUB_SETTINGS_KEY = 'githubSync_v1';

export function getGithubSettings() {
  try { return JSON.parse(localStorage.getItem(GITHUB_SETTINGS_KEY) || 'null') || {}; }
  catch { return {}; }
}

export function saveGithubSettings(settings) {
  localStorage.setItem(GITHUB_SETTINGS_KEY, JSON.stringify(settings));
}

/**
 * Commit a session to GitHub.
 * Groups all sessions for the same date into one file: <folder>/<date>.json
 * Returns true on success, throws on failure.
 */
export async function commitSessionToGithub(session, allSessions) {
  const cfg = getGithubSettings();
  if (!cfg.token || !cfg.owner || !cfg.repo) return false; /* not configured */

  const branch = cfg.branch || 'main';
  const folder = (cfg.folder || 'Daily/sessions').replace(/\/$/, '');
  const date   = session.date || new Date().toISOString().slice(0, 10);
  const path   = `${folder}/${date}.json`;

  /* Build the file content: all sessions for this date */
  const daySessions = allSessions.filter(s => s.date === date);
  const content     = JSON.stringify({ date, sessions: daySessions, updatedAt: new Date().toISOString() }, null, 2);
  /* Encode UTF-8 content to base64 using TextEncoder (avoids deprecated unescape) */
  const encoded     = btoa(String.fromCharCode(...new TextEncoder().encode(content)));

  const apiBase = `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/${path}`;
  const headers  = {
    'Authorization': `Bearer ${cfg.token}`,
    'Content-Type':  'application/json',
    'Accept':        'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  /* Check if file already exists (to get the SHA needed for updates) */
  let sha;
  try {
    const res = await fetch(`${apiBase}?ref=${encodeURIComponent(branch)}`, { headers });
    if (res.ok) {
      const data = await res.json();
      sha = data.sha;
    }
  } catch { /* ignore — file may not exist yet */ }

  const body = {
    message: `OPD log update: ${date}`,
    content: encoded,
    branch,
    ...(sha ? { sha } : {}),
  };

  const putRes = await fetch(apiBase, {
    method: 'PUT',
    headers,
    body: JSON.stringify(body),
  });

  if (!putRes.ok) {
    const err = await putRes.json().catch(() => ({}));
    throw new Error(err.message || `GitHub API error ${putRes.status}`);
  }
  return true;
}

/** Quick connectivity/auth test — returns { ok, message } */
export async function testGithubConnection() {
  const cfg = getGithubSettings();
  if (!cfg.token || !cfg.owner || !cfg.repo) {
    return { ok: false, message: 'Settings incomplete. Fill in token, owner and repo.' };
  }
  try {
    const res = await fetch(`https://api.github.com/repos/${cfg.owner}/${cfg.repo}`, {
      headers: {
        'Authorization': `Bearer ${cfg.token}`,
        'Accept':        'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (res.ok) {
      const d = await res.json();
      return { ok: true, message: `Connected ✓ — ${d.full_name} (${d.private ? 'private' : 'public'})` };
    }
    const err = await res.json().catch(() => ({}));
    return { ok: false, message: err.message || `HTTP ${res.status}` };
  } catch(e) {
    return { ok: false, message: e.message };
  }
}
