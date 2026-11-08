'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { build } = require('../build.cjs');

async function assistant() {
  const controls = {}, messages = [], events = [];
  const control = (id, value = '') => controls[id] = {
    value, disabled: false, hidden: false, type: 'text',
    dispatchEvent: event => events.push({ id, type: event.type }),
    getClientRects: () => [{}]
  };
  const chrome = { runtime: { id: 'a'.repeat(32), onMessage: { addListener() {} },
    sendMessage: async message => {
      messages.push(message);
      return message.type === 'bootstrap' ? { success: true, origin: 'https://nhi-workflow.example',
        clinicId: 'synthetic-clinic', state: {}, expiresAt: Date.now() + 60000 } : { success: true };
    }
  } };
  const document = {
    createElement: () => ({ style: {}, addEventListener() {} }),
    documentElement: { append() {} },
    getElementById: id => controls[id] || null,
    querySelectorAll: () => []
  };
  const context = vm.createContext({
    chrome, document, console, URL, Event: class { constructor(type) { this.type = type; } },
    setInterval: () => 1, clearInterval() {}, alert: message => { throw new Error(message); }
  });
  const dest = build('https://nhi-workflow.example');
  let source = fs.readFileSync(path.join(dest, 'extension', 'content.js'), 'utf8');
  source = source.replace('  createPanel();',
    '  globalThis.assistant = { normalizePatient, applyPatient, extractPatient, getStoredState, storeState };');
  await vm.runInContext(source, context);
  return { api: context.assistant, controls, control, events, messages };
}
test('migrated assistant fills mapped fields only; keeps phone and absent measurements; never submits', async () => {
  const h = await assistant();
  h.control('cph_txtID'); h.control('cph_txtNAME'); h.control('cph_txtBIRTHDAY');
  h.control('cph_txtLDLC'); h.control('cph_txtHEIGHT', '170');
  h.control('cph_txtPHONE', 'UNCHANGED');
  let submitted = false;
  h.controls.submit = { click: () => { submitted = true; } };
  const p = h.api.normalizePatient({ rowId: 7, patientId: 'A100000002', name: 'SYNTHETIC',
    birthday: '1960-01-01', ldlCMgDl: 123, phone: 'NOT_COPIED' });
  h.api.applyPatient(p);
  assert.equal(h.controls.cph_txtID.value, 'A100000002');
  assert.equal(h.controls.cph_txtLDLC.value, '123');
  assert.equal(h.controls.cph_txtBIRTHDAY.value, '1960/01/01');
  assert.equal(h.controls.cph_txtHEIGHT.value, '170');
  assert.equal(h.controls.cph_txtPHONE.value, 'UNCHANGED');
  assert.equal(submitted, false);
  assert.ok(!h.events.some(e => e.type === 'submit'));
});
test('reverse extraction validates numeric/date fields and includes only supplied mapped controls', async () => {
  const h = await assistant();
  h.control('cph_txtID', 'A100000002'); h.control('cph_txtNAME', 'SYNTHETIC');
  h.control('cph_txtVISIT_DATE', '2026/11/08'); h.control('cph_txtLDLC', '123');
  h.control('cph_txtPHONE', 'NOT_EXTRACTED');
  const p = JSON.parse(JSON.stringify(h.api.extractPatient()));
  assert.deepEqual(p, { patientId: 'A100000002', name: 'SYNTHETIC', visitDate: '2026/11/08', ldlCMgDl: 123 });
  h.controls.cph_txtLDLC.value = '-1';
  assert.throws(() => h.api.extractPatient(), /Extraction needs review/);
});
test('temporary state uses the clinic/tab extension bridge and survives a normal reload cache', async () => {
  const h = await assistant();
  h.api.storeState({ patient: { rowId: 7, patientId: 'A100000002', name: 'SYNTHETIC' },
    fillAttempted: false, savedAt: Date.now() });
  const state = h.api.getStoredState();
  assert.equal(state.patient.rowId, 7);
  const message = h.messages.find(m => m.type === 'state');
  assert.equal(message.clinicId, 'synthetic-clinic');
  assert.ok(!JSON.stringify(message).includes('token'));
});
