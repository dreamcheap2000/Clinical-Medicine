const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { buildSyntheticP8901B, taiwanIdValid, ROWS } = require('./fixtures/p8901b-synthetic.cjs');

const bound = name => fs.readFileSync(path.join(__dirname, '../nhi-sheet-script', name), 'utf8');
const phcep = name => fs.readFileSync(path.join(__dirname, '../apps-script', name), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const TAB = 'NHI高血脂個案';

function parserContext() {
  const context = vm.createContext({ TextDecoder, Blob, Response, DecompressionStream });
  vm.runInContext(bound('NhiImportDialog.html').match(/<script>([\s\S]*?)<\/script>/)[1], context);
  return context;
}

function arrayBuffer(buffer) {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

function fakeSheet(name) {
  const state = { name, cells: [], formats: {}, notes: {}, validations: {}, checkboxes: [],
    maxRows: 1000, maxColumns: 26, activated: null, activeRow: 1 };
  const get = (row, column) => (state.cells[row - 1] || [])[column - 1];
  const set = (row, column, value) => {
    state.cells[row - 1] = state.cells[row - 1] || [];
    state.cells[row - 1][column - 1] = value;
  };
  const sheet = {
    state,
    getName: () => name,
    getMaxRows: () => state.maxRows,
    getMaxColumns: () => state.maxColumns,
    insertColumnsAfter(after, count) { state.maxColumns += count; },
    setFrozenRows() {},
    setFrozenColumns() {},
    getActiveRange: () => ({ getRow: () => state.activeRow }),
    getLastRow() {
      let last = 0;
      state.cells.forEach((row, index) => {
        if (row && row.some(value => value !== '' && value !== undefined && value !== null)) last = index + 1;
      });
      return last;
    },
    getRange(row, column, rows = 1, columns = 1) {
      const each = fn => {
        for (let r = 0; r < rows; r++) for (let c = 0; c < columns; c++) fn(row + r, column + c, r, c);
      };
      const range = {
        getValues() {
          return Array.from({ length: rows }, (_, r) => Array.from({ length: columns }, (_, c) => {
            const value = get(row + r, column + c);
            return value === undefined ? '' : value;
          }));
        },
        setValues(values) {
          assert.equal(values.length, rows);
          values.forEach(line => assert.equal(line.length, columns));
          each((r, c, i, j) => set(r, c, values[i][j]));
          return range;
        },
        setFontWeight: () => range,
        setNote(note) { state.notes[column] = note; return range; },
        setNumberFormat(format) { each((r, c) => { state.formats[r + ':' + c] = format; }); return range; },
        setNumberFormats(formats) {
          each((r, c, i, j) => { state.formats[r + ':' + c] = formats[i][j]; });
          return range;
        },
        setDataValidation(rule) { state.validations[column] = rule.values; return range; },
        insertCheckboxes() {
          state.checkboxes.push({ row, column, rows, columns });
          each((r, c) => assert.equal(typeof get(r, c), 'boolean'));
          return range;
        },
        activate() { state.activated = { row, column }; return range; }
      };
      return range;
    }
  };
  return sheet;
}

function server({ sheet, activeSheet } = {}) {
  const props = {};
  const state = { lock: false, sheets: new Map(), alerts: [], menu: null };
  if (sheet) state.sheets.set(sheet.getName(), sheet);
  const documentProperties = {
    getProperty: key => Object.hasOwn(props, key) ? props[key] : null,
    setProperty(key, value) { assert.ok(state.lock, 'properties must be written under the lock'); props[key] = value; }
  };
  const spreadsheet = {
    getSheetByName: name => state.sheets.get(name) || null,
    insertSheet(name) {
      assert.ok(state.lock, 'sheet must be created under the lock');
      const created = fakeSheet(name);
      state.sheets.set(name, created);
      return created;
    }
  };
  const context = vm.createContext({
    LockService: {
      getDocumentLock: () => ({
        tryLock() { assert.equal(state.lock, false); state.lock = true; return true; },
        releaseLock() { state.lock = false; }
      })
    },
    PropertiesService: { getDocumentProperties: () => documentProperties },
    Utilities: { formatDate: () => '2026/11/01 22:40' },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => spreadsheet,
      getActiveSheet: () => activeSheet || state.sheets.get(TAB),
      newDataValidation() {
        const rule = {};
        const builder = {
          requireValueInList(values) { rule.values = values; return builder; },
          setAllowInvalid() { return builder; },
          build: () => rule
        };
        return builder;
      },
      getUi: () => ({
        alert: message => state.alerts.push(message),
        createMenu(title) {
          const menu = { title, items: [] };
          const builder = {
            addItem(label, fn) { menu.items.push(fn); return builder; },
            addToUi() { state.menu = menu; }
          };
          return builder;
        }
      })
    }
  });
  vm.runInContext(bound('NhiSheet.gs'), context, { filename: 'NhiSheet.gs' });
  return { context, state, props };
}

async function syntheticRows() {
  return plain(await parserContext().nhiReadWorkbook(arrayBuffer(buildSyntheticP8901B())));
}

function records(sheet) {
  const [headers, ...rows] = sheet.getRange(1, 1, sheet.getLastRow(), sheet.state.cells[0].length).getValues();
  return rows.map(row => Object.fromEntries(headers.map((header, index) => [header, row[index]])));
}

test('importer lives in its own least-privilege bound project, not the LINE project', () => {
  const manifest = JSON.parse(bound('appsscript.json'));
  assert.deepEqual(manifest.oauthScopes, [
    'https://www.googleapis.com/auth/spreadsheets.currentonly',
    'https://www.googleapis.com/auth/script.container.ui'
  ]);
  assert.ok(!('webapp' in manifest) && !('executionApi' in manifest));
  assert.match(bound('NhiImportDialog.html'), /\.importNhiHisExport\(\{ rows: pending \}\)/);
  const { context, state } = server();
  context.onOpen();
  assert.deepEqual(state.menu.items, ['nhiSetupSheet', 'nhiOpenImport', 'nhiAddFollowUpFromSelection']);
  for (const fn of state.menu.items) assert.equal(typeof context[fn], 'function');
  assert.doesNotMatch(phcep('.claspignore') + phcep('UI.gs'), /Nhi/);
  assert.ok(!fs.existsSync(path.join(__dirname, '../apps-script/NhiImport.gs')));
});

test('synthetic workbook identifiers can never be real national IDs', () => {
  for (const row of ROWS) assert.equal(taiwanIdValid(row[3]), false, row[3]);
  assert.equal(taiwanIdValid('A100000001'), true, 'checksum helper sanity check');
});

test('browser parser reads only the nine needed columns from the HIS layout', async () => {
  const rows = await syntheticRows();
  assert.equal(rows.length, ROWS.length);
  assert.deepEqual(rows[0], { line: 4, values: {
    orderCode: 'P8901B', name: '測試甲', patientId: 'A100000002', birthday: '058/09/01',
    visitDate: '115/09/11', diagnosis: 'I63.89', gender: '女', physicianName: '測試醫師', chartNo: 'SYN0001'
  } });
  const uploaded = JSON.stringify(rows);
  for (const forbidden of ['測試地址', '0900000', '000000000000', '0200000000']) {
    assert.ok(!uploaded.includes(forbidden), `${forbidden} must stay in the browser`);
  }
});

test('browser parser rejects legacy BIFF .xls and non-xlsx files with guidance', async () => {
  const context = parserContext();
  const biff = new Uint8Array(512);
  biff.set([0xd0, 0xcf, 0x11, 0xe0]);
  await assert.rejects(context.nhiReadWorkbook(biff.buffer), /另存新檔/);
  await assert.rejects(context.nhiReadWorkbook(new TextEncoder().encode('name,id\n').buffer), /不是 xlsx/);
});

test('import creates 新收案 and 追蹤管理 rows, converting ROC dates and repeating the baseline', async () => {
  const { context, state, props } = server();
  const result = plain(context.importNhiHisExport({ rows: await syntheticRows() }));
  assert.deepEqual(result, {
    imported: 8, intake: 6, followUp: 2, followUpsWithoutIntake: 1,
    firstRowId: 1, lastRowId: 8, uncategorized: 1, sheetName: TAB,
    skipped: [
      { line: 10, reason: '此病人已有新收案列（rowId 1），追蹤請用 P8902B 或「新增追蹤管理列」' },
      { line: 11, reason: '出生日期不是有效的民國日期' },
      { line: 12, reason: '非 P8901B／P8902B 醫令' }
    ]
  });
  const sheet = state.sheets.get(TAB);
  const rows = records(sheet);
  assert.deepEqual(rows.map(row => [row.rowId, row.workflowStatus, row.careStage, row.patientId,
    row.birthday, row.visitDate, row.enrollmentDate, row.primaryDiagnosisCategory,
    row.primaryDiagnosisCode, row.hisDiagnosisCode]), [
    [1, 'DRAFT', '1', 'A100000002', '1969/09/01', '2026/09/11', '2026/09/11', '1', 'I63.89', 'I63.89'],
    [2, 'DRAFT', '1', 'A100000003', '1965/01/03', '2026/09/11', '2026/09/11', '', '', 'E11.8'],
    [3, 'DRAFT', '1', 'A100000004', '1960/05/12', '2026/09/14', '2026/09/14', '1', 'G45.9', 'G45.9'],
    [4, 'DRAFT', '1', 'A100000005', '1965/02/28', '2026/09/14', '2026/09/14', '2', 'I25.10', 'I25.10'],
    [5, 'DRAFT', '1', 'A100000006', '1962/01/27', '2026/10/15', '2026/10/15', '3', 'I21.4', 'I21.4'],
    [6, 'DRAFT', '1', 'A100000007', '1961/10/13', '2026/10/26', '2026/10/26', '4', 'I70.213', 'I70.213'],
    // 追蹤: keeps the enrollment date/diagnosis, records today's HIS code for reference.
    [7, 'DRAFT', '2', 'A100000002', '1969/09/01', '2026/11/20', '2026/09/11', '1', 'I63.89', 'E78.5'],
    // 追蹤 without a 新收案 row: enrollment date left for the clinician.
    [8, 'DRAFT', '2', 'A100000009', '1972/07/07', '2026/11/20', '', '1', 'I63.9', 'I63.9']
  ]);
  assert.equal(rows[0].gender, '女');
  assert.equal(rows[0].physicianId, '');
  assert.equal(rows[6].heightCm, '');
  assert.equal(rows[0]['history.acuteCoronarySyndrome'], false);
  assert.equal(props.NHI_PATIENT_LAST_ROW_ID, '8');
  const headers = sheet.state.cells[0];
  assert.equal(sheet.state.formats['2:' + (headers.indexOf('birthday') + 1)], '@');
  assert.equal(sheet.state.formats['2:' + (headers.indexOf('careStage') + 1)], '@');
  assert.equal(sheet.state.formats['2:' + (headers.indexOf('heightCm') + 1)], 'General');
  assert.deepEqual(plain(sheet.state.validations[headers.indexOf('careStage') + 1]), ['1', '2']);
  assert.deepEqual(plain(sheet.state.checkboxes), [{ row: 2, column: headers.indexOf('history.acuteCoronarySyndrome') + 1, rows: 8, columns: 16 }]);
});

test('re-import is idempotent and rowId never reuses a deleted value', async () => {
  const { context, state } = server();
  const rows = await syntheticRows();
  context.importNhiHisExport({ rows });
  const again = plain(context.importNhiHisExport({ rows }));
  assert.equal(again.imported, 0);
  assert.equal(again.skipped.filter(item => /同一就醫日期/.test(item.reason)).length, 8);
  const sheet = state.sheets.get(TAB);
  sheet.state.cells.length = 8;
  const fresh = rows.find(row => row.values.patientId === 'A100000009');
  const result = plain(context.importNhiHisExport({ rows: [fresh] }));
  assert.equal(result.firstRowId, 9, 'the deleted rowId 8 must not be reissued');
});

test('a 新收案 and its 追蹤 in one file link regardless of file order', async () => {
  const { context, state } = server();
  const rows = await syntheticRows();
  const intake = rows.find(row => row.line === 4);
  const followUp = rows.find(row => row.line === 13);
  const result = plain(context.importNhiHisExport({ rows: [followUp, intake] }));
  assert.equal(result.followUpsWithoutIntake, 0);
  const [first, second] = records(state.sheets.get(TAB));
  assert.deepEqual([first.careStage, second.careStage, second.enrollmentDate], ['1', '2', '2026/09/11']);
});

test('manual follow-up repeats baseline from the 新收案 row and blanks time-point data', async () => {
  const { context, state } = server();
  context.importNhiHisExport({ rows: await syntheticRows() });
  const sheet = state.sheets.get(TAB);
  const headers = sheet.state.cells[0];
  const col = key => headers.indexOf(key);
  // Clinician completes the intake row, then selects the later 追蹤 row (rowId 7).
  Object.assign(sheet.state.cells[1], {
    [col('physicianId')]: 'Z000000000', [col('acuteAdmissionDate')]: '2026/09/01',
    [col('history.acuteCoronarySyndrome')]: true, [col('ldlCMgDl')]: 160,
    [col('lifestyleScores.nutrition')]: 6, [col('workflowStatus')]: 'COMPLETE'
  });
  sheet.state.activeRow = 8;
  context.nhiAddFollowUpFromSelection();
  const added = records(sheet).at(-1);
  assert.equal(added.rowId, 9);
  assert.deepEqual(
    [added.workflowStatus, added.careStage, added.patientId, added.name, added.enrollmentDate,
      added.physicianId, added.acuteAdmissionDate, added.primaryDiagnosisCode,
      added['history.acuteCoronarySyndrome'], added['history.twoOrMoreMIs']],
    ['DRAFT', '2', 'A100000002', '測試甲', '2026/09/11', 'Z000000000', '2026/09/01', 'I63.89', true, false]);
  for (const key of ['visitDate', 'examDate', 'ldlCMgDl', 'lifestyleScores.nutrition', 'smoking']) {
    assert.equal(added[key], '', key);
  }
  assert.deepEqual(plain(sheet.state.activated), { row: 10, column: col('visitDate') + 1 });
  assert.match(state.alerts.at(-1), /rowId 9（沿用 rowId 1/);

  sheet.state.activeRow = 1;
  assert.throws(() => context.nhiAddFollowUpFromSelection(), /選取一位病人/);
  const other = server({ activeSheet: fakeSheet('其他') });
  assert.throws(() => other.context.nhiAddFollowUpFromSelection(), /切換到/);
});

test('importer fails closed on altered headers and malformed payloads', async () => {
  const rows = await syntheticRows();
  const altered = fakeSheet(TAB);
  altered.getRange(1, 1, 1, 2).setValues([['rowId', 'status']]);
  assert.throws(() => server({ sheet: altered }).context.importNhiHisExport({ rows }), /標題/);

  const { context, state } = server();
  for (const request of [null, { rows: [] }, { rows: new Array(501).fill(rows[0]) },
    { rows: [{ line: 4, values: { ...rows[0].values, extra: 'x' } }] },
    { rows: [{ line: 4, values: { ...rows[0].values, name: 1 } }] }]) {
    assert.throws(() => context.importNhiHisExport(request));
  }
  assert.equal(state.sheets.size, 0, 'nothing is written for rejected payloads');
  const formula = plain(context.importNhiHisExport({ rows: [{ line: 4, values: { ...rows[0].values, name: '=HYPERLINK("x")' } }] }));
  assert.deepEqual(formula.skipped, [{ line: 4, reason: '姓名空白或含不允許字元' }]);
});

test('imported rows are hidden from the Render gateway until marked PENDING', async t => {
  let gateway;
  try {
    gateway = require('../gateway/patient-api.cjs');
  } catch {
    return t.skip('gateway dependencies are not installed');
  }
  const { context, state } = server();
  context.importNhiHisExport({ rows: await syntheticRows() });
  const sheet = state.sheets.get(TAB);
  const values = plain(sheet.getRange(1, 1, sheet.getLastRow(), sheet.state.cells[0].length).getValues());
  assert.ok(gateway.sheetRecords(values).records.every(record => record.status === 'DRAFT'));
  values[1][1] = 'PENDING';
  values[7][1] = 'PENDING';
  const pending = gateway.sheetRecords(values).records.filter(record => record.status === 'PENDING');
  const response = gateway.validateResult({ success: true, patient: pending[0].patient }, true);
  assert.deepEqual(response.patient, {
    rowId: 1, patientId: 'A100000002', name: '測試甲', birthday: '1969/09/01', gender: '女',
    visitDate: '2026/09/11', enrollmentDate: '2026/09/11', careStage: '1', physicianName: '測試醫師',
    primaryDiagnosisCategory: '1', primaryDiagnosisCode: 'I63.89',
    history: Object.fromEntries(Object.keys(response.patient.history).map(key => [key, false]))
  });
  assert.ok(!('chartNo' in response.patient) && !('hisDiagnosisCode' in response.patient));
  const followUp = gateway.validateResult({ success: true, patient: pending[1].patient }, true).patient;
  assert.deepEqual([followUp.rowId, followUp.careStage, followUp.visitDate, followUp.enrollmentDate],
    [7, '2', '2026/11/20', '2026/09/11']);
});
