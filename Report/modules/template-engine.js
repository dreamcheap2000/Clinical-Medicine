/**
 * template-engine.js
 * Generates impression suggestions from previous reports using
 * frequency-based keyword matching (TF-IDF-lite).
 */

/**
 * Given the current partial fieldValues and all saved reports for
 * the same examType, return an ordered array of suggestion strings
 * (impression texts) ranked by relevance.
 *
 * @param {Object} fieldValues    - Current form values
 * @param {Array}  savedReports   - All stored reports (same examType)
 * @param {number} topN           - Max suggestions to return
 * @returns {string[]}
 */
export function getSuggestions(fieldValues, savedReports, topN = 5) {
  if (!savedReports || savedReports.length === 0) return [];

  // Build a keyword set from current values
  const keywords = extractKeywords(fieldValues);
  if (keywords.size === 0) return [];

  // Score each saved report's impression
  const scored = savedReports
    .filter(r => r.fields && r.fields.impression_text)
    .map(r => ({
      text: r.fields.impression_text,
      score: scoreReport(r, keywords)
    }))
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score);

  // De-duplicate identical impressions (keep highest score)
  const seen = new Set();
  const unique = [];
  for (const s of scored) {
    const key = normalise(s.text);
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(s.text);
    }
    if (unique.length >= topN) break;
  }
  return unique;
}

/**
 * Generate a full auto-report text by filling in a template string
 * using the current field values from the most-matched historical report.
 *
 * Returns null if no good match is found.
 *
 * @param {Object} fieldValues
 * @param {Array}  savedReports
 * @param {Object} template
 * @returns {string|null}
 */
export function autoGenerateReport(fieldValues, savedReports, template) {
  const suggestions = getSuggestions(fieldValues, savedReports, 1);
  if (suggestions.length === 0) return null;
  return suggestions[0];
}

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */

function extractKeywords(fieldValues) {
  const keywords = new Set();
  for (const val of Object.values(fieldValues)) {
    if (!val) continue;
    const arr = Array.isArray(val) ? val : [val];
    for (const v of arr) {
      if (typeof v !== 'string') continue;
      tokenise(v).forEach(t => keywords.add(t));
    }
  }
  return keywords;
}

function scoreReport(report, keywords) {
  const allText = getAllText(report);
  const tokens = tokenise(allText);
  let hits = 0;
  for (const t of tokens) {
    if (keywords.has(t)) hits++;
  }
  // Boost by field-level exact matches
  const fieldText = Object.values(report.fields || {})
    .flat()
    .filter(Boolean)
    .join(' ');
  const fieldTokens = tokenise(fieldText);
  for (const t of fieldTokens) {
    if (keywords.has(t)) hits += 2; // field match weighted higher
  }
  return hits;
}

function getAllText(report) {
  const parts = [];
  const fields = report.fields || {};
  for (const v of Object.values(fields)) {
    if (Array.isArray(v)) parts.push(...v);
    else if (v) parts.push(String(v));
  }
  if (report.tags) parts.push(...report.tags);
  return parts.join(' ');
}

function tokenise(str) {
  return String(str)
    .toLowerCase()
    .replace(/[^a-z0-9%\-]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 2 && !STOP_WORDS.has(t));
}

function normalise(str) {
  return String(str).trim().toLowerCase().replace(/\s+/g, ' ');
}

const STOP_WORDS = new Set([
  'the','a','an','and','or','of','to','in','is','are','was','were',
  'for','on','at','by','with','this','that','it','its','be','been',
  'has','have','had','not','no','do','did','from','as','but','so',
  'if','into','than','then','also','about','above','after','before',
  'some','any','all','both','each','more','most','other','such','up'
]);
