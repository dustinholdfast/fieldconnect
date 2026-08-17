import { apiJson } from '../api.js';
import { emptyPanel, esc } from '../html.js';
import { navigate } from '../router.js';
import { setState, state } from '../state.js';

const STAGES = ['All', 'Registered', 'Attended', 'Scheduled', 'Completed', 'No-show'];
const PERSON_STAGES = ['Registered', 'Attended', 'Scheduled', 'Completed', 'No-show', 'Interested', 'Not a fit'];
const SOURCES = ['Meetup', 'Div 6 list', 'Referral', 'Social (SCN group)', 'Other'];
const RUINS = [
  'Relationships / family',
  'Work & livelihood',
  'Health & well-being',
  'Grief or loss',
  'Stress & anxiety',
  'Study / learning',
  'Purpose & direction',
];
const EMAIL_RE = /^\S+@\S+\.\S+$/;

let searchTimer = null;
let mergeTimer = null;
let abort = null;
let mergeChoice = null;

function canCreate() {
  return state.role === 'manager' || state.role === 'admin';
}

function canMerge() {
  return canCreate();
}

function digitsOnly(value) {
  return String(value ?? '').replace(/\D/g, '');
}

function shortDate(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso || '';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${Number(m[3])} ${months[Number(m[2]) - 1]}`;
}

function asContact(p) {
  const history = (p.history || []).map((h) => [shortDate(h.at), h.text]);
  return {
    name: p.displayName,
    email: p.email || '',
    phone: p.phone || '',
    source: p.source || '—',
    event: p.event || '—',
    stage: p.stage || '',
    consent: p.consent || '—',
    fsm: p.fsm || '—',
    ruin: p.ruin || '—',
    journey: p.journey || '—',
    history,
  };
}

export function visibleContacts() {
  return (state.crmPeople || []).map((p, i) => ({
    c: asContact(p),
    i,
    id: p.id,
    person: p,
  }));
}

export function contactById(personId) {
  const id = Number(personId);
  if (!Number.isInteger(id)) return null;
  const p = state.crmSelected?.id === id
    ? state.crmSelected
    : (state.crmPeople || []).find((x) => x.id === id);
  if (!p) return null;
  return { c: asContact(p), i: 0, id: p.id, person: p };
}

function selectedPerson(route) {
  const pid = route?.params?.personId ? Number(route.params.personId) : null;
  if (!pid) return { pid: null, person: null, missing: false, loading: false };
  const fromSel = state.crmSelected?.id === pid ? state.crmSelected : null;
  const fromList = (state.crmPeople || []).find((p) => p.id === pid) || null;
  const person = fromSel || fromList;
  const missing = !person && state.crmSelected === null;
  const loading = !person && !missing;
  return { pid, person, missing, loading };
}

function rowHtml(x, selectedId) {
  return '<tr class="fc-row ' + (x.id === selectedId ? 'selected' : '') +
    '" data-navigate="/crm/' + x.id + '" style="cursor:pointer">' +
    '<td><div>' + esc(x.c.name) + '</div><div class="text-muted" style="font-size:11.5px">' + esc(x.c.email) + '</div></td>' +
    '<td style="font-size:12.5px">' + esc(x.c.source) + '</td>' +
    '<td style="font-size:12.5px">' + esc(x.c.event) + '</td>' +
    '<td><span class="tag tag-outline" style="font-size:11px">' + esc(x.c.stage) + '</span></td>' +
    '<td style="font-size:12.5px">' + esc(x.c.consent) + '</td>' +
    '<td style="font-size:12.5px">' + esc(x.c.fsm) + '</td></tr>';
}

function historyRows(person) {
  const history = person.history || [];
  if (!history.length) return '<div class="text-muted" style="font-size:12.5px">No activity yet.</div>';
  return history.map((h) => (
    '<div class="fc-history-row"><span class="fc-history-date">' + esc(shortDate(h.at)) +
    '</span><span>' + esc(h.text) + '</span></div>'
  )).join('');
}

function recordPanel(sel) {
  const { person, missing, loading, pid } = sel;
  if (!pid) {
    return '<aside class="fc-panel" style="position:sticky;top:0">' +
      '<div class="fc-section-title">Contact record</div>' +
      emptyPanel('Select a contact to view the record.') +
      '</aside>';
  }
  if (loading) {
    return '<aside class="fc-panel" style="position:sticky;top:0" id="crm-record">' +
      '<div class="fc-section-title">Contact record</div>' +
      emptyPanel('Loading contact…') +
      '</aside>';
  }
  if (missing || !person) {
    return '<aside class="fc-panel" style="position:sticky;top:0" id="crm-record">' +
      '<div class="fc-section-title">Contact record</div>' +
      emptyPanel('Person not found or not in your assignment set') +
      '</aside>';
  }
  const c = asContact(person);
  const note = state.crmNote
    ? '<div id="crm-note" class="fc-note ' + esc(state.crmNote.kind || '') + '">' + esc(state.crmNote.message) + '</div>'
    : '<div id="crm-note" class="fc-note hidden"></div>';
  let html = '<aside class="fc-panel" style="position:sticky;top:0" id="crm-record">' +
    '<div class="fc-section-title">Contact record</div>' +
    '<h4 style="margin:6px 0 2px;font-size:22px">' + esc(c.name) + '</h4>' +
    '<div class="text-muted" style="font-size:12.5px">' + esc(c.email) + ' · ' + esc(c.phone) + '</div>' +
    '<hr class="hr" style="margin:16px 0" />' +
    '<div style="display:grid;grid-template-columns:96px 1fr;gap:7px 12px;font-size:12.5px">' +
    '<span class="text-muted">Lifecycle</span><span>' + esc(c.stage) + '</span>' +
    '<span class="text-muted">Source</span><span>' + esc(c.source) + '</span>' +
    '<span class="text-muted">Ruin</span><span>' + esc(c.ruin) + '</span>' +
    '<span class="text-muted">Assigned FSM</span><span>' + esc(c.fsm) + '</span>' +
    '<span class="text-muted">Consent</span><span>' + esc(c.consent) + '</span>' +
    '<span class="text-muted">Journey</span><span>' + esc(c.journey) + '</span></div>' +
    '<hr class="hr" style="margin:16px 0" />' +
    '<div class="fc-section-title" style="margin-bottom:10px">Activity history</div>' +
    historyRows(person) +
    '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:18px">' +
    '<button class="btn btn-primary" id="go-outcome" type="button">Open outcome form</button>' +
    '<button class="btn btn-secondary" id="send-link" type="button">Send link</button>' +
    '<button class="btn btn-secondary" id="crm-edit" type="button">Edit</button>';
  if (canMerge()) {
    html += '<button class="btn btn-secondary" id="crm-merge" type="button">Merge into…</button>';
  }
  html += '</div>' + note + '</aside>';
  return html;
}

function optionsHtml(values, selected, blank) {
  let html = blank != null ? '<option value="">' + esc(blank) + '</option>' : '';
  values.forEach((v) => {
    html += '<option value="' + esc(v) + '"' + (v === selected ? ' selected' : '') + '>' + esc(v) + '</option>';
  });
  return html;
}

function fsmOptions(selected, current) {
  const selectedId = selected != null && selected !== '' ? Number(selected) : null;
  const seen = new Set();
  const rows = [];
  (state.crmFsms || []).forEach((f) => {
    if (seen.has(f.id)) return;
    seen.add(f.id);
    rows.push({ id: f.id, displayName: f.displayName, active: f.active !== false });
  });
  // Seed assigns heroes to inactive FSMs (Lindgren / Okonjo); keep that option so Edit does not snap to "—".
  if (selectedId && !seen.has(selectedId)) {
    const name = current?.displayName || current?.fsm || 'Assigned FSM';
    rows.push({ id: selectedId, displayName: name, active: false });
  }
  let html = '<option value="">—</option>';
  rows.forEach((f) => {
    const label = f.active ? f.displayName : f.displayName + ' (inactive)';
    html += '<option value="' + f.id + '"' + (selectedId === f.id ? ' selected' : '') + '>' +
      esc(label) + '</option>';
  });
  return html;
}

function field(name, label, control, error) {
  return '<div class="fc-field">' +
    '<label for="crm-f-' + name + '">' + esc(label) + '</label>' +
    control +
    (error ? '<div class="fc-field-error">' + esc(error) + '</div>' : '') +
    '</div>';
}

function drawerHtml() {
  return '<div id="crm-drawer" class="dialog-backdrop hidden" hidden>' +
    '<form class="dialog fc-drawer" id="crm-form">' +
      '<div class="dialog-title" id="crm-drawer-title">New contact</div>' +
      field('firstName', 'First name', '<input id="crm-f-firstName" class="input" name="firstName" type="text" required />') +
      field('lastName', 'Last name', '<input id="crm-f-lastName" class="input" name="lastName" type="text" required />') +
      field('email', 'Email', '<input id="crm-f-email" class="input" name="email" type="email" />') +
      field('phone', 'Phone', '<input id="crm-f-phone" class="input" name="phone" type="tel" />') +
      field('source', 'Source', '<select id="crm-f-source" class="input" name="source" required>' + optionsHtml(SOURCES, 'Meetup') + '</select>') +
      field('postalCode', 'Postal code', '<input id="crm-f-postalCode" class="input" name="postalCode" type="text" />') +
      field('stage', 'Stage', '<select id="crm-f-stage" class="input" name="stage">' + optionsHtml(PERSON_STAGES, 'Registered') + '</select>') +
      field('ruinCategory', 'Ruin category', '<select id="crm-f-ruinCategory" class="input" name="ruinCategory">' + optionsHtml(RUINS, '', '—') + '</select>') +
      field('fsmUserId', 'Assigned FSM', '<select id="crm-f-fsmUserId" class="input" name="fsmUserId">' + fsmOptions(null) + '</select>') +
      '<div id="crm-form-error" class="fc-note bad hidden"></div>' +
      '<div class="dialog-actions">' +
        '<button type="button" class="btn btn-secondary" id="crm-cancel">Cancel</button>' +
        '<button type="submit" class="btn btn-primary" id="crm-save">Save</button>' +
      '</div>' +
    '</form></div>' +
    '<div id="crm-merge-drawer" class="dialog-backdrop hidden" hidden>' +
      '<div class="dialog fc-drawer">' +
        '<div class="dialog-title">Merge into…</div>' +
        '<p class="dialog-body">Choose the surviving contact. This record is merged away.</p>' +
        '<div class="fc-field"><label for="crm-merge-q">Search</label>' +
          '<input id="crm-merge-q" class="input" type="search" placeholder="Name, email, or phone" /></div>' +
        '<div id="crm-merge-results" class="fc-merge-results"></div>' +
        '<div id="crm-merge-error" class="fc-note bad hidden"></div>' +
        '<div class="dialog-actions">' +
          '<button type="button" class="btn btn-secondary" id="crm-merge-cancel">Cancel</button>' +
          '<button type="button" class="btn btn-primary" id="crm-merge-confirm" disabled>Merge</button>' +
        '</div>' +
      '</div></div>';
}

export function refreshCrmList(el, route) {
  const tbody = el.querySelector('#crm-tbody');
  const count = el.querySelector('#crm-count');
  const visible = visibleContacts();
  const selectedId = route?.params?.personId ? Number(route.params.personId) : null;
  if (count) count.textContent = visible.length + ' of ' + (state.crmTotal || visible.length) + ' contacts';
  if (!tbody) return;
  if (visible.length === 0) {
    tbody.innerHTML = '';
    const table = el.querySelector('#crm-table');
    const empty = el.querySelector('#crm-empty');
    if (table) table.classList.add('hidden');
    if (empty) empty.classList.remove('hidden');
    return;
  }
  const table = el.querySelector('#crm-table');
  const empty = el.querySelector('#crm-empty');
  if (table) table.classList.remove('hidden');
  if (empty) empty.classList.add('hidden');
  tbody.innerHTML = visible.map((x) => rowHtml(x, selectedId)).join('');
}

function paintRecord(el, route) {
  const host = el.querySelector('#crm-record-slot');
  if (!host) return;
  host.innerHTML = recordPanel(selectedPerson(route));
}

function peopleQuery() {
  const params = new URLSearchParams();
  const q = state.crmQuery.trim();
  if (q) params.set('q', q);
  if (state.stageFilter && state.stageFilter !== 'All') params.set('stage', state.stageFilter);
  params.set('limit', '50');
  return '/api/people?' + params.toString();
}

async function loadList(el, route, signal) {
  try {
    const { ok, data } = await apiJson(peopleQuery(), { silent: true, signal });
    if (signal?.aborted) return;
    if (!ok || !data) return;
    setState({ crmPeople: data.items || [], crmTotal: data.total || 0, crmFsms: data.fsms || [] });
    refreshCrmList(el, route);
    const fsm = el.querySelector('#crm-f-fsmUserId');
    if (fsm && document.activeElement !== fsm) {
      const selectedLabel = fsm.selectedOptions[0]?.textContent || '';
      fsm.innerHTML = fsmOptions(fsm.value, {
        displayName: selectedLabel.replace(/\s*\(inactive\)\s*$/, ''),
      });
    }
  } catch {
    if (signal?.aborted) return;
  }
}

async function loadPerson(el, route, signal) {
  const pid = route?.params?.personId ? Number(route.params.personId) : null;
  if (!pid) {
    setState({ crmSelected: null });
    paintRecord(el, route);
    return;
  }
  try {
    const { ok, status, data } = await apiJson('/api/people/' + pid, { silent: true, signal });
    if (signal?.aborted) return;
    if (status === 404 || !ok) {
      setState({ crmSelected: null, crmNote: null });
    } else {
      setState({ crmSelected: data, crmNote: null });
    }
    paintRecord(el, route);
  } catch {
    if (signal?.aborted) return;
  }
}

function openDrawer(el, mode, person) {
  const drawer = el.querySelector('#crm-drawer');
  const form = el.querySelector('#crm-form');
  const title = el.querySelector('#crm-drawer-title');
  const fsmField = el.querySelector('#crm-f-fsmUserId');
  if (!drawer || !form) return;
  form.dataset.mode = mode;
  form.dataset.id = person ? String(person.id) : '';
  form.dataset.fsmUserId = person?.fsmUserId != null ? String(person.fsmUserId) : '';
  title.textContent = mode === 'edit' ? 'Edit contact' : 'New contact';
  form.firstName.value = person?.firstName || '';
  form.lastName.value = person?.lastName || '';
  form.email.value = person?.email || '';
  form.phone.value = person?.phone || '';
  form.source.value = person?.source && SOURCES.includes(person.source) ? person.source : 'Meetup';
  form.postalCode.value = person?.postalCode || '';
  form.stage.value = person?.stage && PERSON_STAGES.includes(person.stage) ? person.stage : 'Registered';
  form.ruinCategory.value = person?.ruinCategory || '';
  if (fsmField) {
    fsmField.innerHTML = fsmOptions(person?.fsmUserId, person);
    fsmField.disabled = state.role === 'fsm';
    const wrap = fsmField.closest('.fc-field');
    if (wrap) wrap.classList.toggle('hidden', state.role === 'fsm');
  }
  const err = el.querySelector('#crm-form-error');
  if (err) {
    err.textContent = '';
    err.classList.add('hidden');
  }
  drawer.classList.remove('hidden');
  drawer.hidden = false;
  form.firstName.focus();
}

function closeDrawer(el) {
  const drawer = el.querySelector('#crm-drawer');
  if (!drawer) return;
  drawer.classList.add('hidden');
  drawer.hidden = true;
}

function openMerge(el) {
  mergeChoice = null;
  const drawer = el.querySelector('#crm-merge-drawer');
  const q = el.querySelector('#crm-merge-q');
  const results = el.querySelector('#crm-merge-results');
  const confirm = el.querySelector('#crm-merge-confirm');
  const err = el.querySelector('#crm-merge-error');
  if (!drawer) return;
  if (q) q.value = '';
  if (results) results.innerHTML = '';
  if (confirm) confirm.disabled = true;
  if (err) {
    err.textContent = '';
    err.classList.add('hidden');
  }
  drawer.classList.remove('hidden');
  drawer.hidden = false;
  q?.focus();
}

function closeMerge(el) {
  const drawer = el.querySelector('#crm-merge-drawer');
  if (!drawer) return;
  drawer.classList.add('hidden');
  drawer.hidden = true;
  mergeChoice = null;
}

function setNote(el, message, kind) {
  setState({ crmNote: message ? { message, kind } : null });
  const note = el.querySelector('#crm-note');
  if (!note) return;
  if (!message) {
    note.textContent = '';
    note.className = 'fc-note hidden';
    return;
  }
  note.textContent = message;
  note.className = 'fc-note ' + (kind || '');
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch { /* ignore */ }
    ta.remove();
    return true;
  }
}

function readForm(form) {
  const data = {
    firstName: String(form.firstName.value || '').trim(),
    lastName: String(form.lastName.value || '').trim(),
    email: String(form.email.value || '').trim(),
    phone: String(form.phone.value || '').trim(),
    source: String(form.source.value || '').trim(),
    postalCode: String(form.postalCode.value || '').trim(),
    stage: String(form.stage.value || '').trim(),
    ruinCategory: String(form.ruinCategory.value || '').trim() || null,
  };
  if (state.role !== 'fsm') {
    const raw = form.fsmUserId.value;
    const next = raw ? Number(raw) : null;
    if (form.dataset.mode === 'edit') {
      const prev = form.dataset.fsmUserId ? Number(form.dataset.fsmUserId) : null;
      // Omit unless changed so a missing inactive-FSM option cannot unassign on Save.
      if (next !== prev) data.fsmUserId = next;
    } else if (next != null) {
      data.fsmUserId = next;
    }
  }
  return data;
}

function clientErrors(data) {
  const fields = {};
  if (!data.firstName) fields.firstName = 'First name is required';
  if (!data.lastName) fields.lastName = 'Last name is required';
  if (data.email && !EMAIL_RE.test(data.email)) fields.email = 'Enter a valid email';
  if (data.phone && digitsOnly(data.phone).length < 10) fields.phone = 'Phone must have at least 10 digits';
  if (!data.source) fields.source = 'Source is required';
  if (!data.email && !data.phone) {
    fields.email = fields.email || 'Email or phone is required';
    fields.phone = fields.phone || 'Email or phone is required';
  }
  return fields;
}

async function savePerson(el, form) {
  const data = readForm(form);
  const err = el.querySelector('#crm-form-error');
  const fields = clientErrors(data);
  if (Object.keys(fields).length) {
    if (err) {
      err.textContent = Object.values(fields)[0];
      err.classList.remove('hidden');
    }
    return;
  }
  const mode = form.dataset.mode;
  const id = form.dataset.id;
  const path = mode === 'edit' ? '/api/people/' + id : '/api/people';
  const method = mode === 'edit' ? 'PATCH' : 'POST';
  const { ok, status, data: body } = await apiJson(path, { method, body: data, silent: true });
  if (!ok) {
    const message = status === 409
      ? (body?.error?.message || 'That email is already in use.')
      : (body?.error?.fields && Object.values(body.error.fields)[0]) || 'Could not save contact.';
    if (err) {
      err.textContent = message;
      err.classList.remove('hidden');
    }
    return;
  }
  closeDrawer(el);
  navigate('/crm/' + body.id);
}

async function runMergeSearch(el, q) {
  const results = el.querySelector('#crm-merge-results');
  const confirm = el.querySelector('#crm-merge-confirm');
  if (!results) return;
  const selfId = state.crmSelected?.id;
  const { ok, data } = await apiJson('/api/people?q=' + encodeURIComponent(q) + '&limit=20', { silent: true });
  if (!ok || !data) return;
  const items = (data.items || []).filter((p) => p.id !== selfId);
  if (!items.length) {
    results.innerHTML = '<div class="text-muted" style="padding:8px 10px">No matching people.</div>';
    mergeChoice = null;
    if (confirm) confirm.disabled = true;
    return;
  }
  results.innerHTML = items.map((p) => (
    '<button type="button" class="fc-merge-row" data-merge-id="' + p.id + '">' +
      '<strong>' + esc(p.displayName) + '</strong>' +
      '<div class="text-muted" style="font-size:12px">' + esc(p.email || p.phone || '') + ' · ' + esc(p.stage) + '</div>' +
    '</button>'
  )).join('');
}

async function confirmMerge(el) {
  const err = el.querySelector('#crm-merge-error');
  const loserId = state.crmSelected?.id;
  if (!mergeChoice || !loserId) return;
  const { ok, data } = await apiJson('/api/people/' + mergeChoice + '/merge', {
    method: 'POST',
    body: { loserId },
    silent: true,
  });
  if (!ok) {
    if (err) {
      err.textContent = data?.error?.message || 'Could not merge contacts.';
      err.classList.remove('hidden');
    }
    return;
  }
  closeMerge(el);
  navigate('/crm/' + mergeChoice);
}

async function sendLink(el, route) {
  const pid = route?.params?.personId;
  if (!pid) return;
  const { ok, status, data } = await apiJson('/api/people/' + pid + '/send-link', {
    method: 'POST',
    body: {},
    silent: true,
  });
  if (status === 409 && data?.error?.code === 'suppressed') {
    setNote(el, 'Cannot send a link — this contact is suppressed.', 'bad');
    return;
  }
  if (!ok || !data?.offerUrl) {
    setNote(el, 'Could not send the scheduling link.', 'bad');
    return;
  }
  await copyText(data.offerUrl);
  setNote(el, 'Offer link copied: ' + data.offerUrl, 'ok');
}

export function render(route) {
  const visible = visibleContacts();
  const sel = selectedPerson(route);
  const selectedId = sel.pid;

  let html = '<div class="fc-two-col"><section><div class="fc-toolbar">' +
    '<input id="crm-search" class="input fc-search" type="search" placeholder="Search name, email, or phone…" value="' + esc(state.crmQuery) + '" />' +
    '<div class="fc-seg">';
  STAGES.forEach((s) => {
    html += '<button class="fc-seg-btn ' + (s === state.stageFilter ? 'active' : '') + '" data-stage="' + esc(s) + '" type="button">' + esc(s) + '</button>';
  });
  html += '</div><div class="fc-count" id="crm-count">' + visible.length + ' of ' + (state.crmTotal || visible.length) + ' contacts</div>';
  if (canCreate()) {
    html += '<button class="btn btn-primary" id="crm-new" type="button">New contact</button>';
  }
  html += '</div>';
  html += '<div id="crm-empty" class="' + (visible.length ? 'hidden' : '') + '">' +
    emptyPanel('No contacts match this filter.') + '</div>';
  html += '<table id="crm-table" class="table' + (visible.length ? '' : ' hidden') + '" style="width:100%;font-size:13px"><thead><tr>' +
    '<th>Contact</th><th>Source</th><th>Last event</th><th>Stage</th><th>Consent</th><th>FSM</th></tr></thead>' +
    '<tbody id="crm-tbody">';
  visible.forEach((x) => { html += rowHtml(x, selectedId); });
  html += '</tbody></table></section>';
  html += '<div id="crm-record-slot">' + recordPanel(sel) + '</div>';
  html += '</div>' + drawerHtml();
  return html;
}

export function mount(el, route) {
  abort = new AbortController();
  const signal = abort.signal;
  mergeChoice = null;
  loadList(el, route, signal);
  loadPerson(el, route, signal);

  const search = el.querySelector('#crm-search');
  search?.addEventListener('input', (e) => {
    setState({ crmQuery: e.target.value });
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => loadList(el, route, signal), 200);
  }, { signal });

  el.addEventListener('click', (e) => {
    const stage = e.target.closest('[data-stage]');
    if (stage) {
      setState({ stageFilter: stage.dataset.stage }, { content: true });
      return;
    }
    if (e.target.closest('#crm-new')) {
      openDrawer(el, 'create', null);
      return;
    }
    if (e.target.closest('#crm-edit')) {
      const person = state.crmSelected || selectedPerson(route).person;
      if (person) openDrawer(el, 'edit', person);
      return;
    }
    if (e.target.closest('#crm-cancel') || (e.target.id === 'crm-drawer')) {
      closeDrawer(el);
      return;
    }
    if (e.target.closest('#crm-merge')) {
      openMerge(el);
      return;
    }
    if (e.target.closest('#crm-merge-cancel') || e.target.id === 'crm-merge-drawer') {
      closeMerge(el);
      return;
    }
    const pick = e.target.closest('[data-merge-id]');
    if (pick) {
      mergeChoice = Number(pick.dataset.mergeId);
      el.querySelectorAll('.fc-merge-row').forEach((n) => n.classList.toggle('selected', n === pick));
      const confirm = el.querySelector('#crm-merge-confirm');
      if (confirm) confirm.disabled = false;
      return;
    }
    if (e.target.closest('#crm-merge-confirm')) {
      confirmMerge(el);
      return;
    }
    if (e.target.closest('#send-link')) {
      sendLink(el, route);
      return;
    }
    if (e.target.closest('#go-outcome')) {
      const sel = selectedPerson(route);
      if (sel.person) setState({ contactIdx: 0 });
      navigate('/outcome');
    }
  }, { signal });

  el.querySelector('#crm-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    savePerson(el, e.target);
  }, { signal });

  el.querySelector('#crm-merge-q')?.addEventListener('input', (e) => {
    const q = e.target.value.trim();
    clearTimeout(mergeTimer);
    mergeTimer = setTimeout(() => {
      if (q) runMergeSearch(el, q);
    }, 200);
  }, { signal });
}

export function unmount() {
  clearTimeout(searchTimer);
  clearTimeout(mergeTimer);
  searchTimer = null;
  mergeTimer = null;
  abort?.abort();
  abort = null;
}
