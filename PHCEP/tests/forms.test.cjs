const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const root = path.join(__dirname, '..');
const USER = 'U' + 'a'.repeat(32);
const OWNER = 'owner@example.org';

function environment(options = {}) {
  const properties = new Map(Object.entries({
    TRUSTED_EDITOR_EMAILS: 'clinician@example.org,' + OWNER,
    GATEWAY_SIGNING_SECRET: 'test-only-signing-secret-at-least-32-chars',
    LINE_CHANNEL_SECRET: 'synthetic-line-channel-secret',
    ...options.properties
  }));
  const forms = new Map();
  const books = new Map();
  const triggers = [];
  const pushes = [];
  const menuHandlers = [];
  const folders = new Map();
  let formCount = 0;
  let sheetCount = 0;
  let itemCount = 100;
  let locked = false;
  let pushFailure = false;
  let pushHook = null;
  let pushResult = { ok: true };
  let protectionFailure = false;
  const user = email => ({ getEmail: () => email });
  class Range {
    constructor(sheet, row, col, rows = 1, cols = 1) {
      Object.assign(this, { sheet, row, col, rows, cols });
      assert.ok(rows > 0 && cols > 0, 'invalid range dimension');
      assert.ok(col + cols - 1 <= sheet.columns, 'range exceeds sheet capacity');
    }
    getSheet() { return this.sheet; }
    getRow() { return this.row; }
    getColumn() { return this.col; }
    getNumRows() { return this.rows; }
    getNumColumns() { return this.cols; }
    getValues() {
      return Array.from({ length: this.rows }, (_, r) =>
        Array.from({ length: this.cols }, (_, c) => this.sheet.data[this.row + r - 1]?.[this.col + c - 1] ?? ''));
    }
    getValue() { return this.getValues()[0][0]; }
    getFormulas() {
      return Array.from({ length: this.rows }, (_, r) =>
        Array.from({ length: this.cols }, (_, c) => this.sheet.formulas?.[this.row + r - 1]?.[this.col + c - 1] ?? ''));
    }
    setValues(values) {
      values.forEach((row, r) => row.forEach((value, c) => {
        this.sheet.data[this.row + r - 1] ||= [];
        this.sheet.data[this.row + r - 1][this.col + c - 1] = value;
      }));
      return this;
    }
    setValue(value) { return this.setValues([[value]]); }
    clearContent() { return this.setValues(Array.from({ length: this.rows }, () => Array(this.cols).fill(''))); }
    setRichTextValue(value) { return this.setValue(value); }
    getRichTextValue() { const value = this.getValue(); return value && typeof value === 'object' ? value : null; }
    setDataValidation(rule) { this.sheet.rules.set(`${this.row}:${this.col}`, rule); return this; }
    clearDataValidations() { this.sheet.rules.delete(`${this.row}:${this.col}`); return this; }
    setFontWeight(value) { this.sheet.headerWeight = value; return this; }
    setBackground(value) { this.sheet.headerBackground = value; return this; }
    setNote(value) { this.sheet.notes ||= new Map(); this.sheet.notes.set(`${this.row}:${this.col}`, value); return this; }
  }
  class Protection {
    constructor() { this.editors = [OWNER, 'untrusted@example.org']; this.domain = true; this.warning = true; }
    setDescription(value) { this.description = value; return this; }
    setWarningOnly(value) { if (protectionFailure) throw new Error('Protection denied'); this.warning = value; return this; }
    setUnprotectedRanges(ranges) { this.unprotected = ranges; return this; }
    addEditors(emails) { this.editors = [...new Set([...this.editors, ...emails])]; return this; }
    getEditors() { return this.editors.map(user); }
    removeEditors(users) { this.editors = this.editors.filter(email => !users.some(u => u.getEmail() === email)); return this; }
    canDomainEdit() { return this.domain; }
    setDomainEdit(value) { this.domain = value; return this; }
  }
  class Sheet {
    constructor(book, name) {
      Object.assign(this, { book, name, data: [], columns: options.columns || 8, rows: 20,
        id: ++sheetCount, rules: new Map(), protections: [], formUrl: null });
    }
    getName() { return this.name; }
    setName(name) { this.name = name; return this; }
    getParent() { return this.book; }
    getSheetId() { return this.id; }
    getFormUrl() { return this.formUrl; }
    getMaxColumns() { return this.columns; }
    insertColumnsAfter(col, count) {
      assert.ok(col >= 1 && col <= this.columns);
      this.data.forEach(row => { if (row && row.length > col) row.splice(col, 0, ...Array(count).fill('')); });
      this.columns += count;
    }
    hideColumns(col, count) { this.hidden = [...new Set([...(this.hidden || []), ...Array.from({ length: count }, (_, i) => col + i)])]; }
    isColumnHiddenByUser(col) { return (this.hidden || []).includes(col); }
    getMaxRows() { return this.rows; }
    getFrozenRows() { return this.frozenRows || 0; }
    setFrozenRows(count) { this.frozenRows = count; }
    insertRowsAfter(row, count) { this.rows += count; }
    getLastRow() { return this.data.length; }
    getLastColumn() {
      return this.data.reduce((max, row) => Math.max(max, (row || []).reduce((last, value, i) => value !== '' && value != null ? i + 1 : last, 0)), 0);
    }
    getIndex() { return this.book.sheets.indexOf(this) + 1; }
    getRange(...args) { return new Range(this, ...args); }
    appendRow(row) { assert.ok(row.length <= this.columns); this.data.push([...row]); return this; }
    getProtections() { return this.protections; }
    protect() { const protection = new Protection(); this.protections.push(protection); return protection; }
  }
  class Book {
    constructor(id) { this.id = id; this.sheets = []; this.activeRange = null; books.set(id, this); }
    getId() { return this.id; }
    getUrl() { return 'https://docs.google.com/spreadsheets/d/' + this.id; }
    getOwner() { return user(OWNER); }
    getSheets() { return this.sheets; }
    getSheetByName(name) { return this.sheets.find(sheet => sheet.name === name) || null; }
    insertSheet(name) { const sheet = new Sheet(this, name); this.sheets.push(sheet); return sheet; }
    getActiveSheet() { return this.activeRange?.getSheet() || this.sheets[0]; }
    getActiveRange() { return this.activeRange; }
    setActiveSheet(sheet) { this.activeSheet = sheet; return sheet; }
    moveActiveSheet(position) {
      this.sheets.splice(this.sheets.indexOf(this.activeSheet), 1);
      this.sheets.splice(position - 1, 0, this.activeSheet);
    }
    toast() {}
  }
  class Item {
    constructor(type) { this.type = type; this.id = ++itemCount; }
    getId() { return this.id; }
    getTitle() { return this.title; }
    setTitle(title) { this.title = title; return this; }
    setHelpText(help) { this.help = help; return this; }
    setRequired(required) { this.required = required; return this; }
    setChoiceValues(choices) { this.choices = choices; return this; }
    setRows(rows) { this.gridRows = rows; return this; }
    setColumns(cols) { this.gridColumns = cols; return this; }
    asTextItem() { assert.equal(this.type, 'Text'); return this; }
    createResponse(response) { return { getItem: () => this, getResponse: () => response }; }
  }
  class Form {
    constructor(title) { this.id = 'form-' + ++formCount; this.title = title; this.items = []; forms.set(this.id, this); }
    getId() { return this.id; }
    getPublishedUrl() { return `https://docs.google.com/forms/d/${this.id}/viewform`; }
    setDescription(description) { this.description = description; return this; }
    setIsQuiz(value) { this.quiz = value; return this; }
    setAllowResponseEdits(value) { this.responseEdits = value; return this; }
    getItems() { return this.items; }
    getItemById(id) { return this.items.find(item => item.id === id) || null; }
    getDestinationId() { return this.destination || null; }
    setDestination(type, id) {
      this.destination = id;
      const sheet = books.get(id).insertSheet('unexpected arbitrary response ' + this.id);
      sheet.formUrl = this.getPublishedUrl();
      sheet.columns = 100;
      sheet.appendRow(['Timestamp', 'raw untouched']);
    }
    createResponse() {
      const answers = [];
      return {
        withItemResponse(answer) { answers.push(answer); return this; },
        toPrefilledUrl: () => this.getPublishedUrl() + '?usp=pp_url&' + answers.map(answer =>
          'entry.' + answer.getItem().getId() + '=' + encodeURIComponent(answer.getResponse())).join('&')
      };
    }
  }
  for (const type of ['Text', 'Date', 'DateTime', 'SectionHeader', 'PageBreak', 'MultipleChoice', 'ParagraphText', 'Grid']) {
    Form.prototype['add' + type + 'Item'] = function() { const item = new Item(type); this.items.push(item); return item; };
    Item.prototype['as' + type + 'Item'] = function() { assert.equal(this.type, type); return this; };
  }
  const active = options.standalone ? null : new Book('bound-book');
  if (options.properties?.SPREADSHEET_ID) new Book(options.properties.SPREADSHEET_ID);
  const validation = () => {
    const rule = {};
    return {
      requireCheckbox() { rule.checkbox = true; return this; },
      requireValueInList(values) { rule.values = values; return this; },
      setAllowInvalid(value) { rule.allowInvalid = value; return this; },
      build() { return rule; }
    };
  };
  const ui = {
    ButtonSet: { YES_NO: 'YES_NO' }, Button: { YES: 'YES' }, answer: 'YES',
    alert: () => ui.answer,
    createMenu: () => ({ addItem(label, handler) { menuHandlers.push(handler); return this; }, addToUi() {} })
  };
  const context = vm.createContext({
    Date, JSON, console,
    DriveApp: {
      Access: { PRIVATE: 'PRIVATE' },
      getFolderById: id => folders.get(id),
      createFolder: () => {
        const id = 'folder-' + (folders.size + 1);
        const folder = { access: 'PRIVATE', getId: () => id,
          getUrl: () => 'https://drive.google.com/drive/folders/' + id,
          getSharingAccess() { return this.access; } };
        folders.set(id, folder); return folder;
      }
    },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: key => properties.get(key) ?? null,
      setProperty: (key, value) => { properties.set(key, String(value)); }
    }) },
    Session: { getEffectiveUser: () => user(OWNER) },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => active,
      create: () => new Book('standalone-book'),
      openById: id => { assert.ok(books.has(id)); return books.get(id); },
      newDataValidation: validation, flush() {}, ProtectionType: { SHEET: 'SHEET' }, getUi: () => ui,
      newRichTextValue: () => ({
        setText(text) { this.text = text; return this; },
        setLinkUrl(url) { this.url = url; return this; },
        build() { const { text, url } = this; return { text, url, getText: () => text, getLinkUrl: () => url }; }
      })
    },
    FormApp: {
      create: title => new Form(title),
      openById: id => { assert.ok(forms.has(id)); return forms.get(id); },
      openByUrl: url => {
        const form = [...forms.values()].find(form => url.split('?')[0] === form.getPublishedUrl());
        assert.ok(form, 'unknown form URL'); return form;
      },
      DestinationType: { SPREADSHEET: 'SPREADSHEET' }
    },
    Utilities: {
      getUuid: () => crypto.randomUUID(),
      Charset: { UTF_8: 'UTF_8' },
      computeHmacSha256Signature: (payload, secret) => crypto.createHmac('sha256', secret).update(payload).digest(),
      base64EncodeWebSafe: bytes => Buffer.from(bytes).toString('base64url')
    },
    ScriptApp: {
      EventType: { ON_EDIT: 'ON_EDIT', ON_FORM_SUBMIT: 'ON_FORM_SUBMIT' },
      getProjectTriggers: () => [...triggers],
      deleteTrigger: trigger => { triggers.splice(triggers.indexOf(trigger), 1); },
      newTrigger: handler => {
        let id, type;
        const builder = {
          forSpreadsheet(ss) { id = ss.getId(); return this; },
          forForm(form) { id = form.getId(); return this; },
          onEdit() { type = 'ON_EDIT'; return this; },
          onFormSubmit() { type = 'ON_FORM_SUBMIT'; return this; },
          create() {
            const uid = crypto.randomUUID();
            const trigger = { getUniqueId: () => uid, getHandlerFunction: () => handler, getTriggerSourceId: () => id, getEventType: () => type };
            triggers.push(trigger); return trigger;
          }
        };
        return builder;
      }
    },
    phcepWithLock_: fn => { assert.equal(locked, false, 'nested lock'); locked = true; try { return fn(); } finally { locked = false; } },
    phcepSpreadsheet_: () => books.get(properties.get('SPREADSHEET_ID')),
    phcepDigest_: value => crypto.createHash('sha256').update(value).digest('hex'),
    phcepLiteral_: value => /^[=+\-@]/.test(String(value)) ? "'" + value : String(value),
    phcepProperty_: (key, aliases = []) => properties.get(key) || aliases.map(alias => properties.get(alias)).find(Boolean) || '',
    phcepPush_: (key, recipient, messages) => {
      assert.equal(locked, true, 'push without lock');
      pushes.push({ key, recipient, messages });
      if (pushHook) pushHook();
      if (pushFailure) throw new Error('private network failure');
      return pushResult;
    }
  });
  for (const file of ['Setup.gs', 'Forms.gs', 'UI.gs', 'Matcher.gs', 'Workflow.gs', 'ManualMigration.gs']) {
    vm.runInContext(fs.readFileSync(path.join(root, 'apps-script', file), 'utf8'), context, { filename: file });
  }
  return { context, properties, forms, books, folders, active, triggers, pushes, menuHandlers, ui,
    setPushFailure: value => { pushFailure = value; },
    setPushHook: value => { pushHook = value; },
    setPushResult: value => { pushResult = value; },
    setProtectionFailure: value => { protectionFailure = value; },
    formCount: () => formCount, book: () => books.get(properties.get('SPREADSHEET_ID')) };
}

