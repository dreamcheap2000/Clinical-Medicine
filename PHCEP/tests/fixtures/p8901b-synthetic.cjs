'use strict';

// Builds a SYNTHETIC "特殊處置明細表" P8901B export with the same layout as the HIS file.
// Every identifier fails the Taiwan national-ID checksum, so no row can be a real person.
// Usage: node tests/fixtures/p8901b-synthetic.cjs <output.xlsx>

const fs = require('node:fs');
const zlib = require('node:zlib');

const HEADERS = ['院內代碼', '醫令名稱', '醫師姓名', '科別', '病歷號碼', '病患姓名', '身分證號', '看診日期',
  '病患序號', '調劑', '身份', '自費', '單價', '次數', '天數', '刀別', '開立總量', '開立總金額', '優免身分1',
  '優免身分2', '優免身分3', '次身分', '就醫序號', '主診斷', '特定治療1', '特定治療2', '特定治療3',
  '特定治療4', '轉入院所', '通訊地址', '出生日期', '年齡', '性別', '國籍', '執行地點', '掛號種類', '扣庫別',
  '實作醫師1', '實作醫師2', '住家電話', '手機', '細碼', '健保卡卡號', '醫師代碼', '地區代碼', '批價人員員編',
  '批價人員姓名', '手術通知日期', '手術預排日期', '診別', '轉出院所代碼', '轉出院所名稱', '開單日', '簽收日',
  '單號', '寄售品', '儀器代碼', '儀器資訊'];

// [院內代碼, 病歷號碼, 姓名, 身分證號, 看診日期(民國), 主診斷, 出生日期(民國), 性別]
const ROWS = [
  ['P8901B', 'SYN0001', '測試甲', 'A100000002', '115/09/11', 'I63.89', '058/09/01', '女'],
  ['P8901B', 'SYN0002', '測試乙', 'A100000003', '115/09/11', 'E11.8', '054/01/03', '女'],
  ['P8901B', 'SYN0003', '測試丙', 'A100000004', '115/09/14', 'G45.9', '049/05/12', '男'],
  ['P8901B', 'SYN0004', '測試丁', 'A100000005', '115/09/14', 'I25.10', '054/02/28', '女'],
  ['P8901B', 'SYN0005', '測試戊', 'A100000006', '115/10/15', 'I21.4', '051/01/27', '男'],
  ['P8901B', 'SYN0006', '測試己', 'A100000007', '115/10/26', 'I70.213', '050/10/13', '男'],
  // Duplicate 新收案, impossible birthday (Feb 30), and an unrelated order.
  ['P8901B', 'SYN0001', '測試甲', 'A100000002', '115/10/26', 'I63.89', '058/09/01', '女'],
  ['P8901B', 'SYN0008', '測試庚', 'A100000008', '115/10/26', 'I63.9', '113/02/30', '男'],
  ['P1234X', 'SYN0009', '測試辛', 'B100000003', '115/10/26', 'I63.9', '060/06/06', '女'],
  // 追蹤管理 for an enrolled patient, and one whose 新收案 row is not in the sheet.
  ['P8902B', 'SYN0001', '測試甲', 'A100000002', '115/11/20', 'E78.5', '058/09/01', '女'],
  ['P8902B', 'SYN0010', '測試壬', 'A100000009', '115/11/20', 'I63.9', '061/07/07', '男']
];

function taiwanIdValid(id) {
  const letters = 'ABCDEFGHJKLMNPQRSTUVXYWZIO';
  const code = letters.indexOf(id[0]) + 10;
  const digits = [Math.floor(code / 10), code % 10, ...id.slice(1).split('').map(Number)];
  const weights = [1, 9, 8, 7, 6, 5, 4, 3, 2, 1, 1];
  return digits.reduce((sum, digit, index) => sum + digit * weights[index], 0) % 10 === 0;
}

function columnName(index) {
  let result = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    result = String.fromCharCode(65 + (n - 1) % 26) + result;
  }
  return result;
}

