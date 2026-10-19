/**
 * Local lexical QA matcher and importance validation.
 * Pure helpers only: no network, no logging, no Drive/LINE access. Safe for the
 * webhook path. Suggestions never send anything; a clinician must still confirm.
 */
var PHCEP_MATCH_DEFAULTS_ = {
  limit: 5,
  threshold: 0.45,
  maxQaRows: 2000,
  maxTextLength: 500,
  maxEditDistanceLength: 64
};

var PHCEP_MATCH_LEADING_FILLERS_ = ['想請問', '請問', '想問', '您好', '你好', '哈囉'];
var PHCEP_MATCH_TRAILING_FILLERS_ = ['謝謝', '感謝', '謝謝您', '謝謝你'];

/** Importance is optional metadata (blank = none); only integers 1-5 are valid. */
function phcepNormalizeImportance_(value) {
  if (value === null || value === undefined) return { ok: true, value: null };
  if (typeof value === 'number') {
    if (Number.isInteger(value) && value >= 1 && value <= 5) return { ok: true, value: value };
    return { ok: false, value: null, error: '重要性僅接受 1-5 的整數，或留白（未設定）。' };
  }
  if (typeof value === 'boolean' || value instanceof Date) {
    return { ok: false, value: null, error: '重要性僅接受 1-5 的整數，或留白（未設定）。' };
  }
  var text = String(value).normalize('NFKC').trim();
  if (!text) return { ok: true, value: null };
  if (/^[1-5]$/.test(text)) return { ok: true, value: Number(text) };
  return { ok: false, value: null, error: '重要性僅接受 1-5 的整數，或留白（未設定）。' };
}

function phcepNormalizeMatchText_(value) {
  var text = String(value == null ? '' : value).normalize('NFKC').toLowerCase();
  if (text.length > PHCEP_MATCH_DEFAULTS_.maxTextLength) text = text.slice(0, PHCEP_MATCH_DEFAULTS_.maxTextLength);
  text = text.replace(/[\s\p{P}\p{S}]+/gu, '');
  var changed = true;
  while (changed) {
    changed = false;
    for (var i = 0; i < PHCEP_MATCH_LEADING_FILLERS_.length; i++) {
      var lead = PHCEP_MATCH_LEADING_FILLERS_[i];
      if (text.length > lead.length && text.indexOf(lead) === 0) { text = text.slice(lead.length); changed = true; }
    }
    for (var j = 0; j < PHCEP_MATCH_TRAILING_FILLERS_.length; j++) {
      var tail = PHCEP_MATCH_TRAILING_FILLERS_[j];
      if (text.length > tail.length && text.slice(-tail.length) === tail) { text = text.slice(0, -tail.length); changed = true; }
    }
  }
  return text;
}

function phcepBigrams_(chars) {
  if (chars.length < 2) return chars.length ? [chars[0]] : [];
  var grams = [];
  for (var i = 0; i < chars.length - 1; i++) grams.push(chars[i] + chars[i + 1]);
  return grams;
}

function phcepDice_(a, b) {
  var left = phcepBigrams_(a);
  var right = phcepBigrams_(b);
  if (!left.length || !right.length) return 0;
  var counts = {};
  left.forEach(function(gram) { counts[gram] = (counts[gram] || 0) + 1; });
  var overlap = 0;
  right.forEach(function(gram) {
    if (counts[gram]) { overlap++; counts[gram]--; }
  });
  return (2 * overlap) / (left.length + right.length);
}

function phcepEditDistance_(a, b) {
  var previous = [];
  for (var j = 0; j <= b.length; j++) previous.push(j);
  for (var i = 1; i <= a.length; i++) {
    var current = [i];
    for (var k = 1; k <= b.length; k++) {
      current.push(Math.min(previous[k] + 1, current[k - 1] + 1,
        previous[k - 1] + (a[i - 1] === b[k - 1] ? 0 : 1)));
    }
    previous = current;
  }
  return previous[b.length];
}

