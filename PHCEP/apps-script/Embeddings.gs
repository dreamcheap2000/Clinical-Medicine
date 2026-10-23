/**
 * Optional curator-only QA embeddings. Never called by webhook or edit triggers.
 * Patient conversations must not be copied into this workflow.
 */
function buildCuratedQAEmbeddings() {
  phcepAuthorizeClinician_();
  if (phcepProperty_('AI_CURATED_QA_OPT_IN') !== 'true') return { status: 'DISABLED' };
  var key = phcepProperty_('GEMINI_API_KEY');
  if (!key) return { status: 'MISSING_KEY' };
  return phcepWithLock_(function () {
    var sheet = phcepSpreadsheet_().getSheetByName('QA知識庫');
    if (!sheet || sheet.getLastRow() < 2) return { status: 'EMPTY', count: 0 };
    var layout = phcepQALayout_(sheet);
    var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, layout.width).getValues();
    var count = 0;
    // Approval is a deliberate exact marker in 連結備註.
    rows.forEach(function (row, index) {
      if (row[layout.notes - 1] !== 'APPROVED_DEIDENTIFIED_QA' || !String(row[layout.question - 1] || '').trim()) return;
      var vector = phcepCuratedEmbedding_(String(row[layout.question - 1]).slice(0, 8000), key);
      if (!vector) return;
      var json = JSON.stringify(vector);
      if (json.length > 49000) throw new Error('EMBEDDING_TOO_LARGE');
      // Keep question vectors separate from replies, private in the existing sheet.
      sheet.getRange(index + 2, layout.questionEmbedding).setValue(json);
      count++;
    });
    SpreadsheetApp.flush();
    return { status: 'COMPLETE', count: count };
  });
}

function phcepCuratedEmbedding_(text, key) {
  var response;
  try {
    response = UrlFetchApp.fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent',
      {
        method: 'post',
        contentType: 'application/json',
        headers: { 'x-goog-api-key': key },
        payload: JSON.stringify({
          model: 'models/gemini-embedding-001',
          content: { parts: [{ text: text }] },
          taskType: 'RETRIEVAL_DOCUMENT',
          outputDimensionality: 768
        }),
        muteHttpExceptions: true
      }
    );
    if (response.getResponseCode() !== 200) return null;
    var data = JSON.parse(response.getContentText());
    var values = data.embedding && data.embedding.values;
    if (!Array.isArray(values) || !values.length ||
        !values.every(function (value) { return typeof value === 'number' && isFinite(value); }))
      return null;
    return values;
  } catch (_) {
    return null; // Do not log API errors, request content or credentials.
  }
}