function setup(options) {
  const env = environment(options);
  env.context.setupPHCEP();
  return env;
}

function submission(env, type, token, responseId = 'response-1', otherAnswers = []) {
  const form = env.forms.get(env.properties.get(type + '_FORM_ID'));
  const tokenItem = form.getItemById(Number(env.properties.get(type + '_TOKEN_ITEM_ID')));
  const timestamp = new Date();
  return {
    source: form,
    triggerUid: env.triggers.find(trigger => trigger.getTriggerSourceId() === form.id).getUniqueId(),
    response: { getId: () => responseId, getTimestamp: () => timestamp,
      getItemResponses: () => [tokenItem.createResponse(token), ...otherAnswers] }
  };
}

function invite(env, type = 'CDR') {
  const invitation = env.context.createPHCEPInvitation(USER, type);
  const url = new URL(invitation.url);
  return { ...invitation, token: url.searchParams.get('entry.' + env.properties.get(type + '_TOKEN_ITEM_ID')) };
}

test('fresh and repeat standalone/bound setup preserve data, grow capacity, protect private sheets', () => {
  for (const standalone of [true, false]) {
    const env = setup({ standalone, columns: 3 });
    const book = env.book();
    const line = book.getSheetByName('LINE對話');
    line.appendRow(['m', false, USER]);
    const cdr = env.forms.get(env.properties.get('CDR_FORM_ID'));
    const count = cdr.items.length;
    assert.equal(cdr.responseEdits, false);
    const responseSheets = book.getSheets().filter(sheet => sheet.formUrl);
    const raw = JSON.stringify(responseSheets.map(sheet => sheet.data));
    book.getSheetByName('PHCEP臨床評分').appendRow(['manual', 0.5, '', '', '', '', '', '人工值']);
    env.context.setupPHCEP();
    assert.equal(env.formCount(), 2);
    assert.equal(cdr.items.length, count);
    assert.equal(line.getRange(2, 3).getValue(), USER);
    assert.equal(line.columns, 24);
    assert.deepEqual(book.getSheets().slice(0, 3).map(sheet => sheet.name), ['總覽', 'LINE對話', 'QA知識庫']);
    assert.equal(book.getSheetByName('QA知識庫').columns, 15);
    assert.equal(book.getSheetByName('PHCEP寄件匣').getRange(1, 8).getValue(), 'Created At');
    assert.equal(book.getSheetByName('PHCEP臨床評分').getRange(2, 8).getValue(), '人工值');
    assert.equal(JSON.stringify(responseSheets.map(sheet => sheet.data)), raw);
    for (const sheet of book.getSheets()) {
      assert.equal(sheet.protections.length, 1);
      assert.equal(sheet.protections[0].warning, false);
      assert.equal(sheet.protections[0].domain, false);
      assert.deepEqual(Array.from(sheet.protections[0].unprotected), []);
      assert.deepEqual(sheet.protections[0].editors.sort(), [OWNER, 'clinician@example.org'].sort());
    }
    assert.equal(env.properties.get('CDR_RESPONSE_SHEET_ID'), String(responseSheets[0].id));
  }
});

test('every menu handler exists in canonical Apps Script including curated embeddings', () => {
  const env = environment();
  vm.runInContext(fs.readFileSync(path.join(root, 'apps-script', 'Embeddings.gs'), 'utf8'), env.context);
  env.context.onOpen();
  assert.ok(env.menuHandlers.includes('buildCuratedQAEmbeddings'));
  assert.ok(!env.menuHandlers.includes('buildQAEmbeddings'));
  for (const handler of env.menuHandlers) assert.equal(typeof env.context[handler], 'function', handler);
});

test('authorized configuration validation exposes missing property names only and permits provisioning without LINE token', () => {
  const env = environment();
  const before = env.context.validatePHCEPConfiguration();
  assert.deepEqual(Array.from(before.missing).sort(), ['IMAGE_FOLDER_ID', 'LINE_CHANNEL_ACCESS_TOKEN', 'SPREADSHEET_ID'].sort());
  const result = env.context.setupPHCEP();
  assert.deepEqual(Array.from(result.missingRuntimeProperties), ['LINE_CHANNEL_ACCESS_TOKEN']);
  const serialized = JSON.stringify(env.context.validatePHCEPConfiguration());
  assert.ok(!serialized.includes(env.properties.get('GATEWAY_SIGNING_SECRET')));
  env.properties.set('GATEWAY_SIGNING_SECRET', 'short');
  assert.ok(env.context.validatePHCEPConfiguration().missing.includes('GATEWAY_SIGNING_SECRET'));
  assert.throws(() => env.context.setupPHCEP(), /Configure distinct/);
});

test('configured spreadsheet wins, legacy form URL is migrated and preserved', () => {
  const env = environment({ properties: { SPREADSHEET_ID: 'configured' } });
  const legacy = env.context.FormApp.create('existing form');
  legacy.setAllowResponseEdits(true);
  legacy.addTextItem().setTitle('existing clinical question');
  env.properties.set('GOOGLE_FORM_URL', legacy.getPublishedUrl());
  env.context.setupPHCEP();
  assert.equal(env.book().id, 'configured');
  assert.equal(env.properties.get('CDR_FORM_ID'), legacy.id);
  assert.equal(env.properties.get('GOOGLE_FORM_URL'), legacy.getPublishedUrl());
  assert.equal(legacy.items[0].title, 'existing clinical question');
  assert.equal(legacy.items.length, 3);
  assert.equal(legacy.responseEdits, true);
});

test('setup reuses private media folder, returns authorized URLs and initializes safe header styles', () => {
  const env = setup();
  const result = env.context.setupPHCEP();
  assert.equal(env.folders.size, 1);
  assert.equal(result.mediaFolderId, env.properties.get('IMAGE_FOLDER_ID'));
  assert.equal(result.spreadsheetUrl, env.book().getUrl());
  assert.equal(result.cdrFormUrl, env.forms.get(result.cdrFormId).getPublishedUrl());
  assert.equal(result.vitalsFormUrl, env.forms.get(result.vitalsFormId).getPublishedUrl());
  for (const sheet of env.book().getSheets().filter(sheet => !sheet.formUrl)) {
    assert.equal(sheet.frozenRows, 1);
    assert.equal(sheet.headerWeight, 'bold');
    assert.equal(sheet.headerBackground, '#e8f0fe');
  }
  env.folders.get(result.mediaFolderId).access = 'ANYONE';
  assert.throws(() => env.context.setupPHCEP(), /must be private/);
});

test('new form provisioning resumes interrupted per-item building without duplicate questions', () => {
  const env = environment();
  const create = env.context.FormApp.create;
  let interrupted = false;
  env.context.FormApp.create = title => {
    const form = create(title);
    const add = form.addMultipleChoiceItem;
    form.addMultipleChoiceItem = function() {
      if (!interrupted && this.items.length > 12) { interrupted = true; throw new Error('builder interrupted'); }
      return add.call(this);
    };
    return form;
  };
  assert.throws(() => env.context.setupPHCEP(), /builder interrupted/);
  const formId = env.properties.get('CDR_FORM_ID');
  env.context.setupPHCEP();
  assert.equal(env.properties.get('CDR_FORM_ID'), formId);
  assert.equal(env.properties.get('CDR_PROVISION_STAGE'), 'COMPLETE');
  assert.equal(env.formCount(), 2);
  assert.equal(env.forms.get(formId).items.filter(item => item.title === '1. 他/她是否有記憶力或思考方面的問題？').length, 1);
  assert.ok(env.forms.get(formId).items.some(item => item.title.startsWith('被評估者病識感')));
});

test('inconsistent headers and protection failure propagate, trusted editors required', () => {
  const env = environment();
  env.active.insertSheet('LINE對話').appendRow(['wrong schema']);
  assert.throws(() => env.context.setupPHCEP(), /Inconsistent schema/);
  assert.equal(env.active.getSheetByName('LINE對話').getRange(1, 1).getValue(), 'wrong schema');
  const failed = environment();
  failed.setProtectionFailure(true);
  assert.throws(() => failed.context.setupPHCEP(), /Protection denied/);
  assert.equal(failed.formCount(), 0);
  const missing = environment({ properties: { TRUSTED_EDITOR_EMAILS: '' } });
  assert.throws(() => missing.context.setupPHCEP(), /TRUSTED_EDITOR_EMAILS/);
});

test('unlabelled legacy reply-history data cannot be overwritten by K/L schema extension', () => {
  const env = environment({ columns: 12 });
  const line = env.active.insertSheet('LINE對話');
  const headers = ['Message ID', '發送問卷 (勾選)', 'User ID', 'DateTime', 'User Name', '訊息 (病患問題)',
    '檔案/媒體連結', '建議回覆選單', '回覆草稿 (可編輯)', '回覆紀錄 (最新)'];
  line.appendRow(headers);
  line.appendRow(['id', false, USER, '', '', '', '', '', '', 'latest', 'historical private reply']);
  assert.throws(() => env.context.setupPHCEP(), /Unlabelled data overlaps schema/);
  assert.equal(line.getRange(2, 11).getValue(), 'historical private reply');
  assert.equal(line.getRange(1, 11).getValue(), '');
});

test('setup deduplicates only owned installable handlers and uses actual form sources', () => {
  const env = setup();
  env.triggers.push(env.triggers[0]);
  env.triggers.push({
    getHandlerFunction: () => 'phcepHandleFormSubmit', getTriggerSourceId: () => 'wrong-form',
    getEventType: () => 'ON_FORM_SUBMIT'
  });
  const unrelated = {
    getHandlerFunction: () => 'otherHandler', getTriggerSourceId: () => 'other',
    getEventType: () => 'ON_EDIT'
  };
  env.triggers.push(unrelated);
  env.context.setupPHCEP();
  assert.equal(env.triggers.length, 4);
  assert.ok(env.triggers.includes(unrelated));
  assert.equal(env.triggers.filter(t => t.getHandlerFunction() === 'phcepHandleEdit').length, 1);
  assert.deepEqual(env.triggers.filter(t => t.getHandlerFunction() === 'phcepHandleFormSubmit')
    .map(t => t.getTriggerSourceId()).sort(), [...env.forms.keys()].sort());
  assert.equal(typeof env.context.onEdit, 'undefined');
});

test('handlers reject missing, wrong-source and unknown trigger UIDs', () => {
  const env = setup();
  const line = env.book().getSheetByName('LINE對話');
  line.appendRow(['id', true, USER]);
  const edit = { range: line.getRange(2, 2), user: { getEmail: () => OWNER } };
  env.context.phcepHandleEdit(edit);
  env.context.phcepHandleEdit({ ...edit, triggerUid: 'unknown' });
  env.context.phcepHandleEdit({ ...edit, triggerUid: env.triggers[1].getUniqueId() });
  assert.equal(env.pushes.length, 0);
  const invitation = invite(env);
  const event = submission(env, 'CDR', invitation.token);
  delete event.triggerUid;
  assert.equal(env.context.phcepHandleFormSubmit(event), undefined);
  assert.equal(env.context.phcepHandleFormSubmit({ ...event, triggerUid: env.triggers[0].getUniqueId() }), undefined);
  assert.equal(env.book().getSheetByName('PHCEP表單紀錄').getLastRow(), 1);
});

