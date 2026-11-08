// ==UserScript==
// @name         NHI High-Risk Hyperlipidemia Form Assistant
// @namespace    https://medvpn.nhi.gov.tw/
// @version      2.2.0
// @description  Load a pending PHCEP patient and manually fill the NHI form; never submits it.
// @match        https://medvpn.nhi.gov.tw/qmue1000/QMUE1002S01.aspx*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// @connect      clinical-medicine.onrender.com
// ==/UserScript==

(function () {
  'use strict';

  const CONFIG = Object.freeze({
    apiBaseUrl: 'https://clinical-medicine.onrender.com',
    requestTimeoutMs: 45000,
    patientStateTtlMs: 30 * 60 * 1000
  });

  const PANEL_ID = 'nhi-phcep-assistant-host';
  const STATE_KEY = 'nhi-phcep-assistant-patient-v1';
  const TOKEN_KEY = 'nhi-phcep-render-clinician-token';

  function configureToken() {
    const token = window.prompt(
      'Enter your prototype clinician bearer token. It will be stored locally by ' +
      'Tampermonkey, not in the userscript source. Never enter Google credentials ' +
      'or a backend signing key.'
    );
    if (token === null) return;
    if (token.trim().length < 32 || /\s/.test(token.trim())) {
      setStatus('The clinician token must have at least 32 non-whitespace characters.', 'error');
      return;
    }
    GM_setValue(TOKEN_KEY, token.trim());
    setStatus('Clinician token saved locally. It will be sent only to the configured Render gateway.',
      'success');
  }
  const OPTIONAL_TOP_LEVEL_KEYS = [
    'patientName', 'birthDate', 'gender', 'visitDate', 'enrollmentDate',
    'careStage', 'acuteAdmissionDate', 'physicianId', 'physicianName',
    'primaryDiagnosisCategory', 'primaryDiagnosisCode', 'examDate', 'heightCm',
    'weightKg', 'waistCm', 'labDate', 'hba1cPercent',
    'glycatedAlbuminPercent', 'fastingGlucoseMgDl', 'totalCholesterolMgDl',
    'triglyceridesMgDl', 'ldlCMgDl', 'hdlCMgDl', 'systolicMmHg',
    'diastolicMmHg', 'smoking', 'alcohol', 'betelNut'
  ];
  const HISTORY_KEYS = [
    'acuteCoronarySyndrome', 'coronaryRevascularization',
    'intracranialOrCarotidStenosis', 'aorticArchAtherosclerosis',
    'coronaryArteryDisease', 'peripheralArteryDisease',
    'coronaryAngiography', 'coronaryOrPeripheralCT',
    'carotidOrPeripheralUltrasound', 'miWithinOneYear', 'twoOrMoreMIs',
    'multivesselCoronaryObstruction', 'acsWithDiabetes',
    'padOrCarotidStenosis', 'coronaryArteryDiseaseCriterion',
    'carotidStenosisCriterion'
  ];
  const LIFESTYLE_KEYS = [
    'positiveSocialConnection', 'physicalActivity',
    'harmfulSubstanceAvoidance', 'sleepAndStressManagement', 'nutrition'
  ];

  const FIELD_SPECS = [
    { kind: 'text', id: 'cph_txtID', sources: [['patientId']] },
    { kind: 'text', id: 'cph_txtNAME', sources: [['name'], ['patientName']] },
    { kind: 'date', id: 'cph_txtBIRTHDAY', sources: [['birthday'], ['birthDate']] },
    {
      kind: 'radio',
      id: 'cph_rblSEX',
      sources: [['gender']],
      values: { male: '1', female: '2', 男: '1', 女: '2' }
    },
    { kind: 'date', id: 'cph_txtVISIT_DATE', sources: [['visitDate']] },
    { kind: 'date', id: 'cph_txtCASE_DATE', sources: [['enrollmentDate']] },
    { kind: 'select', id: 'cph_ddlCURE_STAGE', sources: [['careStage']] },
    { kind: 'date', id: 'cph_txtERVISIT_DATE', sources: [['acuteAdmissionDate']] },
    { kind: 'text', id: 'cph_txtPRSN_ID', sources: [['physicianId']] },
    { kind: 'text', id: 'cph_txtPRSN_NAME', sources: [['physicianName']] },

    { kind: 'category', id: 'cph_ddlICDTYPE', sources: [['primaryDiagnosisCategory']] },
    { kind: 'diagnosis', id: 'cph_ddlICD', sources: [['primaryDiagnosisCode']] },

    { kind: 'checkbox', id: 'cph_chkHISTORY1C1', sources: [['history', 'acuteCoronarySyndrome']] },
    { kind: 'checkbox', id: 'cph_chkHISTORY1C2', sources: [['history', 'coronaryRevascularization']] },
    { kind: 'checkbox', id: 'cph_chkHISTORY1C31', sources: [['history', 'intracranialOrCarotidStenosis']] },
    { kind: 'checkbox', id: 'cph_chkHISTORY1C32', sources: [['history', 'aorticArchAtherosclerosis']] },
    { kind: 'checkbox', id: 'cph_chkHISTORY1C33', sources: [['history', 'coronaryArteryDisease']] },
    { kind: 'checkbox', id: 'cph_chkHISTORY1C4', sources: [['history', 'peripheralArteryDisease']] },
    { kind: 'checkbox', id: 'cph_chkHISTORY2C1', sources: [['history', 'coronaryAngiography']] },
    { kind: 'checkbox', id: 'cph_chkHISTORY2C2', sources: [['history', 'coronaryOrPeripheralCT']] },
    { kind: 'checkbox', id: 'cph_chkHISTORY2C3', sources: [['history', 'carotidOrPeripheralUltrasound']] },
    { kind: 'checkbox', id: 'cph_chkHISTORY3C1', sources: [['history', 'miWithinOneYear']] },
    { kind: 'checkbox', id: 'cph_chkHISTORY3C2', sources: [['history', 'twoOrMoreMIs']] },
    { kind: 'checkbox', id: 'cph_chkHISTORY3C3', sources: [['history', 'multivesselCoronaryObstruction']] },
    { kind: 'checkbox', id: 'cph_chkHISTORY3C4', sources: [['history', 'acsWithDiabetes']] },
    { kind: 'checkbox', id: 'cph_chkHISTORY3C5', sources: [['history', 'padOrCarotidStenosis']] },
    { kind: 'checkbox', id: 'cph_chkHISTORY4C1', sources: [['history', 'coronaryArteryDiseaseCriterion']] },
    { kind: 'checkbox', id: 'cph_chkHISTORY4C2', sources: [['history', 'carotidStenosisCriterion']] },

    { kind: 'date', id: 'cph_txtCHK_DATE', sources: [['examDate']] },
    { kind: 'number', id: 'cph_txtHEIGHT', sources: [['heightCm']], min: 0, max: 999.9 },
    { kind: 'number', id: 'cph_txtWEIGHT', sources: [['weightKg']], min: 0, max: 999.99 },
    { kind: 'number', id: 'cph_txtWAISTLINE', sources: [['waistCm']], min: 0, max: 600 },
    { kind: 'date', id: 'cph_txtDIAG_DATE', sources: [['labDate']] },
    { kind: 'number', id: 'cph_txtHBA1C', sources: [['hba1cPercent']], min: 0, max: 100 },
    { kind: 'number', id: 'cph_txtGA', sources: [['glycatedAlbuminPercent']], min: 0, max: 100 },
    { kind: 'number', id: 'cph_txtAC', sources: [['fastingGlucoseMgDl']], min: 0, max: 3000 },
    { kind: 'number', id: 'cph_txtCHO', sources: [['totalCholesterolMgDl']], min: 0, max: 999 },
    { kind: 'number', id: 'cph_txtBLODTG', sources: [['triglyceridesMgDl']], min: 0, max: 17000 },
    { kind: 'number', id: 'cph_txtLDLC', sources: [['ldlCMgDl']], min: 0, max: 999 },
    { kind: 'number', id: 'cph_txtHDLC', sources: [['hdlCMgDl']], min: 0, max: 999 },
    { kind: 'number', id: 'cph_txtBASESBP', sources: [['systolicMmHg']], min: 0, max: 999 },
    { kind: 'number', id: 'cph_txtBASEEBP', sources: [['diastolicMmHg']], min: 0, max: 999 },

    { kind: 'number', id: 'cph_txtSOLCIAL_CONN', sources: [['lifestyleScores', 'positiveSocialConnection']], min: 0, max: 10, integer: true },
    { kind: 'number', id: 'cph_txtPHYSICAL_ACT', sources: [['lifestyleScores', 'physicalActivity']], min: 0, max: 10, integer: true },
    { kind: 'number', id: 'cph_txtSUBSTANCE_AVOID', sources: [['lifestyleScores', 'harmfulSubstanceAvoidance']], min: 0, max: 10, integer: true },
    { kind: 'number', id: 'cph_txtSTRESS', sources: [['lifestyleScores', 'sleepAndStressManagement']], min: 0, max: 10, integer: true },
    { kind: 'number', id: 'cph_txtNUTRITION', sources: [['lifestyleScores', 'nutrition']], min: 0, max: 10, integer: true },
    { kind: 'radio', id: 'cph_rblSMOKE', sources: [['smoking']], allowedValues: ['1', '2', '3', '4'] },
    { kind: 'radio', id: 'cph_rblALCOHOL', sources: [['alcohol']], allowedValues: ['1', '2', '3'] },
    { kind: 'radio', id: 'cph_rblBETLE', sources: [['betelNut']], allowedValues: ['1', '2', '3'] }
  ];

  function getPath(record, path) {
    return path.reduce(function (value, key) {
      return value && typeof value === 'object' ? value[key] : undefined;
    }, record);
  }

  function getFirstValue(record, sources) {
    for (const path of sources) {
      const value = getPath(record, path);
      if (value !== undefined && value !== null && value !== '') {
        return { found: true, value: value };
      }
    }
    return { found: false, value: undefined };
  }

  function copyKnownKeys(source, keys) {
    const result = {};
    if (!source || typeof source !== 'object' || Array.isArray(source)) return result;
    keys.forEach(function (key) {
      if (Object.prototype.hasOwnProperty.call(source, key)) result[key] = source[key];
    });
    return result;
  }

  function normalizePatient(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error('The pending endpoint returned no patient record.');
    }
    if (!Number.isSafeInteger(raw.rowId) || raw.rowId < 1) {
      throw new Error('The patient record has an invalid rowId.');
    }

    const name = raw.name !== undefined ? raw.name : raw.patientName;
    const birthday = raw.birthday !== undefined ? raw.birthday : raw.birthDate;
    if (typeof raw.patientId !== 'string' || !raw.patientId.trim()) {
      throw new Error('The patient record is missing patientId.');
    }

    const patient = {
      rowId: raw.rowId,
      patientId: raw.patientId.trim(),
      name: typeof name === 'string' ? name.trim() : '',
      birthday: typeof birthday === 'string' ? birthday.trim() : ''
    };
    OPTIONAL_TOP_LEVEL_KEYS.forEach(function (key) {
      if (Object.prototype.hasOwnProperty.call(raw, key)) patient[key] = raw[key];
    });
    if (raw.history && typeof raw.history === 'object' && !Array.isArray(raw.history)) {
      patient.history = copyKnownKeys(raw.history, HISTORY_KEYS);
    }
    if (raw.lifestyleScores && typeof raw.lifestyleScores === 'object' &&
        !Array.isArray(raw.lifestyleScores)) {
      patient.lifestyleScores = copyKnownKeys(raw.lifestyleScores, LIFESTYLE_KEYS);
    }
    return patient;
  }

  function formatNhiDate(value) {
    if (typeof value !== 'string') throw new Error('date must be a string');
    const match = value.trim().match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
    if (!match) throw new Error('date must use YYYY-MM-DD or YYYY/MM/DD');
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 ||
        date.getUTCDate() !== day) {
      throw new Error('date is not a valid calendar date');
    }
    return year + '/' + String(month).padStart(2, '0') + '/' + String(day).padStart(2, '0');
  }

  function validateNumber(value, spec) {
    const number = typeof value === 'number' ? value :
      (typeof value === 'string' && value.trim() ? Number(value) : NaN);
    if (!Number.isFinite(number) || number < spec.min || number > spec.max ||
        (spec.integer && !Number.isInteger(number))) {
      throw new Error('value must be ' + (spec.integer ? 'an integer ' : '') +
        'between ' + spec.min + ' and ' + spec.max);
    }
    return String(number);
  }

  function normalizeCode(value) {
    return String(value || '').trim().toUpperCase();
  }

  function compactCode(value) {
    return normalizeCode(value).replace(/\./g, '');
  }

  // HIS exports "I63.89"; the NHI list may print "I6389", so dots are ignored.
  function findDiagnosisOption(select, code) {
    const expected = compactCode(code);
    const escaped = expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const prefix = new RegExp('^' + escaped + '(?:$|[\\s:：(（-])');
    const matches = Array.from(select.options).filter(function (option) {
      return compactCode(option.value) === expected ||
        prefix.test(compactCode(option.textContent));
    });
    return expected && matches.length === 1 ? matches[0] : null;
  }

  function getPanel() {
    const host = document.getElementById(PANEL_ID);
    return host ? host.shadowRoot : null;
  }

  function setStatus(message, kind) {
    const root = getPanel();
    const status = root && root.getElementById('status');
    if (!status) return;
    status.textContent = message;
    status.dataset.kind = kind || 'info';
  }

  function getStoredState() {
    const stored = sessionStorage.getItem(STATE_KEY);
    if (!stored) return null;
    let state;
    try {
      state = JSON.parse(stored);
    } catch (error) {
      sessionStorage.removeItem(STATE_KEY);
      throw new Error('Stored patient state was invalid; load the patient again.');
    }
    if (!state || !state.patient || !Number.isFinite(state.savedAt) ||
        Date.now() - state.savedAt > CONFIG.patientStateTtlMs) {
      sessionStorage.removeItem(STATE_KEY);
      throw new Error('The loaded patient expired from this tab; load the patient again.');
    }
    return state;
  }

  function storeState(state) {
    state.savedAt = Date.now();
    sessionStorage.setItem(STATE_KEY, JSON.stringify(state));
  }

  function updatePanel(state) {
    const root = getPanel();
    if (!root) return;
    const summary = root.getElementById('patient');
    const fillButton = root.getElementById('fill');
    const completeButton = root.getElementById('complete');
    if (state && state.patient) {
      const stage = { 1: '新收案', 2: '追蹤管理' }[String(state.patient.careStage)] || '診療階段未填';
      summary.textContent = 'Loaded: ' + state.patient.name + ' · ' +
        state.patient.patientId + ' · ' + stage +
        (state.patient.visitDate ? ' ' + state.patient.visitDate : '') +
        ' · row ' + state.patient.rowId;
      fillButton.disabled = false;
      completeButton.disabled = !state.fillAttempted;
    } else {
      summary.textContent = 'No patient loaded.';
      fillButton.disabled = true;
      completeButton.disabled = true;
    }
  }

  function buildApiUrl(path) {
    if (CONFIG.apiBaseUrl.indexOf('REPLACE_RENDER_SERVICE') !== -1) {
      throw new Error('Configure the Render hostname in apiBaseUrl and @connect before loading patients.');
    }
    const base = new URL(CONFIG.apiBaseUrl);
    if (base.protocol !== 'https:' || !base.hostname.endsWith('.onrender.com') ||
        base.username || base.password || base.port || base.search || base.hash ||
        base.pathname !== '/') {
      throw new Error('Configure an HTTPS Render service origin, not a Google endpoint.');
    }
    return base.toString().replace(/\/+$/, '') + path;
  }

  function requestHeaders() {
    const token = GM_getValue(TOKEN_KEY, '');
    if (typeof token !== 'string' || token.length < 32 || /\s/.test(token)) {
      throw new Error('Use the Tampermonkey menu: Configure clinician token.');
    }
    return { Accept: 'application/json', Authorization: 'Bearer ' + token };
  }

  function requestJson(method, path, body) {
    return new Promise(function (resolve, reject) {
      let url;
      let headers;
      try {
        url = buildApiUrl(path);
        headers = requestHeaders();
      } catch (error) {
        reject(error);
        return;
      }
      const options = {
        method: method,
        url: url,
        headers: headers,
        timeout: CONFIG.requestTimeoutMs,
        anonymous: true,
        redirect: 'error',
        onload: function (response) {
          if (response.status === 401) {
            reject(new Error('Render rejected clinician authorization. Reconfigure your token.'));
            return;
          }
          let payload;
          try {
            payload = JSON.parse(response.responseText);
          } catch (error) {
            reject(new Error('The patient API returned a non-JSON response (HTTP ' +
              response.status + ').'));
            return;
          }
          if (response.status < 200 || response.status >= 300) {
            reject(new Error('Patient API request failed with HTTP ' + response.status +
              (payload && /^[A-Z_]+$/.test(payload.error || '') ? ' (' + payload.error + ')' : '') + '.'));
            return;
          }
          resolve(payload);
        },
        onerror: function () {
          reject(new Error('Could not reach Render. Check the hostname, @connect permission, and authorization.'));
        },
        ontimeout: function () {
          reject(new Error('The patient API request timed out.'));
        },
        onabort: function () {
          reject(new Error('The patient API request was aborted.'));
        }
      };
      if (body !== undefined) {
        headers['Content-Type'] = 'application/json';
        options.data = JSON.stringify(body);
      }
      GM_xmlhttpRequest(options);
    });
  }

  async function loadPatient() {
    const root = getPanel();
    const button = root.getElementById('load');
    button.disabled = true;
    setStatus('Loading next pending patient…', 'info');
    try {
      const payload = await requestJson('GET', '/api/pending');
      if (!payload || payload.success !== true) {
        throw new Error(payload && typeof payload.error === 'string' ?
          'Patient API error: ' + payload.error : 'The patient API did not confirm success.');
      }
      if (payload.patient === null) {
        setStatus('No pending patients. The current loaded record, if any, was kept.', 'info');
        return;
      }
      const patient = normalizePatient(payload.patient);
      let existingState = null;
      try {
        existingState = getStoredState();
      } catch (error) {
        setStatus(error.message, 'error');
      }
      if (existingState && existingState.patient.rowId === patient.rowId) {
        setStatus('This pending patient is already loaded. Continue with Fill Form.', 'info');
        return;
      }
      if (existingState && existingState.patient.rowId !== patient.rowId &&
          !window.confirm('Replace the currently loaded patient with row ' +
            patient.rowId + '?')) {
        setStatus('The current patient was kept.', 'info');
        return;
      }
      const state = { patient: patient, fillAttempted: false, savedAt: Date.now() };
      storeState(state);
      updatePanel(state);
      setStatus('Patient loaded. Only supplied mapped fields will be filled; ' +
        'absent clinical values and the phone number are not copied to the NHI form.', 'success');
    } catch (error) {
      setStatus(error.message, 'error');
    } finally {
      button.disabled = false;
    }
  }

  function applyPatient(patient) {
    const issues = [];
    let applied = 0;
    const categoryItem = getFirstValue(patient, [['primaryDiagnosisCategory']]);
    const diagnosisItem = getFirstValue(patient, [['primaryDiagnosisCode']]);
    const category = categoryItem.found ? String(categoryItem.value) : '';
    const categorySelect = document.getElementById('cph_ddlICDTYPE');
    let diagnosisReady = !categoryItem.found && !diagnosisItem.found;

    if (categoryItem.found) {
      if (!categorySelect ||
          !Array.from(categorySelect.options).some(function (option) {
            return option.value === category;
          })) {
        issues.push('Diagnosis category ' + category +
          ' is not available in the NHI form; diagnosis fields were left unchanged.');
      } else if (categorySelect.value !== category) {
        issues.push('Choose diagnosis category ' + category +
          ' in the NHI form, wait for its normal page refresh, then click Fill Form again.');
      } else {
        diagnosisReady = true;
      }
    } else if (diagnosisItem.found) {
      issues.push('A primary diagnosis code was supplied without its category; ' +
        'diagnosis fields were left unchanged.');
    }

    FIELD_SPECS.forEach(function (spec) {
      const item = getFirstValue(patient, spec.sources);
      if (!item.found) return;
      if ((spec.kind === 'category' || spec.kind === 'diagnosis') && !diagnosisReady) {
        return;
      }

      const element = document.getElementById(spec.id);
      if (!element) {
        issues.push('Form control not found: ' + spec.id);
        return;
      }
      try {
        if (spec.kind === 'text' || spec.kind === 'date' || spec.kind === 'number') {
          let value = item.value;
          if (spec.kind === 'date') value = formatNhiDate(value);
          if (spec.kind === 'number') value = validateNumber(value, spec);
          if (typeof value !== 'string' && typeof value !== 'number') {
            throw new Error('value must be text or a number');
          }
          element.value = String(value);
          element.dispatchEvent(new Event('input', { bubbles: true }));
          applied++;
          return;
        }
        if (spec.kind === 'checkbox') {
          if (typeof item.value !== 'boolean') {
            throw new Error('value must be true or false');
          }
          element.checked = item.value;
          element.dispatchEvent(new Event('change', { bubbles: true }));
          applied++;
          return;
        }
        if (spec.kind === 'radio') {
          const value = spec.values ?
            spec.values[String(item.value).trim().toLowerCase()] :
            String(item.value).trim();
          if (!value || (spec.allowedValues && spec.allowedValues.indexOf(value) === -1)) {
            throw new Error('value is not one of the form options');
          }
          const group = Array.from(document.querySelectorAll(
            '#' + spec.id + ' input[type="radio"]'));
          const selected = group.find(function (radio) { return radio.value === value; });
          if (!selected) throw new Error('matching radio option is not present');
          selected.checked = true;
          selected.dispatchEvent(new Event('change', { bubbles: true }));
          applied++;
          return;
        }
        if (spec.kind === 'select') {
          const value = String(item.value);
          if (!Array.from(element.options).some(function (option) {
            return option.value === value;
          })) throw new Error('value is not one of the form options');
          element.value = value;
          applied++;
          return;
        }
        if (spec.kind === 'category') {
          const value = String(item.value);
          if (!Array.from(element.options).some(function (option) {
            return option.value === value;
          })) throw new Error('category is not one of the form options');
          if (element.value !== value) {
            issues.push('Choose diagnosis category ' + value +
              ' in the NHI form, wait for its normal page refresh, then click Fill Form again.');
            return;
          }
          applied++;
          return;
        }
        if (spec.kind === 'diagnosis') {
          const option = findDiagnosisOption(element, item.value);
          if (!option) {
            throw new Error('ICD code is not available exactly once in the loaded dropdown; ' +
              'select the category in the NHI form and retry after its refresh');
          }
          element.value = option.value;
          applied++;
        }
      } catch (error) {
        issues.push(spec.id + ': ' + error.message);
      }
    });

    return { applied: applied, issues: issues };
  }

  function fillForm() {
    let state;
    try {
      state = getStoredState();
    } catch (error) {
      updatePanel(null);
      setStatus(error.message, 'error');
      return;
    }
    if (!state) {
      updatePanel(null);
      setStatus('Load a pending patient first.', 'error');
      return;
    }
    const result = applyPatient(state.patient);
    state.fillAttempted = result.applied > 0;
    try {
      storeState(state);
    } catch (error) {
      setStatus('Form values were set, but patient state could not be retained in this tab. ' +
        error.message, 'error');
      return;
    }
    updatePanel(state);
    if (result.issues.length) {
      const summary = result.applied > 0 ?
        'Filled ' + result.applied + ' field(s). ' :
        'No mapped fields were filled; Mark Complete remains disabled. ';
      setStatus(summary + 'Review: ' +
        result.issues.join(' | '), 'warning');
    } else if (result.applied === 0) {
      setStatus('No mapped form fields were filled. Mark Complete is disabled.', 'error');
    } else {
      setStatus('Filled ' + result.applied +
        ' field(s). Review the NHI form; it has not been saved or submitted.', 'success');
    }
  }

  async function markComplete() {
    const root = getPanel();
    const button = root.getElementById('complete');
    let state;
    try {
      state = getStoredState();
    } catch (error) {
      updatePanel(null);
      setStatus(error.message, 'error');
      return;
    }
    if (!state || !state.fillAttempted) {
      setStatus('Load a patient and use Fill Form before marking the record complete.', 'error');
      return;
    }
    const confirmed = window.confirm(
      'Mark row ' + state.patient.rowId + ' complete in the PHCEP Sheet? ' +
      'This does not save or submit the NHI form. Continue only after you have reviewed ' +
      'the form and completed any required manual NHI action.'
    );
    if (!confirmed) return;

    button.disabled = true;
    setStatus('Updating PHCEP workflow status…', 'info');
    try {
      const payload = await requestJson('POST', '/api/complete', {
        rowId: state.patient.rowId
      });
      if (!payload || payload.success !== true) {
        throw new Error(payload && typeof payload.error === 'string' ?
          'Patient API error: ' + payload.error : 'The patient API did not confirm completion.');
      }
      try {
        sessionStorage.removeItem(STATE_KEY);
      } catch (error) {
        updatePanel(null);
        setStatus('PHCEP confirmed completion, but this tab could not clear its cached patient. ' +
          'Close this tab to remove the temporary data.', 'warning');
        return;
      }
      updatePanel(null);
      setStatus('PHCEP row marked complete. The NHI form was not submitted by this script.',
        'success');
    } catch (error) {
      setStatus('Completion could not be confirmed. Verify the PHCEP row before retrying. ' +
        error.message, 'error');
      button.disabled = false;
    }
  }

  function extractPatient() {
    const patient = {};
    const issues = [];
    FIELD_SPECS.forEach(function(spec) {
      const element = document.getElementById(spec.id);
      if (!element || element.disabled || element.hidden || element.type === 'hidden' ||
          (element.closest && element.closest('[hidden]')) ||
          (element.getClientRects && element.getClientRects().length === 0) ||
          (typeof getComputedStyle === 'function' && getComputedStyle(element).display === 'none')) return;
      try {
        let value;
        if (spec.kind === 'radio') {
          const radio = Array.from(document.querySelectorAll('#' + spec.id + ' input[type="radio"]'))
            .find(function(item) { return item.checked && !item.disabled; });
          if (!radio) return;
          value = spec.values ? { 1: '男', 2: '女' }[radio.value] : radio.value;
          if (!value || (spec.allowedValues && !spec.allowedValues.includes(value))) {
            throw new Error('unrecognized radio option');
          }
        } else if (spec.kind === 'checkbox') {
          if (element.indeterminate) return;
          value = !!element.checked;
        } else {
          value = String(element.value || '').trim();
          if (!value) return;
          if (spec.kind === 'date') value = formatNhiDate(value);
          if (spec.kind === 'number') value = Number(validateNumber(value, spec));
          if (['select', 'category', 'diagnosis'].includes(spec.kind)) {
            const option = Array.from(element.options).find(function(item) {
              return item.value === String(element.value) && !item.disabled;
            });
            if (!option) throw new Error('selected option is unavailable');
            if (spec.kind === 'diagnosis') {
              const fromLabel = /^\s*([A-Z]\d[0-9A-Z](?:\.?[0-9A-Z]{1,4})?)(?=$|[\s:：(（-])/i
                .exec(option.textContent || '');
              const fromValue = /^[A-Z]\d[0-9A-Z](?:\.?[0-9A-Z]{1,4})?$/i.test(value);
              if (!fromLabel && !fromValue) throw new Error('cannot identify ICD code');
              value = (fromLabel ? fromLabel[1] : value).toUpperCase();
            } else if (!/^[1-4]$/.test(value) ||
                (spec.kind === 'select' && !['1', '2'].includes(value))) {
              throw new Error('unrecognized stage/category');
            }
          }
        }
        const path = spec.sources[0];
        if (path.length === 2) {
          patient[path[0]] = patient[path[0]] || {};
          patient[path[0]][path[1]] = value;
        } else {
          patient[path[0]] = value;
        }
      } catch (error) {
        issues.push(spec.id + ': ' + error.message);
      }
    });
    if (issues.length) throw new Error('Extraction needs review: ' + issues.join(' | '));
    if (typeof patient.patientId !== 'string' ||
        !/^[A-Z][A-Z0-9]\d{8}$/.test(patient.patientId.toUpperCase())) {
      throw new Error('Enter a patient ID before extracting. Other fields may be blank.');
    }
    patient.patientId = patient.patientId.toUpperCase();
    return patient;
  }

  let extractionRetry = null;
  async function saveExtractedPatient() {
    const button = getPanel().getElementById('extract');
    button.disabled = true;
    try {
      const patient = extractPatient();
      const fingerprint = JSON.stringify(patient);
      setStatus('Checking existing visits in the Sheet…', 'info');
      const preview = await requestJson('POST', '/api/preview', { patient: patient });
      if (!preview || preview.success !== true || typeof preview.previewToken !== 'string' ||
          !Number.isInteger(preview.existingCount)) throw new Error('Invalid extraction preview.');
      const reminder = preview.existingCount ?
        'Reminder: ' + preview.existingCount + ' existing record(s) for this patient.\n' +
        'Latest existing visit: ' + (preview.previousVisitDate || '(blank)') + '\n' +
        'Earliest visit / suggested enrollment: ' + (preview.suggestedEnrollmentDate || '(blank)') + '\n' +
        (preview.sameVisitExists ? 'A record already exists for this visit date.\n' : '') : 'No existing patient record.\n';
      if (!window.confirm(reminder + '\nSave the following as a NEW DRAFT row at the top?\n' +
          'Blank/missing fields stay blank; existing records are not changed.\n\n' +
          JSON.stringify(patient, null, 2))) {
        setStatus('Extraction cancelled; no Sheet row was saved.', 'info');
        return;
      }
      const useSuggested = !!preview.suggestedEnrollmentDate &&
        preview.suggestedEnrollmentDate !== patient.enrollmentDate &&
        window.confirm('Replace the extracted enrollment date (' + (patient.enrollmentDate || 'blank') +
          ') with the earliest visit date ' + preview.suggestedEnrollmentDate +
          ' on this NEW row?\nOK = use earliest visit. Cancel = keep extracted enrollment date.');
      const retryKey = fingerprint + ':' + useSuggested;
      if (!extractionRetry || extractionRetry.key !== retryKey) {
        extractionRetry = { key: retryKey, requestId: crypto.randomUUID() };
      }
      const result = await requestJson('POST', '/api/extract', {
        patient: patient, previewToken: preview.previewToken,
        useSuggestedEnrollmentDate: useSuggested, requestId: extractionRetry.requestId
      });
      if (!result || result.success !== true || !Number.isSafeInteger(result.rowId)) {
        throw new Error('The Sheet did not confirm the new row.');
      }
      extractionRetry = null;
      setStatus('Saved NEW DRAFT row ' + result.rowId +
        ' at the top of the Sheet. Review it before setting PENDING. NHI was not submitted.', 'success');
    } catch (error) {
      setStatus(error.message + ' If saving timed out, retry without changing the form to avoid duplicates.', 'error');
    } finally {
      button.disabled = false;
    }
  }

  function createPanel() {
    if (document.getElementById(PANEL_ID)) return;
    const host = document.createElement('div');
    host.id = PANEL_ID;
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        .panel {
          position: fixed; top: 84px; right: 18px; z-index: 2147483646;
          width: 310px; padding: 14px; box-sizing: border-box;
          color: #17212b; background: #fff; border: 1px solid #9aa8b5;
          border-radius: 9px; box-shadow: 0 5px 22px rgba(0,0,0,.24);
          font: 14px/1.45 Arial, "Microsoft JhengHei", sans-serif;
        }
        h2 { margin: 0 0 8px; font-size: 16px; }
        .patient { margin: 0 0 10px; overflow-wrap: anywhere; color: #334455; }
        .buttons { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; }
        button {
          min-height: 36px; border: 0; border-radius: 5px; padding: 7px 8px;
          color: #fff; background: #145da0; cursor: pointer;
          font: inherit; font-weight: 600;
        }
        button:last-child { grid-column: 1 / -1; background: #496273; }
        button:disabled { opacity: .48; cursor: not-allowed; }
        .status {
          margin: 10px 0 0; padding: 8px; border-radius: 5px;
          background: #eef3f7; overflow-wrap: anywhere; white-space: pre-wrap;
        }
        .status[data-kind="error"] { color: #8a1c1c; background: #fff0f0; }
        .status[data-kind="warning"] { color: #704b00; background: #fff6db; }
        .status[data-kind="success"] { color: #185b34; background: #eaf7ef; }
        .note { margin: 8px 0 0; color: #4a5966; font-size: 12px; }
      </style>
      <section class="panel" aria-label="PHCEP NHI patient assistant">
        <h2>NHI 高血脂表單助手</h2>
        <p class="patient" id="patient">No patient loaded.</p>
        <div class="buttons">
          <button type="button" id="load">Load Patient</button>
          <button type="button" id="fill" disabled>Fill Form</button>
          <button type="button" id="complete" disabled>Mark Complete</button>
          <button type="button" id="extract">Extract NHI → New Sheet Row</button>
        </div>
        <p class="status" id="status" role="status" aria-live="polite">
          Configure the Render endpoint and clinician token before use.
        </p>
        <p class="note">This assistant never clicks NHI save, clear, or submit controls.</p>
        <p class="note">Render authenticates the clinician before Google access. NHI VPN login alone does not authorize Render.</p>
        <p class="note">Prototype: a locally stored clinician token is accessible to anyone with this browser profile. Never embed Google credentials or backend secrets.</p>
      </section>`;
    document.body.appendChild(host);
    shadow.getElementById('load').addEventListener('click', loadPatient);
    shadow.getElementById('fill').addEventListener('click', fillForm);
    shadow.getElementById('complete').addEventListener('click', markComplete);
    shadow.getElementById('extract').addEventListener('click', saveExtractedPatient);

    let state = null;
    try {
      state = getStoredState();
    } catch (error) {
      setStatus(error.message, 'error');
    }
    updatePanel(state);
    GM_registerMenuCommand('Configure clinician token', configureToken);
    GM_registerMenuCommand('Forget clinician token and patient', function () {
      GM_deleteValue(TOKEN_KEY);
      sessionStorage.removeItem(STATE_KEY);
      extractionRetry = null;
      updatePanel(null);
      setStatus('Clinician token and temporary patient data cleared.', 'info');
    });
    if (CONFIG.apiBaseUrl.indexOf('REPLACE_RENDER_SERVICE') !== -1) {
      setStatus('Edit apiBaseUrl and @connect with your Render service hostname.',
        'warning');
    }
  }

  createPanel();
})();
