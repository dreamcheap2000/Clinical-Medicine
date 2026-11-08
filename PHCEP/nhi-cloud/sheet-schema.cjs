'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
// Reuse the canonical worksheet contract without executing any Google services.
module.exports = vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..',
  'nhi-sheet-script', 'NhiSheet.gs'), 'utf8') +
  '\nJSON.parse(JSON.stringify({tab:NHI_TAB_,headers:NHI_HEADERS_,textColumns:NHI_TEXT_COLUMNS_,labels:NHI_LABELS_}))',
{}, { timeout: 1000 });