test('prefill uses actual token item only, LINE ID optional and opaque token domain separated', () => {
  const env = setup();
  for (const type of ['CDR', 'VITALS']) {
    const invitation = invite(env, type);
    assert.ok(!invitation.url.includes(USER));
    const url = new URL(invitation.url);
    assert.equal(url.searchParams.has('entry.' + env.properties.get(type + '_LINE_ITEM_ID')), false);
    const form = env.forms.get(env.properties.get(type + '_FORM_ID'));
    assert.equal(form.getItemById(Number(env.properties.get(type + '_LINE_ITEM_ID'))).required, false);
    const [nonce, expiry, signature] = invitation.token.split('.');
    const expected = crypto.createHmac('sha256', env.properties.get('GATEWAY_SIGNING_SECRET'))
      .update('invitation\n' + nonce + '.' + expiry).digest('base64url');
    assert.equal(signature, expected);
    assert.equal(nonce, invitation.nonce);
    assert.ok(Number(expiry) > Date.now());
  }
});

test('invitation signing rejects short or reused LINE channel secrets', () => {
  const env = setup();
  env.properties.set('GATEWAY_SIGNING_SECRET', 'short');
  assert.throws(() => env.context.createPHCEPInvitation(USER, 'CDR'), /at least 32/);
  const reused = 'reused-channel-secret-at-least-32-characters';
  env.properties.set('GATEWAY_SIGNING_SECRET', reused);
  env.properties.set('LINE_CHANNEL_SECRET', reused);
  assert.throws(() => env.context.createPHCEPInvitation(USER, 'CDR'), /distinct/);
  assert.equal(env.book().getSheetByName('PHCEP邀請').getLastRow(), 1);
});

test('valid submissions persist private mapped identities and answers without deriving clinician scores', () => {
  const env = setup();
  const invitation = invite(env);
  const form = env.forms.get(env.properties.get('CDR_FORM_ID'));
  const answers = [
    form.getItemById(Number(env.properties.get('CDR_LINE_ITEM_ID'))).createResponse('spoofed user'),
    form.items.find(item => item.title === '受試者姓名 / 編號').createResponse('=private clinical text')
  ];
  const event = submission(env, 'CDR', invitation.token, 'response-valid', answers);
  assert.equal(env.context.phcepHandleFormSubmit(event).status, 'linked');
  assert.equal(env.context.phcepHandleFormSubmit(event).status, 'linked');
  const records = env.book().getSheetByName('PHCEP表單紀錄');
  assert.equal(records.getLastRow(), 2);
  assert.equal(records.getRange(2, 5).getValue(), USER);
  const stored = JSON.parse(records.getRange(2, 6).getValue());
  assert.equal(stored.length, 1);
  assert.equal(stored[0].answer, '=private clinical text');
  assert.equal(records.getRange(2, 2).getValue(), invitation.nonce);
  assert.equal(env.book().getSheetByName('PHCEP邀請').getRange(2, 6).getValue(), 'response-valid');
  assert.deepEqual(env.book().getSheetByName('PHCEP臨床評分').data[1], ['response-valid', '', '', '', '', '', '', '']);
  assert.equal(env.book().getSheets().find(sheet => sheet.formUrl).data.length, 1);
});

test('edited response quarantines once and preserves original answers and manual scores', () => {
  const env = setup();
  const invitation = invite(env);
  const form = env.forms.get(env.properties.get('CDR_FORM_ID'));
  const item = form.items.find(item => item.title === '受試者姓名 / 編號');
  const original = submission(env, 'CDR', invitation.token, 'edited-response', [
    item.createResponse('original private answer')
  ]);
  assert.equal(env.context.phcepHandleFormSubmit(original).status, 'linked');
  const records = env.book().getSheetByName('PHCEP表單紀錄');
  const clinician = env.book().getSheetByName('PHCEP臨床評分');
  clinician.getRange(2, 2, 1, 7).setValues([[0.5, 1, 2, 0, 0.5, 1, 'manual assessment']]);
  const originalRecords = JSON.stringify(records.data);
  const originalScores = JSON.stringify(clinician.data);
  assert.equal(env.context.phcepHandleFormSubmit(original).status, 'linked');
  const edited = submission(env, 'CDR', invitation.token, 'edited-response', [
    item.createResponse('changed private answer')
  ]);
  assert.equal(env.context.phcepHandleFormSubmit(edited).status, 'quarantined');
  assert.equal(env.context.phcepHandleFormSubmit(edited).status, 'quarantined');
  const quarantine = env.book().getSheetByName('PHCEP隔離');
  assert.equal(quarantine.getLastRow(), 2);
  assert.equal(quarantine.getRange(2, 1).getValue(), 'edited-response');
  assert.equal(quarantine.getRange(2, 2).getValue(), form.id);
  assert.equal(quarantine.getRange(2, 4).getValue(), 'edited-response-review-required');
  for (const privateValue of [invitation.token, USER, 'original private answer', 'changed private answer']) {
    assert.ok(!JSON.stringify(quarantine.data).includes(privateValue));
  }
  assert.equal(JSON.stringify(records.data), originalRecords);
  assert.equal(JSON.stringify(clinician.data), originalScores);
  assert.equal(env.context.phcepHandleFormSubmit(original).status, 'linked');
  assert.equal(JSON.stringify(clinician.data), originalScores);
});

test('tampering, expiry, wrong form, and replay quarantine without patient data', () => {
  const env = setup();
  const invitation = invite(env);
  const tampered = invitation.token.slice(0, -1) + (invitation.token.endsWith('A') ? 'B' : 'A');
  assert.equal(env.context.phcepHandleFormSubmit(submission(env, 'CDR', tampered, 'bad-signature')).status, 'quarantined');
  assert.equal(env.context.phcepHandleFormSubmit(submission(env, 'VITALS', invitation.token, 'wrong-form')).status, 'quarantined');
  assert.equal(env.context.phcepHandleFormSubmit(submission(env, 'CDR', invitation.token, 'first')).status, 'linked');
  assert.equal(env.context.phcepHandleFormSubmit(submission(env, 'CDR', invitation.token, 'replay')).status, 'quarantined');
  const expiredPayload = crypto.randomUUID() + '.' + (Date.now() - 1000);
  const expired = expiredPayload + '.' + env.context.phcepInvitationSignature_(expiredPayload);
  assert.equal(env.context.phcepHandleFormSubmit(submission(env, 'CDR', expired, 'expired')).status, 'quarantined');
  const quarantine = env.book().getSheetByName('PHCEP隔離');
  assert.equal(quarantine.getLastRow(), 5);
  assert.ok(!JSON.stringify(quarantine.data).includes(USER));
  assert.ok(!JSON.stringify(quarantine.data).includes(invitation.token));
  assert.equal(env.book().getSheetByName('PHCEP表單紀錄').getLastRow(), 2);
});

test('partial linked-record failure reserves invitation against a different response and resumes same response', () => {
  const env = setup();
  const invitation = invite(env);
  const records = env.book().getSheetByName('PHCEP表單紀錄');
  const append = records.appendRow;
  records.appendRow = () => { throw new Error('write interrupted'); };
  assert.throws(() => env.context.phcepHandleFormSubmit(submission(env, 'CDR', invitation.token, 'reserved')), /write interrupted/);
  assert.equal(env.book().getSheetByName('PHCEP邀請').getRange(2, 6).getValue(), 'reserved');
  assert.equal(env.context.phcepHandleFormSubmit(submission(env, 'CDR', invitation.token, 'different')).status, 'quarantined');
  records.appendRow = append;
  assert.equal(env.context.phcepHandleFormSubmit(submission(env, 'CDR', invitation.token, 'reserved')).status, 'linked');
  assert.equal(records.getLastRow(), 2);
});

test('operator reconciliation replays actual form response by ID after invitation expires', () => {
  const env = setup();
  const form = env.forms.get(env.properties.get('CDR_FORM_ID'));
  const payload = crypto.randomUUID() + '.' + (Date.now() - 1000);
  const token = payload + '.' + env.context.phcepInvitationSignature_(payload);
  env.book().getSheetByName('PHCEP邀請').appendRow([payload.split('.')[0], USER, 'CDR', form.id, Number(payload.split('.')[1]), '']);
  const event = submission(env, 'CDR', token, 'recoverable');
  const actualSubmissionTime = new Date(Date.now() - 2000);
  event.response.getTimestamp = () => actualSubmissionTime;
  form.getResponses = () => [event.response];
  assert.equal(env.context.reconcilePHCEPFormResponse('CDR', 'recoverable').status, 'linked');
  assert.equal(env.context.reconcilePHCEPFormResponse('CDR', 'recoverable').status, 'linked');
  assert.equal(env.book().getSheetByName('PHCEP表單紀錄').getLastRow(), 2);
  assert.throws(() => env.context.reconcilePHCEPFormResponse('CDR', 'missing'), /not found/);
});

test('empty QA is safe, local fuzzy matches rank relevant QA only, H fills safe draft and I defaults to no send', () => {
  const env = setup();
  const line = env.book().getSheetByName('LINE對話');
  line.appendRow(['message', false, USER, '', '', 'question']);
  assert.equal(env.context.suggestRepliesForUserMessage('question', 2).length, 0);
  const qa = env.book().getSheetByName('QA知識庫');
  qa.appendRow(['qa', '', 'question', '', '', '', '=safe draft']);
  assert.deepEqual(Array.from(env.context.suggestRepliesForUserMessage('question', 2)), ['=safe draft']);
  assert.deepEqual(Array.from(env.context.suggestRepliesForUserMessage('a similar question?', 2)), ['=safe draft']);
  assert.equal(env.context.suggestRepliesForUserMessage('unrelated words', 2).length, 0);
  env.context.suggestRepliesForUserMessage('question', 2);
  line.getRange(2, 8).setValue('=safe draft');
  env.context.phcepHandleEdit({ range: line.getRange(2, 8), triggerUid: env.triggers[0].getUniqueId() });
  assert.equal(line.getRange(2, 9).getValue(), "'=safe draft");
  assert.equal(qa.getRange(2, 14).getValue(), 1);
  assert.equal(qa.getRange(2, 15).getValue(), 1);
  env.context.phcepHandleEdit({ range: line.getRange(2, 9), triggerUid: env.triggers[0].getUniqueId(), user: { getEmail: () => OWNER } });
  assert.equal(env.pushes.length, 0);
  assert.equal(env.context.formatCellDisplayForReply('=HYPERLINK("bad")').isFormula, false);
  assert.equal(typeof env.context.getGeminiEmbedding, 'undefined');
});

test('questionnaire retry persists one invitation and stable send ID, multicell edit never sends', () => {
  const env = setup();
  const line = env.book().getSheetByName('LINE對話');
  line.appendRow(['message', true, USER]);
  env.book().activeRange = line.getRange(2, 2);
  env.setPushFailure(true);
  assert.equal(env.context.sendSelectedQuestionnaire(), false);
  const state = JSON.parse(line.getRange(2, 12).getValue());
  assert.equal(state['questionnaire:CDR'].status, 'RETRY');
  assert.equal(env.book().getSheetByName('PHCEP邀請').getLastRow(), 2);
  env.setPushFailure(false);
  assert.equal(env.context.sendSelectedQuestionnaire(), true);
  assert.equal(env.pushes[0].key, env.pushes[1].key);
  assert.equal(JSON.stringify(env.pushes[0].messages), JSON.stringify(env.pushes[1].messages));
  assert.equal(env.book().getSheetByName('PHCEP邀請').getLastRow(), 2);
  assert.equal(env.context.sendSelectedQuestionnaire(), true);
  assert.equal(env.pushes.length, 2);
  line.getRange(2, 2).setValue(true);
  env.context.phcepHandleEdit({ range: line.getRange(2, 2, 1, 8), triggerUid: env.triggers[0].getUniqueId(), user: { getEmail: () => OWNER } });
  assert.equal(env.pushes.length, 2);
  assert.equal(line.getRange(2, 2).getValue(), false);
  assert.equal(JSON.parse(line.getRange(2, 12).getValue())['questionnaire:CDR'].key, state['questionnaire:CDR'].key);
});

test('explicit menu confirmation gates I send-on-edit and untrusted events cannot send', () => {
  const env = setup();
  const line = env.book().getSheetByName('LINE對話');
  line.appendRow(['message', false, USER, '', '', '', '', '', 'draft']);
  env.ui.answer = 'NO';
  env.context.enableClinicianSendOnEdit();
  assert.equal(env.properties.get('CLINICIAN_SEND_ON_EDIT'), undefined);
  env.ui.answer = 'YES';
  env.context.enableClinicianSendOnEdit();
  env.context.phcepHandleEdit({ range: line.getRange(2, 9), triggerUid: env.triggers[0].getUniqueId(), user: { getEmail: () => 'untrusted@example.org' } });
  assert.equal(env.pushes.length, 0);
  env.context.phcepHandleEdit({ range: line.getRange(2, 9), triggerUid: env.triggers[0].getUniqueId(), user: { getEmail: () => 'clinician@example.org' } });
  assert.equal(env.pushes.length, 1);
  assert.equal(line.getRange(2, 9).getValue(), '');
  assert.equal(line.getRange(2, 10).getValue(), 'draft');
  assert.equal(line.getRange(2, 11).getValue(), '');
  env.context.disableClinicianSendOnEdit();
  assert.equal(env.properties.get('CLINICIAN_SEND_ON_EDIT'), 'false');
});

