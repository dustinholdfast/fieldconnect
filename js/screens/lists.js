import { apiJson } from '../api.js';
import { BAD, emptyPanel, esc, OK, statusColor, WARN } from '../html.js';
import { navigate } from '../router.js';
import { PERSON_FIELDS } from '../../shared/import/mapping.js';
import { setState, state } from '../state.js';

const MAPPING = [
  ['first_name', 'Karen', 'Contact · first name', 'Mapped', 'ok'],
  ['last_name', 'Iversen', 'Contact · last name', 'Mapped', 'ok'],
  ['e-mail', 'sample@example.test', 'Contact · email (match key)', 'Mapped', 'ok'],
  ['mobile', '555-0100', 'Contact · phone', 'Mapped', 'ok'],
  ['zip', '55403', 'Contact · postal code', 'Mapped', 'ok'],
  ['notes', 'Met at open house', 'Contact · source notes', 'Mapped', 'ok'],
  ['interest', 'DN book', 'Unmapped — ignore or create tag', 'Needs decision', 'warn'],
];

const IMPORTS = [
  ['spring-open-house-2026.csv', '16 Aug 2026', '1,284', '1,197', '19', 'Pending activation'],
  ['winter-list-2026.xlsx', '04 Feb 2026', '862', '791', '34', 'Active'],
  ['book-fair-signups.csv', '11 Nov 2025', '318', '288', '12', 'Active'],
  ['legacy-cards-2019.csv', '02 Sep 2025', '2,410', '0', '2,410', 'Rejected — no lawful basis'],
];

let abort = null;

const STEPS = ['Upload file', 'Map fields', 'Validate', 'Activate'];

const BASIS_OPTIONS = [
  { value: 'legitimate_interest_event', label: 'Legitimate interest — public event follow-up · opt-out respected' },
  { value: 'consent', label: 'Consent — explicit opt-in' },
];

function fmt(n) {
  return Number(n || 0).toLocaleString('en-US');
}