function xml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function sheetRows() {
  const rows = [['特殊處置明細表'], ['Print date:115/10/30 10:46 (SYNTHETIC TEST DATA)'], HEADERS];
  ROWS.forEach(([order, chartNo, name, id, visit, diagnosis, birthday, gender], index) => {
    const row = new Array(HEADERS.length).fill('');
    const set = (header, value) => { row[HEADERS.indexOf(header)] = value; };
    set('院內代碼', order);
    set('醫令名稱', order === 'P8901B' ? '高血脂試辦計畫新收案照護費' : '其他醫令（測試）');
    set('醫師姓名', '測試醫師');
    set('科別', '神經內科');
    set('病歷號碼', chartNo);
    set('病患姓名', name);
    set('身分證號', id);
    set('看診日期', visit);
    set('調劑', '院內');
    set('身份', '健保');
    set('自費', 'N');
    set('單價', 500);
    set('次數', 1);
    set('主診斷', diagnosis);
    set('通訊地址', '測試地址（不應匯入）');
    set('出生日期', birthday);
    set('性別', gender);
    set('國籍', '本國');
    set('住家電話', '0200000000');
    set('手機', '0900000' + String(index).padStart(3, '0'));
    set('健保卡卡號', '000000000000');
    set('醫師代碼', 'TEST01');
    set('診別', '01');
    rows.push(row);
  });
  return rows;
}

function workbookFiles() {
  const shared = [];
  const sharedIndex = new Map();
  const cell = (value, reference) => {
    if (value === '') return '';
    if (typeof value === 'number') return `<c r="${reference}"><v>${value}</v></c>`;
    // The title uses an inline string so both Excel string storage forms are exercised.
    if (reference === 'A1') {
      return `<c r="${reference}" t="inlineStr"><is><t>${xml(value)}</t></is></c>`;
    }
    if (!sharedIndex.has(value)) {
      sharedIndex.set(value, shared.length);
      shared.push(value);
    }
    return `<c r="${reference}" t="s"><v>${sharedIndex.get(value)}</v></c>`;
  };
  const body = sheetRows().map((row, rowIndex) => `<row r="${rowIndex + 1}">` +
    row.map((value, column) => cell(value, columnName(column) + (rowIndex + 1))).join('') +
    '</row>').join('');
  const main = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  return {
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>' +
      '</Types>',
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      `<Relationship Id="rId1" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      `<workbook xmlns="${main}" xmlns:r="${rel}"><sheets>` +
      '<sheet name="工作表1" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      `<Relationship Id="rId1" Type="${rel}/worksheet" Target="worksheets/sheet1.xml"/>` +
      `<Relationship Id="rId2" Type="${rel}/sharedStrings" Target="sharedStrings.xml"/>` +
      '</Relationships>',
    'xl/sharedStrings.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      `<sst xmlns="${main}" count="${shared.length}" uniqueCount="${shared.length}">` +
      shared.map(value => `<si><t>${xml(value)}</t></si>`).join('') + '</sst>',
    'xl/worksheets/sheet1.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      `<worksheet xmlns="${main}"><dimension ref="A1:BF${ROWS.length + 3}"/>` +
      `<sheetData>${body}</sheetData></worksheet>`
  };
}

function zip(files) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const nameBytes = Buffer.from(name, 'utf8');
    const data = Buffer.from(text, 'utf8');
    const compressed = zlib.deflateRawSync(data);
    const crc = zlib.crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(0x0800, 8);
    header.writeUInt16LE(8, 10);
    header.writeUInt32LE(crc, 16);
    header.writeUInt32LE(compressed.length, 20);
    header.writeUInt32LE(data.length, 24);
    header.writeUInt16LE(nameBytes.length, 28);
    header.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, compressed);
    central.push(header, nameBytes);
    offset += local.length + nameBytes.length + compressed.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

function buildSyntheticP8901B() {
  for (const row of ROWS) {
    if (taiwanIdValid(row[3])) throw new Error('Synthetic IDs must fail the national-ID checksum.');
  }
  return zip(workbookFiles());
}

module.exports = { buildSyntheticP8901B, taiwanIdValid, HEADERS, ROWS };

if (require.main === module) {
  const output = process.argv[2];
  if (!output) throw new Error('Usage: node tests/fixtures/p8901b-synthetic.cjs <output.xlsx>');
  fs.writeFileSync(output, buildSyntheticP8901B());
  console.log(`Wrote synthetic P8901B workbook (${ROWS.length} rows): ${output}`);
}