test('CDR and vitals state are independent and explicit new daily invitation requires confirmation', () => {
  const env = setup();
  const line = env.book().getSheetByName('LINE對話');
  line.appendRow(['message', false, USER]);
  env.book().activeRange = line.getRange(2, 2);
  assert.equal(env.context.sendSelectedQuestionnaire(), true);
  assert.equal(env.context.sendSelectedVitalsQuestionnaire(), true);
  const state = JSON.parse(line.getRange(2, 12).getValue());
  assert.notEqual(state['questionnaire:CDR'].key, state['questionnaire:VITALS'].key);
  env.ui.answer = 'NO';
  env.context.sendNewSelectedVitalsInvitation();
  assert.equal(env.pushes.length, 2);
  env.ui.answer = 'YES';
  env.context.sendNewSelectedVitalsInvitation();
  assert.equal(env.pushes.length, 3);
  assert.notEqual(JSON.parse(line.getRange(2, 12).getValue())['questionnaire:VITALS'].key, state['questionnaire:VITALS'].key);
});

test('network-time clinician draft edits are preserved and row moves relocate by stable Event Key', () => {
  const env = setup();
  const line = env.book().getSheetByName('LINE對話');
  line.appendRow(['message-a', false, USER, '', '', '', '', '', 'sent draft', '', 'event-a']);
  line.appendRow(['message-b', false, 'U' + 'b'.repeat(32), '', '', '', '', '', 'other draft', '', 'event-b']);
  env.book().activeRange = line.getRange(2, 9);
  env.setPushHook(() => {
    line.getRange(2, 9).setValue('new clinician draft');
    [line.data[1], line.data[2]] = [line.data[2], line.data[1]];
  });
  assert.equal(env.context.sendSelectedDraft(), true);
  assert.equal(line.getRange(2, 9).getValue(), 'other draft');
  assert.equal(line.getRange(2, 10).getValue(), '');
  assert.equal(line.getRange(2, 12).getValue(), '');
  assert.equal(line.getRange(3, 9).getValue(), 'new clinician draft');
  assert.equal(line.getRange(3, 10).getValue(), 'sent draft');
  assert.equal(JSON.parse(line.getRange(3, 12).getValue()).reply.status, 'SENT');
});

test('deleted or recipient-mutated row during push never overwrites replacement row', () => {
  const env = setup();
  const line = env.book().getSheetByName('LINE對話');
  line.appendRow(['message-a', false, USER, '', '', '', '', '', 'sent draft', '', 'event-a']);
  env.book().activeRange = line.getRange(2, 9);
  env.setPushHook(() => { line.data[1] = ['replacement', false, 'U' + 'b'.repeat(32), '', '', '', '', '', 'replacement draft']; });
  assert.throws(() => env.context.sendSelectedDraft(), /row moved, removed or changed/);
  assert.equal(line.getRange(2, 9).getValue(), 'replacement draft');
  assert.equal(line.getRange(2, 10).getValue(), '');
  assert.equal(line.getRange(2, 12).getValue(), '');
});

test('expired ambiguous outbox sends require manual review and cannot bypass with a new invitation key', () => {
  const env = setup();
  const line = env.book().getSheetByName('LINE對話');
  line.appendRow(['message', false, USER]);
  env.book().activeRange = line.getRange(2, 2);
  env.setPushResult({ ok: false, error: 'AMBIGUOUS_EXPIRED' });
  assert.equal(env.context.sendSelectedVitalsQuestionnaire(), false);
  const state = JSON.parse(line.getRange(2, 12).getValue());
  assert.equal(state['questionnaire:VITALS'].status, 'MANUAL_REVIEW');
  assert.equal(state['questionnaire:VITALS'].error, 'AMBIGUOUS_EXPIRED');
  state['questionnaire:VITALS'].expiresAt = Date.now() - 1000;
  line.getRange(2, 12).setValue(JSON.stringify(state));
  assert.throws(() => env.context.sendNewSelectedVitalsInvitation(), /Reconcile pending or ambiguous/);
  assert.equal(env.context.sendSelectedVitalsQuestionnaire(), false);
  assert.equal(env.pushes.length, 1);
  assert.equal(env.book().getSheetByName('PHCEP邀請').getLastRow(), 2);
});

test('reply history retains future sends separately and recovers partial append idempotently', () => {
  const env = setup();
  const line = env.book().getSheetByName('LINE對話');
  line.appendRow(['message', false, USER, '', '', '', '', '', 'first draft', 'old latest', 'event']);
  env.book().activeRange = line.getRange(2, 9);
  const history = env.book().getSheetByName('PHCEP回覆歷史');
  const append = history.appendRow;
  history.appendRow = () => { throw new Error('history interrupted'); };
  assert.equal(env.context.sendSelectedDraft(), false);
  assert.equal(line.getRange(2, 9).getValue(), 'first draft');
  history.appendRow = append;
  assert.equal(env.context.sendSelectedDraft(), true);
  assert.equal(history.getLastRow(), 2);
  const firstKey = history.getRange(2, 1).getValue();
  assert.equal(history.getRange(2, 2).getValue(), 'event');
  assert.equal(history.getRange(2, 4).getValue(), 'first draft');
  line.getRange(2, 9).setValue('second draft');
  assert.equal(env.context.sendSelectedDraft(), true);
  assert.equal(history.getLastRow(), 3);
  assert.notEqual(history.getRange(3, 1).getValue(), firstKey);
  assert.equal(line.getRange(2, 10).getValue(), 'second draft');
  assert.equal(line.getRange(2, 11).getValue(), 'event');
  assert.equal(history.protections[0].warning, false);
});

test('complete supplied Traditional Chinese question builders retain titles choices grids and requirements', () => {
  const env = setup();
  for (const [source, functionName, type] of [
    ['FormManager.gs.txt', 'createFullCDRFormTraditionalChinese', 'CDR'],
    ['UIUtils.gs.txt', 'createPatientVitalsTrackerForm', 'VITALS']
  ]) {
    let captured;
    const reference = vm.createContext({
      FormApp: { create: title => { captured = env.context.FormApp.create(title); return captured; } },
      SpreadsheetApp: { getActiveSpreadsheet: () => { throw new Error('stop after question builder'); } }
    });
    vm.runInContext(fs.readFileSync(path.join(root, source), 'utf8'), reference);
    assert.throws(() => reference[functionName](), /stop after question builder/);
    const actual = env.forms.get(env.properties.get(type + '_FORM_ID'));
    const shape = items => JSON.parse(JSON.stringify(items.filter(item => item.title !== 'LINE ID 編號' && item.title !== 'PHCEP 邀請碼')
      .map(item => ({ type: item.type, title: item.title, choices: item.choices,
        gridRows: item.gridRows, gridColumns: item.gridColumns, required: item.required }))));
    assert.deepEqual(shape(actual.items), shape(captured.items));
  }
});

const COL = { action: 13, confirm: 14, source: 15, importance: 16, collect: 17, mediaName: 18, status: 19, history: 20 };
const editAs = (env, range, email = OWNER) => env.context.phcepHandleEdit({
  range, triggerUid: env.triggers.find(t => t.getHandlerFunction() === 'phcepHandleEdit').getUniqueId(),
  user: email ? { getEmail: () => email } : undefined
});

test('layout migration is idempotent, places grouped controls right after L, shifts legacy data and preserves K/L', () => {
  const env = environment({ columns: 14 });
  const line = env.active.insertSheet('LINE對話');
  const headers = ['Message ID', '發送問卷 (勾選)', 'User ID', 'DateTime', 'User Name', '訊息 (病患問題)',
    '檔案/媒體連結', '建議回覆選單', '回覆草稿 (可編輯)', '回覆紀錄 (最新)', 'Event Key', '操作狀態'];
  line.appendRow(headers);
  const state = JSON.stringify({ reply: { key: 'clinician:x', status: 'SENT' } });
  line.appendRow(['id', false, USER, '', '', 'question', '', '', '', 'latest', 'event-key', state, 'legacy shifted reply']);
  env.context.setupPHCEP();
  const book = env.book();
  assert.deepEqual(book.getSheets().slice(0, 3).map(sheet => sheet.name), ['總覽', 'LINE對話', 'QA知識庫']);
  assert.equal(line.getRange(2, 11).getValue(), 'event-key');
  assert.equal(line.getRange(2, 12).getValue(), state);
  assert.equal(line.getRange(1, 13).getValue(), '操作動作');
  const layout = env.context.phcepLineLayout_(line);
  assert.equal(layout.start, 13);
  assert.equal(line.getRange(2, layout.end + 1).getValue(), 'legacy shifted reply');
  assert.deepEqual(Array.from(line.hidden), [11, 12, 13, 15]);
  const snapshot = JSON.stringify(line.data);
  const columns = line.columns;
  const result = env.context.setupPHCEP();
  assert.equal(result.migration.lineColumnsAdded, 0);
  assert.equal(JSON.stringify(line.data), snapshot);
  assert.equal(line.columns, columns);
  assert.equal(env.context.migratePHCEPLayout().lineColumnsAdded, 0);
  assert.equal(JSON.stringify(line.data), snapshot);
  assert.ok(book.getSheetByName('收錄集合'));
  line.getRange(1, 14).setValue('');
  line.getRange(1, 13).setValue('');
  assert.throws(() => env.context.migratePHCEPLayout(), /incomplete or moved/);
});

test('unmanaged 總覽 sheet is never overwritten', () => {
  const env = environment();
  env.active.insertSheet('總覽').appendRow(['private operator notes']);
  assert.throws(() => env.context.setupPHCEP(), /not PHCEP-managed/);
  assert.equal(env.active.getSheetByName('總覽').getRange(1, 1).getValue(), 'private operator notes');
});

