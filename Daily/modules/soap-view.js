/**
 * modules/soap-view.js
 * Displays all category SOAP templates and physical exam guides.
 *
 * Layout:
 *   - Floating draggable category buttons in a relative container
 *   - Active category shows S+O (left) and A+P (right) in a 2-column layout
 *   - "Recently Used Terms" is a fixed-position floating panel (draggable, resizable)
 *     that defaults to 2/3 viewport width
 *   - Each S/O/A/P ref-section is CSS-resizable (vertical)
 *   - Single global "Copy All Checked" button placed below "Insert All Checked"
 *     copies full text (including after ":") to clipboard
 *   - Single global "Insert All Checked" button inserts terms (before ":") to new entry
 */

import {
  getIcdData, getSoapTemplates, deleteSoapTemplate,
  navigate, esc, showToast, buildCombinedObjective, buildSectionedSoapInsert,
  getRecentSoapTerms, recordSoapItemWithSection,
  getShortcutKeys, matchShortcut, isTypingInput,
  getFloatPositions, initFloatPanel, initDraggableInContainer,
  saveFloatPanelState, getFloatPanelState,
} from '../app.js';

const CATS_AREA_HEIGHT_KEY = 'soap_cats_area_h';

export async function renderSoapView(opts = {  setupImmediateInsertion();
}


function setupImmediateInsertion() {
    const container = document.getElementById('quad-container');
    if (!container) return;

    container.addEventListener('change', (e) => {
        if (e.target.classList.contains('soap-view-cb') && e.target.checked) {
            const term = e.target.dataset.term;
            const soapTextarea = document.getElementById('quad-soap-input');
            if (soapTextarea && term) {
                const separator = soapTextarea.value ? '\n' : '';
                soapTextarea.value += separator + term;
                sessionStorage.setItem('quad_soap_note', soapTextarea.value);
            }
        }
    });
}