function formatUploaded(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso || '';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${Number(m[3])} ${months[Number(m[2]) - 1]} ${m[1]}`;
}

function currentImport() {
  return state.importCurrent;
}

function stepForStatus(status) {
  if (status === 'uploaded' || status === 'mapped') return 2;
  if (status === 'validated') return 3;
  if (status === 'active' || status === 'rejected') return 4;
  return 1;
}

function maxStepFor(imp) {
  if (!imp) return 1;
  if (imp.status === 'rejected' || imp.status === 'active') return 4;
  if (imp.status === 'validated') return 4;
  if (imp.status === 'mapped' || imp.status === 'uploaded') return 2;
  return 1;
}

function clampStep(step, imp) {
  const n = Math.max(1, Number(step) || 1);
  if (n === 1) return 1;
  return Math.min(n, maxStepFor(imp));
}

function mappingOf(imp) {
  return (imp && imp.mapping) || {};
}

function selectHtml(col, selected) {
  let html = '<select class="input" data-map-col="' + esc(col) + '" style="min-width:220px;font-size:13px">';
  PERSON_FIELDS.forEach((f) => {
    html += '<option value="' + esc(f.value) + '"' + (f.value === selected ? ' selected' : '') + '>' +
      esc(f.label) + '</option>';
  });
  html += '</select>';
  return html;
}

function mapStatus(field) {
  if (!field || field === 'ignore') return ['Needs decision', 'warn'];
  return ['Mapped', 'ok'];
}

function statsOf(imp) {
  return imp?.stats || {
    rowsRead: imp?.rowsRead || 0,
    valid: imp?.valid || 0,
    duplicates: imp?.duplicates || 0,
    suppressed: imp?.suppressed || 0,
    rejected: imp?.rejected || 0,
    peopleCreated: imp?.peopleCreated || 0,
    peopleMerged: imp?.peopleMerged || 0,
  };
}

function ownerLabel() {
  const user = state.user;
  if (!user) return '—';
  const role = user.role === 'admin' ? 'Platform administrator' : 'Campaign manager';
  return `${user.displayName} (${role})`;
}

function basisLabel(value) {
  return BASIS_OPTIONS.find((o) => o.value === value)?.label || value || '—';
}

function wizardStep1() {
  const msg = state.importMessage
    ? '<div class="text-muted" style="margin-top:12px;color:' + BAD + '">' + esc(state.importMessage) + '</div>'
    : '';
  return '<div class="fc-dropzone" id="import-drop" role="button" tabindex="0">' +
    '<div style="font-size:15px;margin-bottom:8px">Drop a CSV file here</div>' +
    '<div class="text-muted" style="font-size:13px">or click to browse · max 5 MB · 2,000 rows</div>' +
    '<input id="import-file" type="file" accept=".csv,text/csv" hidden />' +
    msg +
    '</div>' +
    '<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">' +
    '<button class="btn btn-primary" id="choose-csv" type="button">Choose CSV</button>' +
    '<a class="btn btn-secondary" href="/api/imports/template" download="fieldconnect-import-template.csv">Download template</a>' +
    '</div>' +
    '<p class="text-muted" style="font-size:12.5px;margin-top:12px">The template columns map automatically: first name, last name, email (match key), phone, postal code, notes, and tag. Replace the sample row before upload.</p>';
}

function wizardStep2(imp) {
  const columns = imp.columns || [];
  const samples = imp.samples || [];
  const mapping = mappingOf(imp);
  let html = '<table class="table" style="width:100%;font-size:13px;margin-bottom:16px"><thead><tr>' +
    '<th>Column in file</th><th>Sample value</th><th>Maps to</th><th>Status</th></tr></thead><tbody>';
  columns.forEach((col, i) => {
    const field = mapping[col] || 'ignore';
    const [label, tone] = mapStatus(field);
    const sample = samples[0] ? (samples[0][i] ?? '') : '';
    html += '<tr class="fc-row"><td class="fc-tnum">' + esc(col) + '</td><td>' + esc(sample) + '</td>' +
      '<td>' + selectHtml(col, field) + '</td>' +
      '<td><span style="color:' + statusColor(tone) + '">' + esc(label) + '</span></td></tr>';
  });
  html += '</tbody></table><div style="display:flex;gap:10px">' +
    '<button class="btn btn-secondary" id="prev-step" type="button">Back</button>' +
    '<button class="btn btn-primary" id="next-step" type="button">Continue to validation</button></div>';
  return html;
}

function wizardStep3(imp) {
  const stats = statsOf(imp);
  const vals = [
    [fmt(stats.rowsRead), 'Rows read', 'inherit'],
    [fmt(stats.valid), 'Valid contacts', OK],
    [fmt(stats.duplicates), 'Duplicates merged', WARN],
    [fmt(stats.suppressed), 'Suppressed (opted out)', WARN],
    [fmt(stats.rejected), 'Rejected — invalid email', BAD],
  ];
  const source = state.sourceLabel || imp.sourceLabel || '';
  const basis = state.lawfulBasis || imp.lawfulBasis || 'legitimate_interest_event';
  let html = '<div class="fc-val-grid">';
  vals.forEach((v) => {
    html += '<div class="fc-val-card"><div class="fc-val-n fc-tnum" style="color:' + v[2] + '">' + esc(v[0]) + '</div>' +
      '<div class="fc-val-label">' + esc(v[1]) + '</div></div>';
  });
  html += '</div><div class="fc-panel" style="margin-bottom:16px"><div class="fc-section-title">Lawful basis and labelling</div>' +
    '<div style="display:grid;grid-template-columns:160px 1fr;gap:10px;font-size:13px;margin-top:10px;align-items:center">' +
    '<label class="text-muted" for="import-source">Source label</label>' +
    '<input id="import-source" class="input" type="text" value="' + esc(source) + '" />' +
    '<span class="text-muted">List owner</span><span>' + esc(ownerLabel()) + '</span>' +
    '<label class="text-muted" for="import-basis">Communication basis</label>' +
    '<select id="import-basis" class="input">';
  BASIS_OPTIONS.forEach((o) => {
    html += '<option value="' + esc(o.value) + '"' + (o.value === basis ? ' selected' : '') + '>' +
      esc(o.label) + '</option>';
  });
  html += '</select></div></div>' +
    '<div style="display:flex;gap:10px"><button class="btn btn-secondary" id="prev-step" type="button">Back</button>' +
    '<button class="btn btn-primary" id="next-step" type="button">Continue to activate</button></div>';
  return html;
}

function wizardStep4(imp) {
  const stats = statsOf(imp);
  const active = imp.status === 'active';
  const rejected = imp.status === 'rejected';
  let body;
  if (rejected) {
    body = '<p style="font-size:14px;margin:10px 0">This import was rejected' +
      (stats.reason ? ' — ' + esc(stats.reason) : '') + '.</p>';
  } else if (active) {
    body = '<p style="font-size:14px;margin:10px 0">' +
      fmt(stats.peopleCreated || stats.valid) + ' contacts written. ' +
      fmt(stats.peopleMerged || stats.duplicates) + ' merged. ' +
      fmt(stats.suppressed) + ' suppressed. ' +
      fmt(stats.rejected) + ' rejected.</p>';
  } else {
    body = '<p style="font-size:14px;margin:10px 0">' +
      fmt(stats.valid) + ' valid contacts will enter the <strong>Div 6 lecture invitation</strong> journey. ' +
      fmt(stats.suppressed) + ' suppressed against global opt-out. ' +
      fmt(stats.rejected) + ' rejected for invalid email.</p>' +
      '<p class="text-muted" style="font-size:13px">Activation is irreversible for this import batch. You can still suppress individual contacts later.</p>';
  }
  const msg = state.importMessage
    ? '<p style="font-size:13px;color:' + (active ? OK : BAD) + '">' + esc(state.importMessage) + '</p>'
    : '';
  const busy = !!state.importBusy;
  const label = active ? 'Activated' : busy ? 'Activating…' : 'Activate list';
  const disabled = rejected || active || busy;
  return '<div class="fc-panel" style="margin-bottom:20px"><div class="fc-section-title">' +
    (active ? 'List activated' : rejected ? 'Import rejected' : 'Ready to activate') + '</div>' +
    body + msg + '</div>' +
    '<div style="display:flex;gap:10px"><button class="btn btn-secondary" id="prev-step" type="button">Back</button>' +
    '<button class="btn btn-primary" id="activate-list" type="button"' + (disabled ? ' disabled' : '') + '>' +
    label + '</button></div>';
}

function historyHtml(items, importId) {
  if (!items.length) return emptyPanel('No imports yet.');
  let html = '<table class="table" style="width:100%;font-size:13px"><thead><tr>' +
    '<th>File</th><th>Uploaded</th><th>Rows</th><th>Active</th><th>Suppressed</th><th>Status</th></tr></thead><tbody>';
  items.forEach((row) => {
    html += '<tr class="fc-row' + (row.id === importId ? ' selected' : '') +
      '" data-navigate="/lists/' + row.id + '" style="cursor:pointer">' +
      '<td>' + esc(row.filename) + '</td><td class="fc-tnum">' + esc(formatUploaded(row.uploadedAt)) + '</td>' +
      '<td class="fc-tnum">' + esc(fmt(row.rowsRead)) + '</td>' +
      '<td class="fc-tnum">' + esc(fmt(row.valid)) + '</td>' +
      '<td class="fc-tnum">' + esc(fmt(row.suppressed)) + '</td>' +
      '<td style="font-size:12.5px">' + esc(row.statusLabel || row.status) + '</td></tr>';
  });
  html += '</tbody></table>';
  return html;
}

export function render(route) {
  const importId = route?.params?.importId ? Number(route.params.importId) : null;
  const imp = currentImport();
  if (importId && state.importMissing && (!imp || imp.id !== importId)) {
    return emptyPanel('Import not found.');
  }

  let html = '<div class="fc-stepper">';
  STEPS.forEach((l, i) => {
    html += '<button type="button" class="fc-step ' + (state.uploadStep === i + 1 ? 'active' : '') +
      '" data-step="' + (i + 1) + '">' +
      '<div class="fc-step-num">Step ' + (i + 1) + '</div><div>' + esc(l) + '</div></button>';
  });
  html += '</div>';

  if (state.uploadStep === 1) html += wizardStep1();
  if (state.uploadStep === 2) html += imp ? wizardStep2(imp) : emptyPanel('Upload a CSV to map fields.');
  if (state.uploadStep === 3) html += imp ? wizardStep3(imp) : emptyPanel('Validate an uploaded import.');
  if (state.uploadStep === 4) html += imp ? wizardStep4(imp) : emptyPanel('Activate an uploaded import.');

  html += '<h4 style="margin:36px 0 12px">Import history</h4>';
  html += '<div id="import-history">' + historyHtml(state.importHistory || [], importId) + '</div>';
  return html;
}

function readMapping(el) {
  const mapping = {};
  el.querySelectorAll('[data-map-col]').forEach((sel) => {
    mapping[sel.dataset.mapCol] = sel.value;
  });
  return mapping;
}

async function savePatch(imp, body) {
  const { ok, data } = await apiJson('/api/imports/' + imp.id, {
    method: 'PATCH',
    body,
    silent: true,
  });
  if (ok && data) setState({ importCurrent: data });
  return { ok, data };
}

async function uploadFile(file) {
  if (!file) return;
  const form = new FormData();
  form.append('file', file, file.name);
  const { ok, status, data } = await apiJson('/api/imports', {
    method: 'POST',
    body: form,
    silent: true,
  });
  if (!ok) {
    const code = data?.error?.code;
    const message = code === 'unsupported_media'
      ? 'XLSX is not supported. Upload a CSV.'
      : code === 'import_row_limit'
        ? 'File exceeds 5 MB or 2,000 rows.'
        : (data?.error?.message || 'Could not upload file.');
    setState({ importMessage: message }, { content: true });
    return;
  }
  setState({
    importCurrent: data,
    importMissing: false,
    importMessage: null,
    uploadStep: 2,
    sourceLabel: state.sourceLabel,
    lawfulBasis: state.lawfulBasis || 'legitimate_interest_event',
  });
  navigate('/lists/' + data.id);
}

async function runValidate(el) {
  const imp = currentImport();
  if (!imp) return;
  const mapping = readMapping(el);
  const patched = await savePatch(imp, { mapping });
  if (!patched.ok) {
    setState({ importMessage: 'Could not save mapping.' }, { content: true });
    return;
  }
  const { ok, data } = await apiJson('/api/imports/' + imp.id + '/validate', {
    method: 'POST',
    body: {},
    silent: true,
  });
  if (!ok) {
    const msg = data?.error?.fields?.mapping || data?.error?.message || 'Could not validate import.';
    setState({ importMessage: msg }, { content: true });
    return;
  }
  const next = { ...state.importCurrent, status: 'validated', stats: data.stats };
  setState({ importCurrent: next, uploadStep: 3, importMessage: null }, { content: true });
}

async function goActivateStep(el) {
  const imp = currentImport();
  if (!imp) return;
  const sourceLabel = el.querySelector('#import-source')?.value?.trim() || '';
  const lawfulBasis = el.querySelector('#import-basis')?.value || '';
  if (!sourceLabel) {
    setState({ importMessage: 'Source label is required.', sourceLabel, lawfulBasis }, { content: true });
    return;
  }
  if (!lawfulBasis) {
    setState({ importMessage: 'Lawful basis is required.', sourceLabel, lawfulBasis }, { content: true });
    return;
  }
  const patched = await savePatch(imp, { sourceLabel, lawfulBasis });
  if (!patched.ok) {
    setState({ importMessage: 'Could not save lawful basis.', sourceLabel, lawfulBasis }, { content: true });
    return;
  }
  setState({ sourceLabel, lawfulBasis, uploadStep: 4, importMessage: null }, { content: true });
}

async function runActivate() {
  const imp = currentImport();
  if (!imp || imp.status === 'active' || imp.status === 'rejected' || state.importBusy) return;
  setState({ importBusy: true });
  const btn = document.getElementById('activate-list');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Activating…';
  }
  try {
    const { ok, data } = await apiJson('/api/imports/' + imp.id + '/activate', {
      method: 'POST',
      body: {},
      silent: true,
    });
    if (!ok) {
      const msg = data?.error?.fields?.sourceLabel
        || data?.error?.fields?.lawfulBasis
        || data?.error?.message
        || 'Could not activate import.';
      setState({ importBusy: false, importMessage: msg }, { content: true });
      return;
    }
    const next = {
      ...state.importCurrent,
      status: 'active',
      stats: data.stats,
      peopleCreated: data.peopleCreated,
      peopleMerged: data.peopleMerged,
    };
    setState({
      importCurrent: next,
      importBusy: false,
      uploadStep: 4,
      importMessage: `Activated — ${fmt(data.peopleCreated)} created, ${fmt(data.peopleMerged)} merged.`,
    }, { content: true });
    loadHistory();
  } catch {
    setState({ importBusy: false, importMessage: 'Could not activate import.' }, { content: true });
  }
}

async function loadHistory() {
  const { ok, data } = await apiJson('/api/imports', { silent: true });
  if (!ok || !data) return;
  setState({ importHistory: data.items || [] });
  const slot = document.querySelector('#import-history');
  const importId = state.route?.params?.importId ? Number(state.route.params.importId) : null;
  if (slot) slot.innerHTML = historyHtml(state.importHistory, importId);
}

async function loadImport(route) {
  const importId = route?.params?.importId ? Number(route.params.importId) : null;
  if (!importId) {
    if (state.importMissing) setState({ importMissing: false });
    return;
  }
  if (state.importCurrent?.id === importId && state.importCurrent.columns) return;
  const { ok, status, data } = await apiJson('/api/imports/' + importId, { silent: true });
  if (status === 404) {
    setState({ importCurrent: null, importMissing: true }, { content: true });
    return;
  }
  if (!ok || !data) return;
  setState({
    importCurrent: data,
    importMissing: false,
    uploadStep: stepForStatus(data.status),
    sourceLabel: data.sourceLabel || '',
    lawfulBasis: data.lawfulBasis || 'legitimate_interest_event',
  }, { content: true });
}

export function mount(el, route) {
  abort = new AbortController();
  const signal = abort.signal;
  loadHistory();
  loadImport(route);

  el.addEventListener('click', (e) => {
    const stepBtn = e.target.closest('[data-step]');
    if (stepBtn) {
      setState({ uploadStep: clampStep(stepBtn.dataset.step, currentImport()) }, { content: true });
      return;
    }
    if (e.target.closest('#choose-csv') || e.target.closest('#import-drop')) {
      if (e.target.closest('#import-file')) return;
      el.querySelector('#import-file')?.click();
      return;
    }
    if (e.target.closest('#next-step')) {
      if (state.uploadStep === 2) runValidate(el);
      else if (state.uploadStep === 3) goActivateStep(el);
      else setState({ uploadStep: Math.min(4, state.uploadStep + 1) }, { content: true });
      return;
    }
    if (e.target.closest('#prev-step')) {
      setState({ uploadStep: clampStep(state.uploadStep - 1, currentImport()) }, { content: true });
      return;
    }
    if (e.target.closest('#activate-list')) {
      runActivate();
    }
  }, { signal });

  el.addEventListener('change', (e) => {
    if (e.target.id === 'import-file') {
      uploadFile(e.target.files && e.target.files[0]);
      return;
    }
    if (e.target.dataset.mapCol) {
      const imp = currentImport();
      if (!imp) return;
      const mapping = { ...mappingOf(imp), [e.target.dataset.mapCol]: e.target.value };
      setState({ importCurrent: { ...imp, mapping } });
      const cell = e.target.closest('tr')?.querySelector('td:last-child span');
      if (cell) {
        const [label, tone] = mapStatus(e.target.value);
        cell.textContent = label;
        cell.style.color = statusColor(tone);
      }
      savePatch(imp, { mapping });
      return;
    }
    if (e.target.id === 'import-source') setState({ sourceLabel: e.target.value });
    if (e.target.id === 'import-basis') setState({ lawfulBasis: e.target.value });
  }, { signal });

  el.addEventListener('dragover', (e) => {
    if (!e.target.closest('#import-drop')) return;
    e.preventDefault();
  }, { signal });

  el.addEventListener('drop', (e) => {
    if (!e.target.closest('#import-drop')) return;
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0];
    if (file) uploadFile(file);
  }, { signal });
}

export function unmount() {
  abort?.abort();
  abort = null;
  if (state.importBusy) setState({ importBusy: false });
}