test('overview links key sheets and shows safe counters only', () => {
  const env = setup();
  const book = env.book();
  book.getSheetByName('PHCEP寄件匣').appendRow(['k', 'r', 'FAILED', USER, '[{"text":"private"}]', '', '', '']);
  book.getSheetByName('PHCEP隔離').appendRow(['resp', 'form', '', 'reason']);
  book.getSheetByName('收錄集合').appendRow(['key', '待審核', 'private question']);
  const overview = book.getSheetByName('總覽');
  overview.getRange(1, 3).setValue(true);
  editAs(env, overview.getRange(1, 3));
  assert.equal(overview.getRange(1, 3).getValue(), false);
  const serialized = JSON.stringify(overview.data);
  for (const name of ['LINE對話', 'QA知識庫', '收錄集合', 'PHCEP事件', 'PHCEP請求', 'PHCEP寄件匣', 'PHCEP邀請',
    'PHCEP表單紀錄', 'PHCEP隔離', 'PHCEP臨床評分', 'PHCEP回覆歷史']) {
    const cell = overview.data.find(row => row[0] && row[0].text === name);
    assert.ok(cell, name);
    assert.match(cell[0].url, /^#gid=\d+$/);
  }
  const counter = label => overview.data.find(row => row[0] === label)[1];
  assert.equal(counter('寄件匣待處理/失敗'), 1);
  assert.equal(counter('表單隔離紀錄'), 1);
  assert.equal(counter('收錄待審核'), 1);
  assert.ok(overview.data[1][1] instanceof Date);
  for (const secret of [USER, 'private', env.properties.get('GATEWAY_SIGNING_SECRET')]) assert.ok(!serialized.includes(secret));
});

test('send checkbox always sends the draft with verified identity and preserves legacy controls', () => {
  const env = setup();
  const line = env.book().getSheetByName('LINE對話');
  line.appendRow(['message', false, USER, '', '', 'question', '', '', 'first reply', 'legacy latest', 'event-1']);
  const headers = JSON.stringify(line.data[0]);
  line.getRange(2, COL.action).setValue('發送草稿');
  editAs(env, line.getRange(2, COL.action));
  assert.equal(env.pushes.length, 0);
  assert.match(line.getRange(2, COL.status).getValue(), /確認執行/);
  line.getRange(2, COL.confirm).setValue(true);
  editAs(env, line.getRange(2, COL.confirm), null);
  assert.equal(env.pushes.length, 0);
  assert.equal(line.getRange(2, COL.confirm).getValue(), false);
  line.getRange(2, COL.action).setValue('發送草稿');
  line.getRange(2, COL.confirm).setValue(true);
  editAs(env, line.getRange(2, COL.confirm), 'untrusted@example.org');
  assert.equal(env.pushes.length, 0);
  line.getRange(2, COL.action).setValue('發送草稿');
  line.getRange(2, COL.confirm).setValue(true);
  editAs(env, line.getRange(2, COL.confirm));
  assert.equal(env.pushes.length, 1);
  assert.equal(line.getRange(2, 10).getValue(), 'first reply');
  assert.equal(line.getRange(2, 9).getValue(), '');
  assert.equal(line.getRange(2, COL.action).getValue(), '發送草稿');
  assert.equal(line.getRange(2, COL.confirm).getValue(), false);
  assert.match(line.getRange(2, COL.status).getValue(), /✅/);
  assert.equal(line.getRange(2, COL.history).getValue(), 'legacy latest');
  line.getRange(2, 9).setValue('second reply');
  line.getRange(2, COL.action).setValue('發送草稿');
  line.getRange(2, COL.confirm).setValue(true);
  editAs(env, line.getRange(2, COL.confirm));
  assert.equal(env.pushes.length, 2);
  assert.equal(line.getRange(2, 10).getValue(), 'second reply');
  assert.deepEqual(line.getRange(2, COL.history, 1, 3).getValues()[0], ['first reply', 'legacy latest', '']);
  assert.equal(line.getRange(2, 11).getValue(), 'event-1');
  assert.equal(JSON.parse(line.getRange(2, 12).getValue()).reply.status, 'SENT');
  assert.equal(JSON.stringify(line.data[0]), headers);
  assert.equal(env.book().getSheetByName('PHCEP回覆歷史').getLastRow(), 3);
});

test('draft confirmation shows safe LINE failure and retries the unchanged operation', () => {
  const env = setup();
  const line = env.book().getSheetByName('LINE對話');
  line.appendRow(['message', false, USER, '', '', 'question', '', '', 'draft', 'previous reply', 'event-1']);
  env.setPushResult({ ok: false, error: 'LINE_HTTP_401' });
  const confirm = () => {
    line.getRange(2, COL.action).setValue('發送草稿');
    editAs(env, line.getRange(2, COL.action));
    line.getRange(2, COL.confirm).setValue(true);
    editAs(env, line.getRange(2, COL.confirm));
  };
  confirm();
  assert.match(line.getRange(2, COL.status).getValue(), /LINE_HTTP_401/);
  assert.equal(line.getRange(2, 9).getValue(), 'draft');
  assert.equal(line.getRange(2, 10).getValue(), 'previous reply');
  assert.equal(line.getRange(2, COL.confirm).getValue(), false);
  assert.equal(line.getRange(2, COL.action).getValue(), '發送草稿');
  let operation = JSON.parse(line.getRange(2, 12).getValue()).reply;
  assert.equal(operation.status, 'RETRY');
  assert.equal(operation.error, 'LINE_HTTP_401');
  env.setPushResult({ ok: true });
  confirm();
  assert.equal(env.pushes[0].key, env.pushes[1].key);
  operation = JSON.parse(line.getRange(2, 12).getValue()).reply;
  assert.equal(operation.status, 'SENT');
  assert.equal(operation.error, undefined);
  assert.equal(line.getRange(2, 9).getValue(), '');
  assert.equal(line.getRange(2, 10).getValue(), 'draft');
  assert.match(line.getRange(2, COL.status).getValue(), /✅/);
});

test('legacy actions are inert and rectangular pastes never send; confirm always means draft', () => {
  const env = setup();
  const line = env.book().getSheetByName('LINE對話');
  line.appendRow(['message', false, USER, '', '', '', '', '', 'draft', '', 'event-1']);
  line.getRange(2, COL.action).setValue('發送每日健康邀請');
  editAs(env, line.getRange(2, COL.action));
  line.getRange(2, COL.confirm).setValue(true);
  editAs(env, line.getRange(2, COL.action, 1, 2));
  assert.equal(env.pushes.length, 0);
  assert.equal(line.getRange(2, COL.confirm).getValue(), false);
  assert.equal(line.getRange(2, COL.action).getValue(), '發送每日健康邀請');
  line.getRange(2, COL.confirm).setValue(true);
  editAs(env, line.getRange(2, COL.confirm));
  assert.equal(env.pushes.length, 1);
  assert.equal(env.pushes[0].messages[0].text, 'draft');
  assert.equal(JSON.parse(line.getRange(2, 12).getValue())['questionnaire:VITALS'], undefined);
  line.getRange(2, COL.action).setValue('建立新每日健康邀請');
  line.getRange(2, COL.confirm).setValue(true);
  editAs(env, line.getRange(2, COL.confirm));
  assert.equal(env.pushes.length, 1);
  assert.match(line.getRange(2, COL.status).getValue(), /草稿為空/);
});

test('layout migration repairs only the edit trigger and makes controls operational without setup', () => {
  const env = setup();
  const book = env.book();
  const formTriggers = env.triggers.filter(t => t.getHandlerFunction() === 'phcepHandleFormSubmit');
  const formIds = [...env.forms.keys()];
  env.triggers.splice(0, env.triggers.length, ...formTriggers);
  const report = env.context.migratePHCEPLayout();
  assert.equal(report.editTrigger, 'ready');
  const editTrigger = env.triggers.find(t => t.getHandlerFunction() === 'phcepHandleEdit');
  assert.equal(editTrigger.getTriggerSourceId(), book.getId());
  env.triggers.push(editTrigger);
  env.context.migratePHCEPLayout();
  assert.equal(env.triggers.filter(t => t.getHandlerFunction() === 'phcepHandleEdit').length, 1);
  assert.deepEqual(env.triggers.filter(t => t.getHandlerFunction() === 'phcepHandleFormSubmit'), formTriggers);
  assert.deepEqual([...env.forms.keys()], formIds);
  const line = book.getSheetByName('LINE對話');
  line.appendRow(['message', false, USER, '', '', 'question', '', '', 'draft', '', 'event-1']);
  line.getRange(2, COL.source).setValue('草稿 (未發送)');
  editAs(env, line.getRange(2, COL.source));
  assert.match(line.getRange(2, COL.status).getValue(), /全部內容.*勾選「收錄」/);
  assert.equal(book.getSheetByName('收錄集合').getLastRow(), 1);
  line.getRange(2, COL.importance).setValue('5');
  editAs(env, line.getRange(2, COL.importance));
  line.getRange(2, COL.collect).setValue(true);
  editAs(env, line.getRange(2, COL.collect));
  assert.equal(line.getRange(2, COL.collect).getValue(), false);
  assert.equal(book.getSheetByName('收錄集合').getRange(2, 7).getValue(), 5);
  line.getRange(2, COL.action).setValue('發送草稿');
  editAs(env, line.getRange(2, COL.action));
  assert.equal(env.pushes.length, 0);
  line.getRange(2, COL.confirm).setValue(true);
  editAs(env, line.getRange(2, COL.confirm));
  assert.equal(line.getRange(2, COL.confirm).getValue(), false);
  assert.equal(env.pushes.length, 1);
});

test('collection workflow captures provenance, deduplicates, validates importance and publishes only after approval', () => {
  const env = setup();
  const book = env.book();
  const line = book.getSheetByName('LINE對話');
  const qa = book.getSheetByName('QA知識庫');
  line.appendRow(['message-1', false, USER, '', '', '如何預約門診', '', '', 'unsent draft', '', 'event-1']);
  line.getRange(2, COL.source).setValue('草稿 (未發送)');
  line.getRange(2, COL.importance).setValue('7');
  editAs(env, line.getRange(2, COL.importance));
  assert.equal(line.getRange(2, COL.importance).getValue(), '');
  assert.match(line.getRange(2, COL.status).getValue(), /1-5/);
  line.getRange(2, COL.importance).setValue('4');
  editAs(env, line.getRange(2, COL.importance));
  assert.equal(line.getRange(2, COL.importance).getValue(), 4);
  line.getRange(2, COL.collect).setValue(true);
  editAs(env, line.getRange(2, COL.collect), null);
  assert.equal(book.getSheetByName('收錄集合').getLastRow(), 1);
  line.getRange(2, COL.collect).setValue(true);
  editAs(env, line.getRange(2, COL.collect));
  assert.equal(line.getRange(2, COL.collect).getValue(), false);
  const collections = book.getSheetByName('收錄集合');
  assert.equal(collections.getLastRow(), 2);
  const record = collections.data[1];
  assert.equal(record[1], '待審核');
  assert.equal(record[2], '如何預約門診');
  assert.equal(record[3], 'unsent draft');
  assert.equal(record[5], '未發送 (草稿)');
  assert.equal(record[6], 4);
  assert.equal(record[7], 'event-1');
  assert.equal(record[8], 'message-1');
  assert.equal(record[9], 'LINE對話!2');
  assert.equal(record[11], OWNER);
  assert.ok(!JSON.stringify(collections.data).includes(USER));
  assert.match(line.getRange(2, COL.status).getValue(), /待審核/);
  line.getRange(2, COL.action).setValue('收錄');
  editAs(env, line.getRange(2, COL.action));
  assert.equal(line.getRange(2, COL.action).getValue(), '收錄');
  line.getRange(2, COL.collect).setValue(true);
  editAs(env, line.getRange(2, COL.collect));
  assert.equal(collections.getLastRow(), 2);
  assert.match(line.getRange(2, COL.status).getValue(), /已存在/);
  assert.equal(line.getRange(2, COL.action).getValue(), '收錄');
  assert.equal(qa.getLastRow(), 1);
  assert.equal(env.pushes.length, 0);
  collections.getRange(2, 2).setValue('核准');
  editAs(env, collections.getRange(2, 2), 'untrusted@example.org');
  assert.equal(collections.getRange(2, 2).getValue(), '待審核');
  assert.equal(qa.getLastRow(), 1);
  collections.getRange(2, 2).setValue('核准');
  editAs(env, collections.getRange(2, 2));
  assert.equal(collections.getRange(2, 2).getValue(), '已發布');
  assert.equal(qa.getLastRow(), 2);
  assert.equal(qa.getRange(2, 2).getValue(), 4);
  assert.equal(qa.getRange(2, 3).getValue(), '如何預約門診');
  assert.equal(qa.getRange(2, 7).getValue(), 'unsent draft');
  assert.equal(env.context.publishApprovedCollections().published, 0);
  assert.equal(qa.getLastRow(), 2);
  line.getRange(2, COL.action).setValue('重新整理建議');
  editAs(env, line.getRange(2, COL.action));
  assert.equal(line.getRange(2, COL.action).getValue(), '重新整理建議');
  assert.match(line.getRange(2, COL.status).getValue(), /不需選擇操作/);
  assert.equal(env.pushes.length, 0);
});

test('multi-row checkbox edits send drafts or collect without selecting legacy actions', () => {
  const env = setup();
  const line = env.book().getSheetByName('LINE對話');
  line.appendRow(['bad', false, 'invalid-recipient', '', '', 'question', '', '', 'bad draft', '', 'bad-event']);
  line.appendRow(['m1', false, USER, '', '', 'same question', '', '', 'draft one', '', 'e1']);
  line.appendRow(['m2', false, USER, '', '', 'same question', '', '', 'draft two', '', 'e2']);
  line.getRange(2, COL.confirm, 3, 1).setValues([[true], [true], [true]]);
  editAs(env, line.getRange(2, COL.confirm, 3, 1));
  assert.equal(env.pushes.length, 2);
  assert.match(line.getRange(2, COL.status).getValue(), /未發送/);
  assert.equal(line.getRange(3, 10).getValue(), 'draft one');
  assert.equal(line.getRange(4, 10).getValue(), 'draft two');
  assert.deepEqual(line.getRange(2, COL.confirm, 3, 1).getValues(), [[false], [false], [false]]);
  line.getRange(3, COL.confirm, 2, 1).setValues([[true], [true]]);
  editAs(env, line.getRange(3, COL.confirm, 2, 1));
  assert.equal(env.pushes.length, 2);
  line.getRange(3, COL.collect, 2, 1).setValues([[true], [true]]);
  editAs(env, line.getRange(3, COL.collect, 2, 1));
  const collections = env.book().getSheetByName('收錄集合');
  assert.equal(collections.getLastRow(), 3);
  assert.notEqual(collections.getRange(2, 1).getValue(), collections.getRange(3, 1).getValue());
  assert.equal(collections.getRange(2, 4).getValue(), 'draft one');
  assert.equal(collections.getRange(3, 4).getValue(), 'draft two');
  assert.equal(env.pushes.length, 2);
});

test('bulk collection works without any reply and unauthorized bulk sends never execute', () => {
  const env = setup();
  const line = env.book().getSheetByName('LINE對話');
  line.appendRow(['m1', false, USER, '', '', 'question one', '', '', '', '', 'e1']);
  line.appendRow(['m2', false, USER, '', '', 'question one', '', '', '', '', 'e2']);
  line.getRange(2, COL.collect, 2, 1).setValues([[true], [true]]);
  editAs(env, line.getRange(2, COL.collect, 2, 1));
  const collections = env.book().getSheetByName('收錄集合');
  assert.equal(collections.getLastRow(), 3);
  assert.deepEqual(collections.getRange(2, 4, 2, 1).getValues(), [[''], ['']]);
  assert.match(line.getRange(2, COL.status).getValue(), /尚無回覆也已收錄/);
  line.getRange(2, 9, 2, 1).setValues([['draft one'], ['draft two']]);
  line.getRange(2, COL.confirm, 2, 1).setValues([[true], [true]]);
  editAs(env, line.getRange(2, COL.confirm, 2, 1), 'untrusted@example.org');
  assert.equal(env.pushes.length, 0);
  assert.deepEqual(line.getRange(2, COL.confirm, 2, 1).getValues(), [[false], [false]]);
});

test('collected conversation updates automatically and revises the same QA only after reapproval', () => {
  const env = setup();
  const book = env.book();
  const line = book.getSheetByName('LINE對話');
  const collections = book.getSheetByName('收錄集合');
  const qa = book.getSheetByName('QA知識庫');
  line.appendRow(['m1', false, USER, '', '', 'question', '', '', '', '', 'e1']);
  line.getRange(2, COL.collect).setValue(true);
  editAs(env, line.getRange(2, COL.collect));
  const key = collections.getRange(2, 1).getValue();
  line.getRange(2, 9).setValue('first reply');
  editAs(env, line.getRange(2, 9));
  assert.equal(collections.getRange(2, 4).getValue(), 'first reply');
  line.getRange(2, COL.confirm).setValue(true);
  editAs(env, line.getRange(2, COL.confirm));
  assert.equal(collections.getRange(2, 6).getValue(), '已發送');
  collections.getRange(2, 2).setValue('核准');
  editAs(env, collections.getRange(2, 2));
  const qaId = collections.getRange(2, 14).getValue();
  assert.equal(qa.getRange(2, 7).getValue(), 'first reply');
  line.getRange(2, 9).setValue('second reply');
  editAs(env, line.getRange(2, 9));
  assert.equal(collections.getRange(2, 2).getValue(), '待審核');
  assert.equal(qa.getRange(2, 7).getValue(), 'first reply');
  line.getRange(2, COL.confirm).setValue(true);
  editAs(env, line.getRange(2, COL.confirm));
  assert.equal(collections.getLastRow(), 2);
  assert.equal(collections.getRange(2, 1).getValue(), key);
  assert.equal(collections.getRange(2, 14).getValue(), qaId);
  assert.match(collections.getRange(2, 4).getValue(), /最新回覆.*\nsecond reply/);
  assert.match(collections.getRange(2, 4).getValue(), /first reply/);
  assert.equal(qa.getRange(2, 7).getValue(), 'first reply');
  collections.getRange(2, 2).setValue('核准');
  editAs(env, collections.getRange(2, 2));
  assert.equal(qa.getLastRow(), 2);
  assert.equal(qa.getRange(2, 1).getValue(), qaId);
  assert.match(qa.getRange(2, 7).getValue(), /second reply/);
  assert.equal(collections.getRange(2, 2).getValue(), '已發布');
});

test('media collection links column C and includes draft, latest reply and archived history', () => {
  const env = setup();
  const book = env.book();
  const line = book.getSheetByName('LINE對話');
  const url = 'https://drive.google.com/file/d/managedFile123/view';
  const link = env.context.SpreadsheetApp.newRichTextValue().setText('檢視檔案').setLinkUrl(url).build();
  line.appendRow(['m1', false, USER, '', '', '圖片', link, '', '', '', 'e1']);
  line.getRange(2, COL.collect).setValue(true);
  editAs(env, line.getRange(2, COL.collect));
  const collections = book.getSheetByName('收錄集合');
  const question = collections.getRange(2, 3).getRichTextValue();
  assert.equal(question.getLinkUrl(), url);
  assert.equal(question.getText(), '圖片\n' + url);
  assert.equal(collections.getRange(2, 4).getValue(), '');
  line.getRange(2, 9).setValue('unsent');
  line.getRange(2, 10).setValue('latest');
  line.getRange(2, COL.history).setValue('previous');
  book.getSheetByName('PHCEP回覆歷史').appendRow(['op', 'e1', new Date(), 'older than five replies']);
  editAs(env, line.getRange(2, 9));
  const reply = collections.getRange(2, 4).getValue();
  for (const text of ['unsent', 'latest', 'previous', 'older than five replies']) assert.ok(reply.includes(text));
  collections.getRange(2, 2).setValue('核准');
  editAs(env, collections.getRange(2, 2));
  assert.equal(book.getSheetByName('QA知識庫').getRange(2, 8).getValue(), url);
});

test('migration refreshes legacy collection entries by message identity without replacing their key or QA ID', () => {
  const env = setup();
  const line = env.book().getSheetByName('LINE對話');
  const collections = env.book().getSheetByName('收錄集合');
  line.appendRow(['m1', false, USER, '', '', 'new question', '', '', '', 'later reply', 'e1']);
  collections.appendRow(['legacy-key', '已發布', 'old question', 'old reply', '最新回覆', '已發送', '', 'e1', 'm1',
    'LINE對話!50', new Date(), OWNER, '', 'legacy-qa-id']);
  const result = env.context.migratePHCEPLayout();
  assert.equal(result.collections.failed, 0);
  assert.equal(collections.getLastRow(), 2);
  assert.equal(collections.getRange(2, 1).getValue(), 'legacy-key');
  assert.equal(collections.getRange(2, 14).getValue(), 'legacy-qa-id');
  assert.equal(collections.getRange(2, 4).getValue(), 'later reply');
  assert.equal(collections.getRange(2, 2).getValue(), '待審核');
  assert.equal(collections.getRange(2, 10).getValue(), 'LINE對話!2');
});

test('a collection sync failure after delivery never marks the sent reply for resend', () => {
  const env = setup();
  const line = env.book().getSheetByName('LINE對話');
  line.appendRow(['m1', false, USER, '', '', 'question', '', '', 'draft', '', 'e1']);
  env.book().getSheetByName('收錄集合').getLastRow = () => { throw new Error('private storage failure'); };
  line.getRange(2, COL.confirm).setValue(true);
  editAs(env, line.getRange(2, COL.confirm));
  assert.equal(env.pushes.length, 1);
  assert.equal(JSON.parse(line.getRange(2, 12).getValue()).reply.status, 'SENT');
  assert.equal(line.getRange(2, 9).getValue(), '');
  assert.equal(line.getRange(2, 10).getValue(), 'draft');
  assert.match(line.getRange(2, COL.status).getValue(), /草稿已發送.*收錄同步失敗/);
});

test('edit handling waits for the lock and explicitly resets checkboxes if still busy', () => {
  const env = setup();
  const line = env.book().getSheetByName('LINE對話');
  line.appendRow(['m1', false, USER, '', '', 'question', '', '', 'draft', '', 'e1']);
  line.getRange(2, COL.confirm).setValue(true);
  env.context.phcepWithLock_ = (fn, waitMs) => {
    assert.equal(waitMs, 20000);
    const error = new Error('BUSY');
    error.phcepCode = 'BUSY';
    throw error;
  };
  editAs(env, line.getRange(2, COL.confirm));
  assert.equal(env.pushes.length, 0);
  assert.equal(line.getRange(2, COL.confirm).getValue(), false);
  assert.match(line.getRange(2, COL.status).getValue(), /系統忙碌.*重新勾選/);
});

test('duplicate source identities fail per row without blocking other batch sends', () => {
  const env = setup();
  const line = env.book().getSheetByName('LINE對話');
  line.appendRow(['duplicate', false, USER, '', '', 'question', '', '', 'draft one', '', 'duplicate-event']);
  line.appendRow(['duplicate', false, USER, '', '', 'question', '', '', 'draft two', '', 'duplicate-event']);
  line.appendRow(['unique', false, USER, '', '', 'question', '', '', 'draft three', '', 'unique-event']);
  line.getRange(2, COL.confirm, 3, 1).setValues([[true], [true], [true]]);
  editAs(env, line.getRange(2, COL.confirm, 3, 1));
  assert.equal(env.pushes.length, 1);
  assert.equal(env.pushes[0].messages[0].text, 'draft three');
  assert.deepEqual(line.getRange(2, COL.confirm, 3, 1).getValues(), [[false], [false], [false]]);
  assert.match(line.getRange(2, COL.status).getValue(), /識別缺漏或重複/);
});

test('long batches stop safely before the runtime limit and report unsent rows', () => {
  const env = setup();
  const line = env.book().getSheetByName('LINE對話');
  let now = Date.now();
  env.context.Date = class extends Date { static now() { return now; } };
  line.appendRow(['m1', false, USER, '', '', 'question', '', '', 'first draft', '', 'e1']);
  line.appendRow(['m2', false, USER, '', '', 'question', '', '', 'later draft', '', 'e2']);
  env.setPushHook(() => { now += 240001; });
  line.getRange(2, COL.confirm, 2, 1).setValues([[true], [true]]);
  editAs(env, line.getRange(2, COL.confirm, 2, 1));
  assert.equal(env.pushes.length, 1);
  assert.equal(line.getRange(3, 9).getValue(), 'later draft');
  assert.equal(line.getRange(3, COL.confirm).getValue(), false);
  assert.match(line.getRange(3, COL.status).getValue(), /時間上限.*未執行/);
});

test('media rename from LINE or QA updates only private managed Drive files and all linked labels', () => {
  const env = setup();
  const line = env.book().getSheetByName('LINE對話');
  const folderId = env.properties.get('IMAGE_FOLDER_ID');
  const files = new Map();
  const makeFile = (id, parent, access = 'PRIVATE') => {
    const file = { name: 'LINE_original', getParents: () => {
      let done = false;
      return { hasNext: () => !done, next: () => { done = true; return { getId: () => parent }; } };
    }, getSharingAccess: () => access, setName(name) { this.name = name; return this; } };
    files.set(id, file);
    return file;
  };
  env.context.DriveApp.getFileById = id => { if (!files.has(id)) throw new Error('missing'); return files.get(id); };
  const managed = makeFile('managedFile123', folderId);
  const outside = makeFile('outsideFile123', 'other-folder');
  const shared = makeFile('sharedFile1234', folderId, 'ANYONE_WITH_LINK');
  const link = id => env.context.SpreadsheetApp.newRichTextValue().setText('檢視檔案')
    .setLinkUrl('https://drive.google.com/file/d/' + id + '/view').build();
  line.appendRow(['m1', false, USER, '', '', '圖片', link('managedFile123'), '', '', '', 'e1']);
  line.appendRow(['m2', false, USER, '', '', '圖片', link('outsideFile123'), '', '', '', 'e2']);
  line.appendRow(['m3', false, USER, '', '', '圖片', link('sharedFile1234'), '', '', '', 'e3']);
  for (const row of [2, 3, 4]) {
    line.getRange(row, COL.mediaName).setValue('復健/照片:1');
    editAs(env, line.getRange(row, COL.mediaName));
  }
  assert.equal(managed.name, '復健照片1');
  assert.equal(line.getRange(2, 7).getValue().text, '復健照片1');
  assert.equal(line.getRange(2, 7).getValue().url, 'https://drive.google.com/file/d/managedFile123/view');
  assert.equal(outside.name, 'LINE_original');
  assert.equal(shared.name, 'LINE_original');
  assert.match(line.getRange(3, COL.status).getValue(), /❌/);
  assert.match(line.getRange(4, COL.status).getValue(), /私人/);
  const qa = env.book().getSheetByName('QA知識庫');
  qa.appendRow(['qa-id', '', 'question', '', '', '', '', 'https://drive.google.com/file/d/managedFile123/view']);
  qa.getRange(2, 6).setValue('new file name');
  editAs(env, qa.getRange(2, 6));
  assert.equal(managed.name, 'new file name');
  assert.equal(qa.getRange(2, 8).getRichTextValue().getText(), 'new file name');
  assert.equal(qa.getRange(2, 9).getValue(), 'new file name');
  assert.equal(line.getRange(2, 7).getRichTextValue().getText(), 'new file name');
  assert.equal(line.getRange(2, COL.mediaName).getValue(), 'new file name');
  assert.match(qa.notes.get('2:6'), /✅/);
  qa.getRange(2, 6).setValue('unauthorized name');
  editAs(env, qa.getRange(2, 6), 'untrusted@example.org');
  assert.equal(managed.name, 'new file name');
  assert.match(qa.notes.get('2:6'), /❌/);
  line.getRange(2, COL.mediaName).setValue('renamed from line');
  editAs(env, line.getRange(2, COL.mediaName));
  assert.equal(managed.name, 'renamed from line');
  assert.equal(qa.getRange(2, 6).getValue(), 'renamed from line');
  assert.equal(qa.getRange(2, 8).getRichTextValue().getText(), 'renamed from line');
  qa.getRange(2, 8).setValue('https://example.org/not-a-drive-file');
  qa.getRange(2, 6).setValue('must not rename anything');
  editAs(env, qa.getRange(2, 6));
  assert.equal(managed.name, 'renamed from line');
  assert.match(qa.notes.get('2:6'), /沒有系統管理/);
});

const MANUAL_TARGET = '12ksl5GvgM_YVc1NjrPE9LRe_YvUgqttLl0R41z5dazo';
const manualRequest = apply => ({ targetSpreadsheetId: MANUAL_TARGET, apply });
const plain = value => JSON.parse(JSON.stringify(value));

function manualEnvironment(existing = false) {
  const options = { columns: 26, properties: { SPREADSHEET_ID: MANUAL_TARGET } };
  const env = existing ? setup(options) : environment(options);
  if (!existing) {
    const headers = vm.runInContext('PHCEP_SCHEMAS_["LINE對話"]', env.context);
    env.book().insertSheet('LINE對話').appendRow(headers);
  }
  return env;
}

// Tripwires cover all mutation methods on the actual mock prototypes, including
// objects created during migration, rather than comparing only final values.
function monitorManual(env, readonly = false) {
  const calls = { writes: [], locks: 0, releases: 0, migrations: 0 };
  let held = false;
  const book = env.book();
  const line = book.getSheetByName('LINE對話') || book.getSheetByName('工作表1');
  const sampleRange = line.getRange(1, 1);
  for (const object of [book, line, sampleRange, ...line.protections, ...env.forms.values()]) {
    const prototype = Object.getPrototypeOf(object);
    for (const name of Object.getOwnPropertyNames(prototype)) {
      if (!/^(set|insert|hide|append|protect$|move|clear|add|remove)/.test(name)) continue;
      const original = prototype[name];
      prototype[name] = function(...args) {
        calls.writes.push(name);
        assert.equal(readonly, false, 'readonly mutation: ' + name);
        assert.equal(held, true, 'migration write without script lock: ' + name);
        return original.apply(this, args);
      };
    }
  }
  const properties = env.context.PropertiesService.getScriptProperties;
  env.context.PropertiesService.getScriptProperties = () => ({
    ...properties(),
    setProperty() { assert.fail('manual entrypoint must not write properties'); }
  });
  for (const name of ['DriveApp', 'ScriptApp', 'UrlFetchApp']) {
    env.context[name] = new Proxy({}, { get() { assert.fail('unexpected external service: ' + name); } });
  }
  const openForm = env.context.FormApp.openById;
  env.context.FormApp = new Proxy({}, { get(target, name) {
    if (name === 'openById') return openForm;
    assert.fail('manual inventory permits only configured FormApp.openById reads');
  } });
  env.context.setupPHCEP = () => assert.fail('manual entrypoint must never run setup');
  env.context.LockService = { getScriptLock() {
    assert.equal(readonly, false, 'preview must not acquire a lock');
    return {
      tryLock(timeout) { assert.equal(timeout, 30000); calls.locks++; held = true; return true; },
      releaseLock() { assert.equal(held, true); calls.releases++; held = false; }
    };
  } };
  const migrate = env.context.phcepMigrateLayout_;
  env.context.phcepMigrateLayout_ = (...args) => {
    calls.migrations++;
    assert.equal(held, true);
    return migrate(...args);
  };
  return calls;
}

function assertManualProtocol(result) {
  assert.deepEqual(Object.keys(result).sort(), ['after', 'before', 'blocker', 'changes', 'status']);
  assert.ok(['ok', 'blocked', 'failed'].includes(result.status));
  assert.ok([null, 'INVALID_REQUEST', 'TARGET_MISMATCH', 'CONFIGURATION_MISMATCH', 'UNAUTHORIZED',
    'LOCK_UNAVAILABLE', 'READ_FAILED', 'MIGRATION_FAILED', 'SCHEMA_CONFLICT',
    'UNMANAGED_OVERVIEW', 'UNSUPPORTED_LINE_LAYOUT'].includes(result.blocker));
  const names = ['LINE對話', 'QA知識庫', 'PHCEP事件', 'PHCEP請求', 'PHCEP寄件匣', 'PHCEP邀請',
    'PHCEP表單紀錄', 'PHCEP隔離', 'PHCEP回覆歷史', 'PHCEP臨床評分', '收錄集合', '總覽'];
  for (const inventory of [result.before, result.after]) {
    if (!inventory) continue;
    assert.deepEqual(Object.keys(inventory).sort(),
      ['forms', 'legacyLinePresent', 'line', 'otherSheets', 'sheets', 'totalSheets']);
    assert.equal(typeof inventory.legacyLinePresent, 'boolean');
    assert.deepEqual(inventory.sheets.map(sheet => sheet.name), names);
    for (const sheet of inventory.sheets) {
      assert.deepEqual(Object.keys(sheet).sort(),
        ['columns', 'frozenRows', 'index', 'matchingHeaders', 'name', 'present', 'protectionCount', 'rows']);
      assert.equal(typeof sheet.present, 'boolean');
      for (const key of ['columns', 'frozenRows', 'index', 'matchingHeaders', 'protectionCount', 'rows']) {
        assert.ok(sheet[key] === null || (Number.isSafeInteger(sheet[key]) && sheet[key] >= 0));
      }
    }
    assert.deepEqual(Object.keys(inventory.forms).sort(), ['CDR', 'VITALS']);
    for (const form of Object.values(inventory.forms)) {
      assert.deepEqual(Object.keys(form), ['configured', 'observable', 'items']);
      assert.equal(typeof form.configured, 'boolean');
      assert.equal(typeof form.observable, 'boolean');
      assert.ok(form.items === null || (Number.isSafeInteger(form.items) && form.items >= 0));
      if (!form.observable) assert.equal(form.items, null);
    }
    assert.deepEqual(Object.keys(inventory.line).sort(),
      ['controlStartColumn', 'hiddenK', 'hiddenL', 'historyStartColumn']);
  }
  if (result.changes) {
    assert.deepEqual(Object.keys(result.changes).sort(),
      ['contentChangedSheetCount', 'metadataChangedSheetCount', 'metadataChangedSheets', 'operations']);
    assert.equal(result.changes.contentChangedSheetCount, null);
    assert.deepEqual(Object.keys(result.changes.operations).sort(),
      ['overviewRefreshed', 'schemaProtectionFormattingSheets', 'sheetOrderEnsured', 'state', 'validationSheets']);
  }
  assert.doesNotMatch(JSON.stringify(result), new RegExp([MANUAL_TARGET, USER, OWNER, 'https:', 'private-patient',
    'form-1', 'private-error', 'private-response'].join('|')));
}

test('manual preview is strictly readonly and returns only allowlisted metadata', () => {
  const env = manualEnvironment(true);
  const book = env.book();
  book.insertSheet('private-patient unrelated sheet').appendRow(['private-patient']);
  const line = book.getSheetByName('LINE對話');
  line.appendRow(['private-patient', false, USER, '', OWNER]);
  const before = JSON.stringify(book.sheets.map(sheet => sheet.data));
  const calls = monitorManual(env, true);
  const result = plain(env.context.phcepManualLayoutMigration(manualRequest(false)));
  assertManualProtocol(result);
  assert.equal(result.status, 'ok');
  assert.equal(result.blocker, null);
  assert.deepEqual(result.before, result.after);
  assert.equal(result.before.otherSheets, 3); // two existing response tabs + unrelated tab
  assert.deepEqual(result.before.line, { controlStartColumn: 13, historyStartColumn: 20, hiddenK: true, hiddenL: true });
  assert.equal(result.before.forms.CDR.configured, true);
  assert.equal(result.before.forms.CDR.observable, true);
  assert.equal(result.before.forms.CDR.items, env.forms.get(env.properties.get('CDR_FORM_ID')).items.length);
  assert.deepEqual(result.changes.metadataChangedSheets, []);
  assert.equal(result.changes.operations.state, 'not_started');
  assert.deepEqual(calls, { writes: [], locks: 0, releases: 0, migrations: 0 });
  assert.equal(JSON.stringify(book.sheets.map(sheet => sheet.data)), before);
  const fresh = manualEnvironment();
  const freshCalls = monitorManual(fresh, true);
  const preview = plain(fresh.context.phcepManualLayoutMigration(manualRequest(false)));
  assertManualProtocol(preview);
  assert.equal(preview.status, 'ok');
  assert.equal(preview.before.totalSheets, 1);
  assert.equal(preview.before.line.controlStartColumn, null);
  assert.equal(preview.before.forms.CDR.configured, false);
  assert.equal(preview.before.forms.CDR.observable, false);
  assert.equal(preview.before.forms.CDR.items, null);
  assert.deepEqual(freshCalls, { writes: [], locks: 0, releases: 0, migrations: 0 });
});

test('manual request, exact target, configured target and authorization guards precede mutation', () => {
  for (const request of [null, {}, [], { ...manualRequest(false), extra: true },
    { ...manualRequest(false), apply: 'false' }, { ...manualRequest(false), targetSpreadsheetId: 123 }]) {
    const env = manualEnvironment();
    const calls = monitorManual(env, true);
    const result = plain(env.context.phcepManualLayoutMigration(request));
    assert.equal(result.blocker, 'INVALID_REQUEST');
    assertManualProtocol(result);
    assert.deepEqual(calls.writes, []);
  }
  for (const mode of ['target', 'configured', 'missing', 'unauthorized', 'blank-user', 'trusted', 'owner']) {
    const env = manualEnvironment();
    const request = manualRequest(false);
    if (mode === 'target') request.targetSpreadsheetId += ' ';
    if (mode === 'configured') env.properties.set('SPREADSHEET_ID', 'wrong-book');
    if (mode === 'missing') env.properties.delete('SPREADSHEET_ID');
    if (mode === 'owner') env.properties.set('TRUSTED_EDITOR_EMAILS', 'clinician@example.org');
    if (['unauthorized', 'blank-user', 'trusted'].includes(mode)) {
      const email = { unauthorized: 'stranger@example.org', 'blank-user': '', trusted: 'clinician@example.org' }[mode];
      env.context.Session.getEffectiveUser = () => ({ getEmail: () => email });
    }
    // Keep monitoring the intended book even when its configured property is bad.
    const configured = env.properties.get('SPREADSHEET_ID');
    env.properties.set('SPREADSHEET_ID', MANUAL_TARGET);
    const calls = monitorManual(env, true);
    if (configured === undefined) env.properties.delete('SPREADSHEET_ID');
    else env.properties.set('SPREADSHEET_ID', configured);
    const result = plain(env.context.phcepManualLayoutMigration(request));
    assertManualProtocol(result);
    const expected = { target: 'TARGET_MISMATCH', configured: 'CONFIGURATION_MISMATCH', missing: 'CONFIGURATION_MISMATCH',
      unauthorized: 'UNAUTHORIZED', 'blank-user': 'UNAUTHORIZED', trusted: null, owner: null }[mode];
    assert.equal(result.blocker, expected);
    assert.equal(result.status, expected ? 'blocked' : 'ok');
    if (expected) assert.equal(result.before, null);
    assert.deepEqual(calls.writes, []);
    if (expected) {
      request.apply = true;
      const applyResult = plain(env.context.phcepManualLayoutMigration(request));
      assert.equal(applyResult.blocker, expected);
      assertManualProtocol(applyResult);
      assert.equal(calls.locks, 0);
      assert.equal(calls.migrations, 0);
    }
  }
});

test('manual whole-workbook preflight blocks unsafe schemas before any writes', () => {
  const cases = [
    ['partial-core', 'SCHEMA_CONFLICT'],
    ['duplicate-core', 'SCHEMA_CONFLICT'],
    ['duplicate-extra', 'SCHEMA_CONFLICT'],
    ['formula-header', 'SCHEMA_CONFLICT'],
    ['formula-overlap', 'SCHEMA_CONFLICT'],
    ['late-conflict', 'SCHEMA_CONFLICT'],
    ['unlabelled-core', 'SCHEMA_CONFLICT'],
    ['unlabelled-extension', 'SCHEMA_CONFLICT'],
    ['partial-block', 'UNSUPPORTED_LINE_LAYOUT'],
    ['duplicate-block', 'UNSUPPORTED_LINE_LAYOUT'],
    ['shifted-block', 'UNSUPPORTED_LINE_LAYOUT'],
    ['unmanaged-overview', 'UNMANAGED_OVERVIEW'],
    ['unlabelled-overview', 'UNMANAGED_OVERVIEW'],
    ['response-as-schema', 'SCHEMA_CONFLICT']
  ];
  for (const [mode, blocker] of cases) {
    const env = manualEnvironment();
    const book = env.book();
    const line = book.getSheetByName('LINE對話');
    const block = plain(env.context.PHCEP_LINE_CONTROL_HEADERS_).concat(plain(env.context.PHCEP_LINE_HISTORY_HEADERS_));
    if (mode === 'partial-core') line.getRange(1, 2).setValue('');
    if (mode === 'duplicate-core') line.getRange(1, 26).setValue('Message ID');
    if (mode === 'duplicate-extra') line.getRange(1, 25, 1, 2).setValues([['legacy duplicate', 'legacy duplicate']]);
    if (mode === 'formula-header') line.formulas = [['="Message ID"']];
    if (mode === 'formula-overlap') {
      line.formulas = [[], [...Array(12).fill(''), '=""']];
      line.getRange(2, 1).setValue('private-patient'); // populated row whose M formula displays blank
    }
    if (mode === 'late-conflict') book.insertSheet('收錄集合').appendRow(['private-patient wrong schema']);
    if (mode === 'unlabelled-core') {
      line.getRange(1, 12).setValue('');
      line.getRange(2, 12).setValue('private-patient');
    }
    if (mode === 'unlabelled-extension') line.getRange(2, 13).setValue('private-patient');
    if (mode === 'partial-block') line.getRange(1, 13).setValue(block[0]);
    if (mode === 'duplicate-block') {
      line.getRange(1, 13, 1, block.length).setValues([block]);
      line.getRange(1, 26).setValue(block[0]);
    }
    if (mode === 'shifted-block') line.getRange(1, 14, 1, block.length).setValues([block]);
    if (mode === 'unmanaged-overview') book.insertSheet('總覽').appendRow(['private-patient']);
    if (mode === 'unlabelled-overview') book.insertSheet('總覽').getRange(2, 1).setValue('private-patient');
    if (mode === 'response-as-schema') line.formUrl = 'https://private-response';
    const calls = monitorManual(env);
    const result = plain(env.context.phcepManualLayoutMigration(manualRequest(true)));
    assertManualProtocol(result);
    assert.equal(result.status, 'blocked', mode);
    assert.equal(result.blocker, blocker, mode);
    assert.deepEqual(result.before, result.after, mode);
    assert.deepEqual(calls.writes, [], mode);
    assert.equal(calls.migrations, 0, mode);
    assert.equal(calls.locks, 1);
    assert.equal(calls.releases, 1);
  }
});

test('manual apply uses only locked layout migration; repeats preserve A:L, forms and response tabs', () => {
  const env = manualEnvironment(true);
  const line = env.book().getSheetByName('LINE對話');
  line.appendRow(['private-patient', false, USER, 'timestamp', OWNER, 'question', 'media',
    'suggestions', 'draft', 'reply', 'event-key', 'state']);
  const legacy = JSON.stringify(line.data.map(row => row.slice(0, 12)));
  const responses = env.book().sheets.filter(sheet => sheet.formUrl);
  responses[0].appendRow(['private-response', 'private-patient']);
  const raw = JSON.stringify(responses.map(sheet => sheet.data));
  const forms = JSON.stringify([...env.forms.values()]);
  const properties = JSON.stringify([...env.properties]);
  const triggers = [...env.triggers];
  const calls = monitorManual(env);
  for (let i = 0; i < 2; i++) {
    const result = plain(env.context.phcepManualLayoutMigration(manualRequest(true)));
    assertManualProtocol(result);
    assert.equal(result.status, 'ok');
    assert.equal(result.changes.operations.state, 'completed');
    assert.equal(result.changes.operations.overviewRefreshed, true);
    assert.ok(result.changes.operations.schemaProtectionFormattingSheets.includes('總覽'));
    assert.deepEqual(result.changes.operations.validationSheets, ['LINE對話', 'QA知識庫', '收錄集合']);
    // The overview timestamp/content was rewritten, but a metadata-only snapshot
    // cannot claim to know a content changed-sheet count.
    assert.deepEqual(result.changes.metadataChangedSheets, []);
    assert.equal(result.changes.contentChangedSheetCount, null);
    assert.equal(JSON.stringify(line.data.map(row => row.slice(0, 12))), legacy);
    assert.equal(JSON.stringify(responses.map(sheet => sheet.data)), raw);
    assert.equal(JSON.stringify([...env.forms.values()]), forms);
    assert.equal(JSON.stringify([...env.properties]), properties);
    assert.deepEqual(env.triggers, triggers);
  }
  assert.equal(calls.migrations, 2);
  assert.equal(calls.locks, 2);
  assert.equal(calls.releases, 2);
  assert.ok(calls.writes.includes('setDataValidation'));
});

test('manual apply creates missing layout and reports observed metadata separately', () => {
  const env = manualEnvironment();
  const line = env.book().getSheetByName('LINE對話');
  line.getRange(1, 13).setValue('private-patient legacy header');
  line.getRange(2, 13).setValue('private-patient legacy value');
  const calls = monitorManual(env);
  const result = plain(env.context.phcepManualLayoutMigration(manualRequest(true)));
  assertManualProtocol(result);
  assert.equal(result.status, 'ok');
  assert.equal(result.after.line.controlStartColumn, 13);
  assert.equal(result.after.line.historyStartColumn, 20);
  assert.equal(result.after.line.hiddenK, true);
  assert.equal(line.getRange(2, 25).getValue(), 'private-patient legacy value');
  assert.equal(result.changes.metadataChangedSheetCount, 12);
  assert.equal(calls.migrations, 1);
});

test('manual failures retain observable partial state, redact errors and always release lock', () => {
  for (const unreadableAfter of [false, true]) {
    const env = manualEnvironment();
    const calls = monitorManual(env);
    const migrate = env.context.phcepMigrateLayout_;
    env.setProtectionFailure(true);
    env.context.phcepMigrateLayout_ = (...args) => {
      try { return migrate(...args); } catch {
        if (unreadableAfter) env.book().getSheets = () => { throw new Error('private-error https://private-response'); };
        throw new Error('private-error ' + OWNER + ' ' + MANUAL_TARGET);
      }
    };
    const result = plain(env.context.phcepManualLayoutMigration(manualRequest(true)));
    assertManualProtocol(result);
    assert.equal(result.status, 'failed');
    assert.equal(result.blocker, 'MIGRATION_FAILED');
    assert.equal(result.changes.operations.state, 'partial');
    assert.equal(result.changes.operations.schemaProtectionFormattingSheets, null);
    assert.equal(result.changes.operations.overviewRefreshed, null);
    assert.equal(result.changes.contentChangedSheetCount, null);
    if (unreadableAfter) {
      assert.equal(result.after, null);
      assert.equal(result.changes.metadataChangedSheetCount, null);
    } else {
      assert.ok(result.after);
      assert.ok(result.changes.metadataChangedSheets.includes('LINE對話'));
      assert.equal(result.after.sheets[0].protectionCount, 1);
    }
    assert.equal(calls.releases, 1);
  }
});

test('manual lock refusal and inventory errors fail closed without migration or raw errors', () => {
  for (const mode of ['lock-refused', 'lock-error', 'read-error', 'after-error']) {
    const env = manualEnvironment();
    const calls = monitorManual(env);
    if (mode === 'lock-refused') env.context.LockService.getScriptLock = () => ({ tryLock: () => false });
    if (mode === 'lock-error') env.context.LockService.getScriptLock = () => { throw new Error('private-error'); };
    if (mode === 'read-error') env.book().getSheets = () => { throw new Error('private-error'); };
    if (mode === 'after-error') {
      const migrate = env.context.phcepMigrateLayout_;
      env.context.phcepMigrateLayout_ = (...args) => {
        const result = migrate(...args);
        env.book().getSheets = () => { throw new Error('private-error'); };
        return result;
      };
    }
    const result = plain(env.context.phcepManualLayoutMigration(manualRequest(true)));
    assertManualProtocol(result);
    assert.equal(result.status, mode.startsWith('lock') ? 'blocked' : 'failed');
    assert.equal(result.blocker, mode.startsWith('lock') ? 'LOCK_UNAVAILABLE' : 'READ_FAILED');
    if (mode === 'after-error') {
      assert.equal(result.changes.operations.state, 'completed');
      assert.equal(result.changes.operations.overviewRefreshed, true);
      assert.equal(result.after, null);
    } else {
      assert.equal(calls.migrations, 0);
      assert.deepEqual(calls.writes, []);
    }
  }
});

test('manual migration source is explicitly deployable through the clasp allowlist', () => {
  const ignore = fs.readFileSync(path.join(root, 'apps-script', '.claspignore'), 'utf8').split(/\r?\n/);
  assert.equal(ignore[0], '**/**');
  assert.ok(ignore.includes('!ManualMigration.gs'));
});

test('manual preview runs with only its verified source and native read-only services', () => {
  const env = manualEnvironment(true);
  const schemas = plain(vm.runInContext('PHCEP_SCHEMAS_', env.context));
  assert.deepEqual(plain(env.context.phcepManualSchemas_()), schemas);
  assert.deepEqual(plain(env.context.phcepManualLineHeaders_()),
    plain(env.context.PHCEP_LINE_CONTROL_HEADERS_).concat(plain(env.context.PHCEP_LINE_HISTORY_HEADERS_)));
  const calls = monitorManual(env, true);
  const isolated = vm.createContext({
    PropertiesService: env.context.PropertiesService,
    Session: env.context.Session,
    SpreadsheetApp: env.context.SpreadsheetApp,
    FormApp: env.context.FormApp,
    LockService: env.context.LockService
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'apps-script', 'ManualMigration.gs'), 'utf8'), isolated);
  const result = plain(isolated.phcepManualLayoutMigration(manualRequest(false)));
  assertManualProtocol(result);
  assert.equal(result.status, 'ok');
  assert.equal(result.before.line.controlStartColumn, 13);
  assert.deepEqual(calls, { writes: [], locks: 0, releases: 0, migrations: 0 });
});

