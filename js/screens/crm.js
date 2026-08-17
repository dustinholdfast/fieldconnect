import { CONTACTS } from '../data.js';
import { emptyPanel, esc } from '../html.js';
import { navigate } from '../router.js';
import { setState, state } from '../state.js';

let searchTimer = null;
let abort = null;

function assignedName() {
  return state.user?.displayName || 'D. Whitfield';
}

export function visibleContacts() {
  const q = state.crmQuery.trim().toLowerCase();
  let visible = CONTACTS.map((c, i) => ({ c, i, id: i + 1 }))
    .filter((x) => state.stageFilter === 'All' || x.c.stage === state.stageFilter)
    .filter((x) => !q || (x.c.name + ' ' + x.c.email).toLowerCase().includes(q));
  if (state.role === 'fsm') {
    const name = assignedName();
    visible = visible.filter((x) => x.c.fsm === name);
  }
  return visible;
}

export function contactById(personId) {
  const idx = Number(personId) - 1;
  if (!Number.isInteger(idx) || idx < 0 || idx >= CONTACTS.length) return null;
  const c = CONTACTS[idx];
  if (state.role === 'fsm' && c.fsm !== assignedName()) return null;
  return { c, i: idx, id: idx + 1 };
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

function recordPanel(sel) {
  if (!sel) {
    return '<aside class="fc-panel" style="position:sticky;top:0">' +
      '<div class="fc-section-title">Contact record</div>' +
      emptyPanel('Person not found or not in your assignment set') +
      '</aside>';
  }
  let html = '<aside class="fc-panel" style="position:sticky;top:0">' +
    '<div class="fc-section-title">Contact record</div>' +
    '<h4 style="margin:6px 0 2px;font-size:22px">' + esc(sel.c.name) + '</h4>' +
    '<div class="text-muted" style="font-size:12.5px">' + esc(sel.c.email) + ' · ' + esc(sel.c.phone) + '</div>' +
    '<hr class="hr" style="margin:16px 0" />' +
    '<div style="display:grid;grid-template-columns:96px 1fr;gap:7px 12px;font-size:12.5px">' +
    '<span class="text-muted">Lifecycle</span><span>' + esc(sel.c.stage) + '</span>' +
    '<span class="text-muted">Source</span><span>' + esc(sel.c.source) + '</span>' +
    '<span class="text-muted">Ruin</span><span>' + esc(sel.c.ruin) + '</span>' +
    '<span class="text-muted">Assigned FSM</span><span>' + esc(sel.c.fsm) + '</span>' +
    '<span class="text-muted">Consent</span><span>' + esc(sel.c.consent) + '</span>' +
    '<span class="text-muted">Journey</span><span>' + esc(sel.c.journey) + '</span></div>' +
    '<hr class="hr" style="margin:16px 0" />' +
    '<div class="fc-section-title" style="margin-bottom:10px">Activity history</div>';
  sel.c.history.forEach((h) => {
    html += '<div class="fc-history-row"><span class="fc-history-date">' + esc(h[0]) + '</span><span>' + esc(h[1]) + '</span></div>';
  });
  html += '<div style="display:flex;gap:8px;margin-top:18px">' +
    '<button class="btn btn-primary" id="go-outcome">Open outcome form</button>' +
    '<button class="btn btn-secondary">Send link</button></div></aside>';
  return html;
}

function emptyRecord() {
  return '<aside class="fc-panel" style="position:sticky;top:0">' +
    '<div class="fc-section-title">Contact record</div>' +
    emptyPanel('Select a contact to view the record.') +
    '</aside>';
}

export function refreshCrmList(el, route) {
  const tbody = el.querySelector('#crm-tbody');
  const count = el.querySelector('#crm-count');
  const visible = visibleContacts();
  const selectedId = route?.params?.personId ? Number(route.params.personId) : null;
  if (count) count.textContent = visible.length + ' of ' + CONTACTS.length + ' contacts';
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

export function render(route) {
  const stages = ['All', 'Registered', 'Attended', 'Scheduled', 'Completed', 'No-show'];
  const visible = visibleContacts();
  const personId = route?.params?.personId;
  const sel = personId ? contactById(personId) : null;
  const selectedId = sel ? sel.id : null;

  let html = '<div class="fc-two-col"><section><div class="fc-toolbar">' +
    '<input id="crm-search" class="input fc-search" type="search" placeholder="Search name or email…" value="' + esc(state.crmQuery) + '" />' +
    '<div class="fc-seg">';
  stages.forEach((s) => {
    html += '<button class="fc-seg-btn ' + (s === state.stageFilter ? 'active' : '') + '" data-stage="' + esc(s) + '">' + esc(s) + '</button>';
  });
  html += '</div><div class="fc-count" id="crm-count">' + visible.length + ' of ' + CONTACTS.length + ' contacts</div></div>';
  html += '<div id="crm-empty" class="' + (visible.length ? 'hidden' : '') + '">' +
    emptyPanel('No contacts match this filter.') + '</div>';
  html += '<table id="crm-table" class="table' + (visible.length ? '' : ' hidden') + '" style="width:100%;font-size:13px"><thead><tr>' +
    '<th>Contact</th><th>Source</th><th>Last event</th><th>Stage</th><th>Consent</th><th>FSM</th></tr></thead>' +
    '<tbody id="crm-tbody">';
  visible.forEach((x) => { html += rowHtml(x, selectedId); });
  html += '</tbody></table></section>';
  if (personId) html += recordPanel(sel);
  else html += emptyRecord();
  html += '</div>';
  return html;
}

export function mount(el, route) {
  abort = new AbortController();
  const signal = abort.signal;
  const search = el.querySelector('#crm-search');
  search?.addEventListener('input', (e) => {
    setState({ crmQuery: e.target.value });
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => refreshCrmList(el, route), 200);
  }, { signal });
  el.addEventListener('click', (e) => {
    const stage = e.target.closest('[data-stage]');
    if (stage) {
      setState({ stageFilter: stage.dataset.stage }, { content: true });
      return;
    }
    const go = e.target.closest('#go-outcome');
    if (go) {
      const sel = route?.params?.personId ? contactById(route.params.personId) : null;
      if (sel) setState({ contactIdx: sel.i });
      navigate('/outcome');
    }
  }, { signal });
}

export function unmount() {
  clearTimeout(searchTimer);
  searchTimer = null;
  abort?.abort();
  abort = null;
}
