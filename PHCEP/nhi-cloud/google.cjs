'use strict';
const { OAuth2Client } = require('google-auth-library');
const { fail } = require('./core.cjs');
const schema = require('./sheet-schema.cjs');

class Google {
  constructor(config, store, vault) {
    this.config = config; this.store = store; this.vault = vault;
  }
  client() {
    return new OAuth2Client(this.config.clientId, this.config.clientSecret,
      this.config.origin + '/auth/callback');
  }
  async clientFor(user) {
    const row = await this.store.one('SELECT credentials FROM nhi_users WHERE subject=$1', [user.subject]);
    if (!row) fail(401, 'GOOGLE_RECONNECT_REQUIRED');
    const client = this.client();
    client.setCredentials(this.vault.open(row.credentials, 'google:' + user.subject));
    return client;
  }
  async request(client, url, method = 'GET', data) {
    try { return (await client.request({ url, method, data, timeout: 30000 })).data; }
    catch (error) {
      const status = error.response && error.response.status;
      fail(status === 401 || status === 403 ? 403 : 502,
        status === 401 || status === 403 ? 'GOOGLE_ACCESS_REQUIRED' : 'GOOGLE_OPERATION_FAILED');
    }
  }
  async owns(client, user, id) {
    if (!/^[A-Za-z0-9_-]{10,200}$/.test(id || '')) fail(400, 'INVALID_SHEET_ID');
    const file = await this.request(client, 'https://www.googleapis.com/drive/v3/files/' + id +
      '?fields=id,mimeType,trashed,owners(emailAddress)');
    if (file.trashed || file.mimeType !== 'application/vnd.google-apps.spreadsheet' ||
        !file.owners?.some(o => o.emailAddress?.toLowerCase() === user.email)) fail(403, 'SHEET_OWNER_REQUIRED');
  }
  async createSheet(client, user, clinic) {
    const q = "trashed=false and appProperties has { key='nhiClinic' and value='" + clinic.id + "' }";
    const found = await this.request(client, 'https://www.googleapis.com/drive/v3/files?' +
      new URLSearchParams({ q, fields: 'files(id)', pageSize: '2' }));
    if (found.files.length > 1) fail(409, 'DUPLICATE_PROVISIONING_FILES');
    const id = found.files[0]?.id || (await this.request(client,
      'https://www.googleapis.com/drive/v3/files?fields=id', 'POST', {
        name: 'NHI - ' + clinic.name, mimeType: 'application/vnd.google-apps.spreadsheet',
        appProperties: { nhiClinic: clinic.id }
      })).id;
    await this.owns(client, user, id);
    return id;
  }
  async initialize(client, id) {
    const base = 'https://sheets.googleapis.com/v4/spreadsheets/' + id;
    const book = await this.request(client, base + '?fields=sheets(properties)');
    let tab = book.sheets?.find(s => s.properties.title === schema.tab);
    if (!tab) {
      const result = await this.request(client, base + ':batchUpdate', 'POST', {
        requests: [{ addSheet: { properties: {
          title: schema.tab, gridProperties: { rowCount: 1000, columnCount: schema.headers.length,
            frozenRowCount: 1 }
        } } }]
      });
      tab = result.replies[0].addSheet;
    }
    const range = "'" + schema.tab + "'!1:1";
    const row = (await this.request(client, base + '/values/' + encodeURIComponent(range))).values?.[0];
    if (row?.some(v => v !== '')) {
      if (row.length !== schema.headers.length || row.some((v, i) => v !== schema.headers[i])) fail(409, 'SHEET_SCHEMA_MISMATCH');
      return;
    }
    const sheetId = tab.properties.sheetId;
    const requests = [
      { updateCells: { start: { sheetId, rowIndex: 0, columnIndex: 0 },
        rows: [{ values: schema.headers.map(key => ({ userEnteredValue: { stringValue: key },
          userEnteredFormat: { textFormat: { bold: true } }, note: schema.labels[key] || key })) }],
        fields: 'userEnteredValue,userEnteredFormat,note' } },
      { updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
        fields: 'gridProperties.frozenRowCount' } }
    ];
    for (const key of schema.textColumns) requests.push({
      repeatCell: { range: { sheetId, startRowIndex: 1, startColumnIndex: schema.headers.indexOf(key),
        endColumnIndex: schema.headers.indexOf(key) + 1 },
      cell: { userEnteredFormat: { numberFormat: { type: 'TEXT' } } },
      fields: 'userEnteredFormat.numberFormat' }
    });
    for (const [key, choices] of Object.entries({
      workflowStatus: ['DRAFT', 'PENDING', 'COMPLETE'], careStage: ['1', '2'],
      primaryDiagnosisCategory: ['1', '2', '3', '4'], gender: ['男', '女']
    })) requests.push({ setDataValidation: {
      range: { sheetId, startRowIndex: 1, startColumnIndex: schema.headers.indexOf(key),
        endColumnIndex: schema.headers.indexOf(key) + 1 },
      rule: { condition: { type: 'ONE_OF_LIST', values: choices.map(userEnteredValue => ({ userEnteredValue })) },
        strict: true, showCustomUi: true }
    } });
    await this.request(client, base + ':batchUpdate', 'POST', { requests });
  }
  async validateSheet(client, id) {
    const row = (await this.request(client, 'https://sheets.googleapis.com/v4/spreadsheets/' +
      id + '/values/' + encodeURIComponent("'" + schema.tab + "'!1:1"))).values?.[0];
    if (!row || row.length !== schema.headers.length || row.some((v, i) => v !== schema.headers[i])) fail(409, 'SHEET_SCHEMA_MISMATCH');
  }
}
module.exports = { Google };
