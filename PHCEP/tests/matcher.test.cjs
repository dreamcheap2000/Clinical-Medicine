const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function matcher() {
  // No UrlFetchApp/DriveApp in the context: any network use would throw.
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../apps-script/Matcher.gs'), 'utf8'), context);
  return context;
}

const item = (question, reply, extra = {}) => ({ questions: [question, '', ''], reply, ...extra });

test('importance is optional and accepts only integers 1-5', () => {
  const m = matcher();
  for (const blank of ['', '   ', null, undefined]) {
    const result = m.phcepNormalizeImportance_(blank);
    assert.equal(result.ok, true);
    assert.equal(result.value, null);
  }
  for (const [input, value] of [[1, 1], [5, 5], ['3', 3], [' 4 ', 4], ['２', 2]]) {
    assert.deepEqual({ ...m.phcepNormalizeImportance_(input) }, { ok: true, value });
  }
  for (const invalid of [0, 6, -1, 2.5, '0', '6', '-2', '2.5', '2.0', 'high', '高', true, new Date()]) {
    const result = m.phcepNormalizeImportance_(invalid);
    assert.equal(result.ok, false, String(invalid));
    assert.equal(result.value, null);
    assert.match(result.error, /1-5/);
  }
});

test('normalization handles NFKC, case, punctuation, spaces and polite zh fillers', () => {
  const m = matcher();
  assert.equal(m.phcepNormalizeMatchText_('  請問　如何 預約？ '), '如何預約');
  assert.equal(m.phcepNormalizeMatchText_('ＡＢＣ，Def!'), 'abcdef');
  assert.equal(m.phcepNormalizeMatchText_('請問'), '請問');
  assert.equal(m.phcepNormalizeMatchText_('如何預約謝謝'), '如何預約');
});

test('exact, containment and bigram matches rank above threshold; low confidence returns none', () => {
  const m = matcher();
  const qa = [item('如何預約門診', '預約說明'), item('藥物副作用', '副作用說明'), item('停車資訊', '停車說明')];
  const exact = m.phcepRankSuggestions_('請問如何預約門診？', qa);
  assert.equal(exact[0].reply, '預約說明');
  assert.equal(exact[0].relevance, 1);
  const contained = m.phcepRankSuggestions_('預約門診', qa);
  assert.equal(contained[0].reply, '預約說明');
  assert.ok(contained[0].relevance < 1 && contained[0].relevance >= 0.45);
  const bigram = m.phcepRankSuggestions_('藥物的副作用', qa);
  assert.equal(bigram[0].reply, '副作用說明');
  assert.equal(m.phcepRankSuggestions_('今天天氣好嗎', qa).length, 0);
  assert.equal(m.phcepRankSuggestions_('', qa).length, 0);
  assert.equal(m.phcepRankSuggestions_('約', qa).length, 0);
});

test('importance and frequency only break near ties and never rescue low relevance', () => {
  const m = matcher();
  const qa = [
    item('如何預約門診時間', 'A'),
    item('如何預約門診時段', 'B', { importance: 5, frequency: 1000 }),
    item('完全不同的主題', 'C', { importance: 5, frequency: 1e9 })
  ];
  const ranked = m.phcepRankSuggestions_('如何預約門診時', qa);
  assert.deepEqual(Array.from(ranked, entry => entry.reply), ['B', 'A']);
  assert.ok(ranked[0].score - ranked[0].relevance <= 0.08 + 1e-9);
  const exactWins = m.phcepRankSuggestions_('如何預約門診時間', qa);
  assert.equal(exactWins[0].reply, 'A');
  const invalidImportance = m.phcepRankSuggestions_('如何預約門診時間', [item('如何預約門診時間', 'X', { importance: 99 })]);
  assert.equal(invalidImportance[0].score, invalidImportance[0].relevance);
});

test('top-N limit, duplicate replies collapse, and inputs stay bounded', () => {
  const m = matcher();
  const qa = Array.from({ length: 20 }, (_, i) => item('預約門診' + i, 'reply-' + (i % 8)));
  const ranked = m.phcepRankSuggestions_('預約門診', qa);
  assert.equal(ranked.length, 5);
  assert.equal(new Set(ranked.map(entry => entry.reply)).size, 5);
  assert.equal(m.phcepRankSuggestions_('預約門診', qa, { limit: 3 }).length, 3);
  const long = '預約'.repeat(5000);
  assert.ok(m.phcepNormalizeMatchText_(long).length <= 500);
  assert.ok(Array.isArray(m.phcepRankSuggestions_(long, qa)));
});