test('manual forms inventory reads only configured forms and reports inaccessible counts as unknown', () => {
  const env = manualEnvironment();
  const cdr = env.context.FormApp.create('private-patient form title');
  env.properties.set('CDR_FORM_ID', cdr.getId());
  env.properties.set('VITALS_FORM_ID', 'private-error inaccessible form ID');
  cdr.items = [{ getTitle() { assert.fail('must not read item titles'); } },
    { getResponses() { assert.fail('must not read form responses'); } }];
  const opened = [];
  const open = env.context.FormApp.openById;
  env.context.FormApp.openById = id => { opened.push(id); return open(id); };
  const calls = monitorManual(env, true);
  const result = plain(env.context.phcepManualLayoutMigration(manualRequest(false)));
  assertManualProtocol(result);
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.before.forms, {
    CDR: { configured: true, observable: true, items: 2 },
    VITALS: { configured: true, observable: false, items: null }
  });
  assert.deepEqual(result.before.forms, result.after.forms);
  assert.deepEqual(opened, [cdr.getId(), 'private-error inaccessible form ID',
    cdr.getId(), 'private-error inaccessible form ID']);
  assert.deepEqual(calls.writes, []);
});

test('manual inventory distinguishes legacy LINE rename from creation without exposing legacy data', () => {
  const env = manualEnvironment();
  const legacy = env.book().getSheetByName('LINE對話');
  legacy.setName('工作表1');
  legacy.appendRow(['private-patient', false, USER, '', OWNER, 'question', '', '', 'draft', 'reply', 'key', 'state']);
  const values = JSON.stringify(legacy.data.map(row => row.slice(0, 12)));
  const calls = monitorManual(env);
  const result = plain(env.context.phcepManualLayoutMigration(manualRequest(true)));
  assertManualProtocol(result);
  assert.equal(result.status, 'ok');
  assert.equal(result.before.legacyLinePresent, true);
  assert.equal(result.before.sheets[0].present, false);
  assert.equal(result.after.legacyLinePresent, false);
  assert.equal(result.after.sheets[0].present, true);
  assert.equal(env.book().getSheetByName('LINE對話'), legacy);
  assert.equal(JSON.stringify(legacy.data.map(row => row.slice(0, 12))), values);
  assert.equal(calls.migrations, 1);
});
