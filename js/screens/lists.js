import { IMPORTS, MAPPING } from '../data.js';
import { BAD, emptyPanel, esc, OK, statusColor, WARN } from '../html.js';
import { setState, state } from '../state.js';

let abort = null;

export function render(route) {
  const steps = ['Upload file', 'Map fields', 'Validate', 'Activate'];
  const importId = route?.params?.importId ? Number(route.params.importId) : null;
  if (importId && (importId < 1 || importId > IMPORTS.length)) {
    return emptyPanel('Import not found.');
  }

  let html = '<div class="fc-stepper">';
  steps.forEach((l, i) => {
    html += '<button type="button" class="fc-step ' + (state.uploadStep === i + 1 ? 'active' : '') + '" data-step="' + (i + 1) + '">' +
      '<div class="fc-step-num">Step ' + (i + 1) + '</div><div>' + esc(l) + '</div></button>';
  });
  html += '</div>';

  if (state.uploadStep === 1) {
    html += '<div class="fc-dropzone"><div style="font-size:15px;margin-bottom:8px">Drop a CSV or XLSX file here</div>' +
      '<div class="text-muted" style="font-size:13px">or click to browse · max 50 MB</div>' +
      '<div style="margin-top:16px;font-size:13px">spring-open-house-2026.csv · 1,284 rows · 86 KB</div></div>' +
      '<button class="btn btn-primary" id="next-step" type="button">Continue to field mapping</button>';
  }
  if (state.uploadStep === 2) {
    html += '<table class="table" style="width:100%;font-size:13px;margin-bottom:16px"><thead><tr>' +
      '<th>Column in file</th><th>Sample value</th><th>Maps to</th><th>Status</th></tr></thead><tbody>';
    MAPPING.forEach((m) => {
      html += '<tr class="fc-row"><td class="fc-tnum">' + esc(m[0]) + '</td><td>' + esc(m[1]) + '</td>' +
        '<td>' + esc(m[2]) + '</td><td><span style="color:' + statusColor(m[4]) + '">' + esc(m[3]) + '</span></td></tr>';
    });
    html += '</tbody></table><div style="display:flex;gap:10px">' +
      '<button class="btn btn-secondary" id="prev-step" type="button">Back</button>' +
      '<button class="btn btn-primary" id="next-step" type="button">Continue to validation</button></div>';
  }
  if (state.uploadStep === 3) {
    const vals = [['1,284', 'Rows read', 'inherit'], ['1,197', 'Valid contacts', OK], ['62', 'Duplicates merged', WARN], ['19', 'Suppressed (opted out)', WARN], ['6', 'Rejected — invalid email', BAD]];
    html += '<div class="fc-val-grid">';
    vals.forEach((v) => {
      html += '<div class="fc-val-card"><div class="fc-val-n fc-tnum" style="color:' + v[2] + '">' + esc(v[0]) + '</div>' +
        '<div class="fc-val-label">' + esc(v[1]) + '</div></div>';
    });
    html += '</div><div class="fc-panel" style="margin-bottom:16px"><div class="fc-section-title">Lawful basis and labelling</div>' +
      '<div style="display:grid;grid-template-columns:120px 1fr;gap:8px;font-size:13px;margin-top:10px">' +
      '<span class="text-muted">Source label</span><span>Spring open house 2026 sign-up sheets</span>' +
      '<span class="text-muted">List owner</span><span>A. Reyes (Campaign manager)</span>' +
      '<span class="text-muted">Communication basis</span><span>Legitimate interest — public event follow-up · opt-out respected</span></div></div>' +
      '<div style="display:flex;gap:10px"><button class="btn btn-secondary" id="prev-step" type="button">Back</button>' +
      '<button class="btn btn-primary" id="next-step" type="button">Continue to activate</button></div>';
  }
  if (state.uploadStep === 4) {
    html += '<div class="fc-panel" style="margin-bottom:20px"><div class="fc-section-title">Ready to activate</div>' +
      '<p style="font-size:14px;margin:10px 0">1,197 valid contacts will enter the <strong>Div 6 lecture invitation</strong> journey. 19 suppressed against global opt-out. 6 rejected for invalid email.</p>' +
      '<p class="text-muted" style="font-size:13px">Activation is irreversible for this import batch. You can still suppress individual contacts later.</p></div>' +
      '<div style="display:flex;gap:10px"><button class="btn btn-secondary" id="prev-step" type="button">Back</button>' +
      '<button class="btn btn-primary" type="button">Activate list</button></div>';
  }

  html += '<h4 style="margin:36px 0 12px">Import history</h4>';
  if (IMPORTS.length === 0) {
    html += emptyPanel('No imports yet.');
  } else {
    html += '<table class="table" style="width:100%;font-size:13px"><thead><tr>' +
      '<th>File</th><th>Uploaded</th><th>Rows</th><th>Active</th><th>Suppressed</th><th>Status</th></tr></thead><tbody>';
    IMPORTS.forEach((row, i) => {
      const id = i + 1;
      html += '<tr class="fc-row' + (id === importId ? ' selected' : '') + '" data-navigate="/lists/' + id + '" style="cursor:pointer">' +
        '<td>' + esc(row[0]) + '</td><td class="fc-tnum">' + esc(row[1]) + '</td>' +
        '<td class="fc-tnum">' + esc(row[2]) + '</td><td class="fc-tnum">' + esc(row[3]) + '</td>' +
        '<td class="fc-tnum">' + esc(row[4]) + '</td><td style="font-size:12.5px">' + esc(row[5]) + '</td></tr>';
    });
    html += '</tbody></table>';
  }
  return html;
}

export function mount(el) {
  abort = new AbortController();
  const signal = abort.signal;
  el.addEventListener('click', (e) => {
    const step = e.target.closest('[data-step]');
    if (step) {
      setState({ uploadStep: +step.dataset.step }, { content: true });
      return;
    }
    if (e.target.closest('#next-step')) {
      setState({ uploadStep: Math.min(4, state.uploadStep + 1) }, { content: true });
      return;
    }
    if (e.target.closest('#prev-step')) {
      setState({ uploadStep: Math.max(1, state.uploadStep - 1) }, { content: true });
    }
  }, { signal });
}

export function unmount() {
  abort?.abort();
  abort = null;
}