/** Relevance in [0, 1]; inputs must already be normalized. */
function phcepRelevance_(query, candidate, floor) {
  if (!query || !candidate) return 0;
  if (query === candidate) return 1;
  var q = Array.from(query);
  var c = Array.from(candidate);
  var shorter = q.length <= c.length ? query : candidate;
  var longer = q.length <= c.length ? candidate : query;
  var shortLength = Math.min(q.length, c.length);
  var longLength = Math.max(q.length, c.length);
  var containment = 0;
  // Containment safeguards: at least two characters and a meaningful share of the longer text.
  if (shortLength >= 2 && longer.indexOf(shorter) !== -1 && shortLength / longLength >= 0.25) {
    containment = 0.55 + 0.4 * (shortLength / longLength);
  }
  var lexical = phcepDice_(q, c);
  // Skip the O(n*m) edit distance when even a perfect edit score cannot reach the floor.
  var reachable = typeof floor !== 'number' || 0.75 * lexical + 0.25 >= floor;
  if (!reachable) {
    lexical = 0.75 * lexical;
  } else if (longLength <= PHCEP_MATCH_DEFAULTS_.maxEditDistanceLength) {
    lexical = 0.75 * lexical + 0.25 * (1 - phcepEditDistance_(q, c) / longLength);
  }
  return Math.min(0.99, Math.max(containment, lexical));
}

/**
 * Rank curated QA items. Relevance must pass the threshold first; importance
 * (max +0.05) and usage frequency (max +0.03) only reorder relevant candidates.
 */
function phcepRankSuggestions_(message, items, options) {
  options = options || {};
  var limit = Math.max(1, Math.min(10, Number(options.limit) || PHCEP_MATCH_DEFAULTS_.limit));
  var threshold = typeof options.threshold === 'number' ? options.threshold : PHCEP_MATCH_DEFAULTS_.threshold;
  var query = phcepNormalizeMatchText_(message);
  if (!query) return [];
  var best = {};
  (items || []).slice(0, PHCEP_MATCH_DEFAULTS_.maxQaRows).forEach(function(item, index) {
    if (!item || !item.reply) return;
    var relevance = 0;
    (item.questions || []).forEach(function(question) {
      relevance = Math.max(relevance, phcepRelevance_(query, phcepNormalizeMatchText_(question), threshold));
    });
    if (relevance < threshold) return;
    var importance = phcepNormalizeImportance_(item.importance).value;
    var frequency = Math.max(0, Number(item.frequency) || 0);
    var bonus = (importance ? 0.01 * importance : 0) + Math.min(0.03, 0.01 * Math.log10(1 + frequency));
    var candidate = { reply: item.reply, relevance: relevance, score: relevance + bonus,
      row: item.row || index + 2, order: index };
    var existing = best[item.reply];
    if (!existing || candidate.score > existing.score) best[item.reply] = candidate;
  });
  return Object.keys(best).map(function(reply) { return best[reply]; }).sort(function(a, b) {
    return b.score - a.score || b.relevance - a.relevance || a.order - b.order;
  }).slice(0, limit);
}

/** Read curated QA rows (C/D/E questions, G reply, B importance, O global usage). */
function phcepReadQA_(ss) {
  var sheet = ss && ss.getSheetByName('QA知識庫');
  if (!sheet || sheet.getLastRow() < 2) return [];
  var count = Math.min(sheet.getLastRow() - 1, PHCEP_MATCH_DEFAULTS_.maxQaRows);
  return sheet.getRange(2, 1, count, 15).getValues().map(function(row, i) {
    return { row: i + 2,
      questions: [row[2], row[3], row[4]].map(function(value) { return String(value || '').trim(); }),
      reply: String(row[6] || '').trim(),
      importance: row[1],
      frequency: Number(row[14]) || 0 };
  }).filter(function(item) { return item.reply && item.questions.some(Boolean); });
}

function phcepSuggestionLimit_() {
  var configured = typeof phcepProperty_ === 'function' ? Number(phcepProperty_('PHCEP_SUGGESTION_LIMIT')) : NaN;
  return Number.isInteger(configured) && configured >= 1 && configured <= 10 ? configured : PHCEP_MATCH_DEFAULTS_.limit;
}

/** Writes the H dropdown for one LINE對話 row. Never edits I and never sends. */
function phcepApplySuggestions_(ss, sheet, row, message) {
  var suggestions = phcepRankSuggestions_(message, phcepReadQA_(ss), { limit: phcepSuggestionLimit_() })
    .map(function(item) { return item.reply; });
  var cell = sheet.getRange(row, 8);
  cell.clearDataValidations();
  if (suggestions.length) {
    cell.setDataValidation(SpreadsheetApp.newDataValidation()
      .requireValueInList(suggestions, true).setAllowInvalid(false).build());
  }
  return suggestions;
}
