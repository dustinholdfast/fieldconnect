import { CONTACTS, PATHWAYS } from '../data.js';
import { esc } from '../html.js';
import { defaultOutcome, setState, state } from '../state.js';

let abort = null;

function selectedContact() {
  return CONTACTS[state.contactIdx] || CONTACTS[0];
}

export function derivedFrom(o) {
  const rev = (parseFloat(o.books || 0) * parseFloat(o.bookValue || 0)) +
              (parseFloat(o.seminars || 0) * parseFloat(o.semValue || 0));
  const journey = o.delivered === 'no' ? 'No-show recovery'
    : parseFloat(o.seminars || 0) > 0 ? 'DN Seminar buyer'
    : parseFloat(o.books || 0) > 0 ? 'Book buyer'
    : o.result === 'Not a fit' ? 'Interested but unqualified' : 'Completed, no book';
  return {
    status: o.delivered === 'no' ? 'No-show' : o.delivered === 'partial' ? 'Partial' : 'Completed',
    pathway: o.pathway || (o.ruinCat ? 'not selected' : '—'),
    revenue: '$' + (isNaN(rev) ? 0 : rev.toFixed(0)),
    journey,
    followup: o.next ? o.next + (o.due ? ' · ' + o.due : '') : 'none set',
    points: state.adapterOn ? '6 queued to API' : '6 queued to file export',
  };
}

export function updateOutcomeDerived(root = document) {
  const d = derivedFrom(state.o);
  const box = root.querySelector ? root.querySelector('#fc-derived') : document.getElementById('fc-derived');
  if (!box) return;
  const set = (key, value) => {
    const el = box.querySelector('[data-derived="' + key + '"]');
    if (el) el.textContent = value;
  };
  set('status', d.status);
  set('pathway', d.pathway);
  set('revenue', d.revenue);
  set('journey', d.journey);
  set('followup', d.followup);
  set('points', d.points);
}

export function toggleOutcomeSections(root, o = state.o) {
  const hideRuin = o.delivered === 'no';
  const hideProduct = o.delivered === 'no' || o.result === 'Not a fit';
  root.querySelector('#outcome-section-ruin')?.classList.toggle('hidden', hideRuin);
  root.querySelector('#outcome-section-product')?.classList.toggle('hidden', hideProduct);
  root.querySelector('#outcome-partial')?.classList.toggle('hidden', o.delivered !== 'partial');
}

function pathwayHtml(o) {
  const pathwayList = PATHWAYS[o.ruinCat] || [];
  if (!o.ruinCat) return '';
  let html = '<div class="fc-accent-panel"><div class="fc-section-title" style="margin-bottom:8px">Approved Dianetics pathway for “' + esc(o.ruinCat) + '”</div>' +
    '<p class="text-muted" style="font-size:12px;margin-bottom:12px">The system offers Church-approved options only; the FSM chooses; nothing is auto-recommended.</p>';
  pathwayList.forEach((p) => {
    html += '<div class="fc-pathway ' + (o.pathway === p[0] ? 'selected' : '') + '" data-pathway="' + esc(p[0]) + '">' +
      '<span>' + esc(p[0]) + '</span><span class="text-muted" style="font-size:12px">' + esc(p[1]) + '</span></div>';
  });
  html += '</div>';
  return html;
}

export function render(_route, current = state) {
  const o = current.o;
  const d = derivedFrom(o);
  const sel = selectedContact();
  const hideRuin = o.delivered === 'no';
  const hideProduct = o.delivered === 'no' || o.result === 'Not a fit';

  let html = '<div class="fc-two-col-outcome"><section class="fc-panel" style="padding:24px 26px">' +
    '<div style="display:flex;justify-content:space-between;align-items:baseline">' +
    '<h4 style="font-size:23px;margin:0">' + esc(sel.name) + '</h4>' +
    '<span class="text-muted" style="font-size:12.5px">27 Aug 2026 · Dianetics #47</span></div>' +
    '<hr class="hr" style="margin:14px 0" />' +
    '<div class="fc-section-title">Attendance & result</div>' +
    '<div class="fc-form-grid" style="margin-bottom:18px">' +
    '<div class="fc-field"><label>Interview delivered</label><select data-o="delivered">' +
    '<option value="yes"' + (o.delivered === 'yes' ? ' selected' : '') + '>Yes</option>' +
    '<option value="no"' + (o.delivered === 'no' ? ' selected' : '') + '>No — attendee not present</option>' +
    '<option value="partial"' + (o.delivered === 'partial' ? ' selected' : '') + '>Partial</option></select></div>' +
    '<div class="fc-field"><label for="outcome-duration">Actual duration (minutes)</label>' +
    '<input id="outcome-duration" type="text" data-o="duration" value="' + esc(o.duration) + '" /></div>' +
    '<div class="fc-field"><label>Appointment result</label><select data-o="result">' +
    '<option value="">—</option>' +
    ['Qualified', 'Follow-up required', 'Not a fit', 'Reschedule requested', 'Declined'].map((v) =>
      '<option value="' + v + '"' + (o.result === v ? ' selected' : '') + '>' + v + '</option>'
    ).join('') +
    '</select></div>' +
    '<div class="fc-field"><label>Preferred contact method</label><select data-o="channel">' +
    ['Email', 'Phone', 'WhatsApp', 'Signal'].map((v) =>
      '<option value="' + v + '"' + (o.channel === v ? ' selected' : '') + '>' + v + '</option>'
    ).join('') +
    '</select></div></div>' +
    '<div id="outcome-partial" class="fc-field' + (o.delivered === 'partial' ? '' : ' hidden') + '" style="margin-bottom:16px">' +
    '<label>Reason the interview was partial</label>' +
    '<input type="text" data-o="partialReason" value="' + esc(o.partialReason || '') + '" /></div>' +
    '<div id="outcome-section-ruin"' + (hideRuin ? ' class="hidden"' : '') + '>' +
    '<div class="fc-section-title">Ruin</div>' +
    '<div class="fc-form-grid" style="margin-bottom:10px">' +
    '<div class="fc-field"><label>Ruin category</label><select data-o="ruinCat">' +
    '<option value="">— select —</option>';
  Object.keys(PATHWAYS).forEach((k) => {
    html += '<option value="' + esc(k) + '"' + (o.ruinCat === k ? ' selected' : '') + '>' + esc(k) + '</option>';
  });
  html += '</select></div>' +
    '<div class="fc-field"><label>Desired improvement</label>' +
    '<input type="text" data-o="desired" value="' + esc(o.desired) + '" placeholder="In their words" /></div></div>' +
    '<div class="fc-field" style="margin-bottom:16px"><label>Notes — record what they said, not an interpretation</label>' +
    '<textarea data-o="ruinNotes" rows="2">' + esc(o.ruinNotes) + '</textarea></div>' +
    '<div id="outcome-pathways">' + pathwayHtml(o) + '</div></div>' +
    '<div id="outcome-section-product"' + (hideProduct ? ' class="hidden"' : '') + '>' +
    '<div class="fc-section-title" style="margin-top:18px">Product results</div>' +
    '<div class="fc-form-grid" style="margin-bottom:16px">' +
    '<div class="fc-field"><label>Books sold</label><input type="number" data-o="books" value="' + esc(o.books) + '" min="0" /></div>' +
    '<div class="fc-field"><label>Book value (USD)</label><input type="number" data-o="bookValue" value="' + esc(o.bookValue) + '" min="0" /></div>' +
    '<div class="fc-field"><label>DN Seminars sold</label><input type="number" data-o="seminars" value="' + esc(o.seminars) + '" min="0" /></div>' +
    '<div class="fc-field"><label>Seminar value (USD)</label><input type="number" data-o="semValue" value="' + esc(o.semValue) + '" min="0" /></div></div></div>' +
    '<div class="fc-section-title">Follow-up & qual</div>' +
    '<div class="fc-form-grid" style="margin-bottom:16px">' +
    '<div class="fc-field"><label>Next action</label><input type="text" data-o="next" value="' + esc(o.next) + '" /></div>' +
    '<div class="fc-field"><label>Due date</label><input type="date" data-o="due" value="' + esc(o.due) + '" /></div>' +
    '<div class="fc-field"><label>Objection category</label><select data-o="objection"><option value="">—</option>' +
    ['Cost', 'Time', 'Scepticism about results', 'Needs family agreement', 'Escalation needed'].map((v) =>
      '<option value="' + v + '"' + (o.objection === v ? ' selected' : '') + '>' + v + '</option>'
    ).join('') +
    '</select></div>' +
    '<div class="fc-field"><label>Success-story signal</label><select data-o="storySignal">' +
    ['No', 'Possible', 'Strong'].map((v) =>
      '<option value="' + v + '"' + (o.storySignal === v ? ' selected' : '') + '>' + v + '</option>'
    ).join('') +
    '</select></div></div>' +
    '<div class="fc-section-title">Consent</div>' +
    '<label class="fc-check"><input type="checkbox" data-o="consent0"' + (o.consent0 ? ' checked' : '') + ' /> Permission to contact for follow-up</label>' +
    '<label class="fc-check"><input type="checkbox" data-o="consent1"' + (o.consent1 ? ' checked' : '') + ' /> Permission to request a testimonial</label>' +
    '<label class="fc-check"><input type="checkbox" data-o="consent2"' + (o.consent2 ? ' checked' : '') + ' /> Permission to use the story publicly</label>' +
    '<div style="display:flex;gap:10px;margin-top:20px">' +
    '<button class="btn btn-primary" id="submit-outcome" type="button">Submit</button>' +
    '<button class="btn btn-secondary" id="reset-outcome" type="button">Clear</button></div>' +
    '<div id="outcome-submit-note" class="fc-submit-note ' + (current.submitted ? 'success' : '') + '">' +
    (current.submitted
      ? 'Submitted — appointment closed, follow-up task created, reporting queued.'
      : 'Mobile-friendly; may be completed on a phone straight after the interview.') +
    '</div></section>' +
    '<aside class="fc-derived" id="fc-derived"><div class="fc-section-title">Recorded on submit</div>' +
    '<div class="fc-derived-row"><span class="text-muted">Appointment status</span><span data-derived="status">' + esc(d.status) + '</span></div>' +
    '<div class="fc-derived-row"><span class="text-muted">Ruin → pathway</span><span data-derived="pathway">' + esc(d.pathway) + '</span></div>' +
    '<div class="fc-derived-row"><span class="text-muted">Revenue</span><span class="fc-tnum" data-derived="revenue">' + esc(d.revenue) + '</span></div>' +
    '<div class="fc-derived-row"><span class="text-muted">Journey entered</span><span data-derived="journey">' + esc(d.journey) + '</span></div>' +
    '<div class="fc-derived-row"><span class="text-muted">Follow-up task</span><span data-derived="followup">' + esc(d.followup) + '</span></div>' +
    '<div class="fc-derived-row"><span class="text-muted">MetaPulse points</span><span data-derived="points">' + esc(d.points) + '</span></div>' +
    '<hr class="hr" style="margin:14px 0" />' +
    '<p class="text-muted" style="font-size:12px">Preparation notes and an immutable audit statement are written on submit. Nothing is auto-recommended; the FSM retains control.</p>' +
    '</aside></div>';
  return html;
}

function patchO(key, value) {
  state.o = { ...state.o, [key]: value };
  state.submitted = false;
}

export function mount(el) {
  abort = new AbortController();
  const signal = abort.signal;
  el.addEventListener('input', (e) => {
    const field = e.target.closest('[data-o]');
    if (!field || field.type === 'checkbox' || field.tagName === 'SELECT') return;
    patchO(field.dataset.o, field.value);
    setState({});
    updateOutcomeDerived(el);
  }, { signal });
  el.addEventListener('change', (e) => {
    const field = e.target.closest('[data-o]');
    if (!field) return;
    const key = field.dataset.o;
    const value = field.type === 'checkbox' ? field.checked : field.value;
    patchO(key, value);
    setState({});
    if (key === 'delivered' || key === 'result' || key === 'ruinCat') {
      toggleOutcomeSections(el);
      if (key === 'ruinCat') {
        const box = el.querySelector('#outcome-pathways');
        if (box) box.innerHTML = pathwayHtml(state.o);
      }
    }
    updateOutcomeDerived(el);
  }, { signal });
  el.addEventListener('click', (e) => {
    const path = e.target.closest('[data-pathway]');
    if (path) {
      patchO('pathway', path.dataset.pathway);
      setState({});
      el.querySelectorAll('[data-pathway]').forEach((n) => {
        n.classList.toggle('selected', n.dataset.pathway === state.o.pathway);
      });
      updateOutcomeDerived(el);
      return;
    }
    if (e.target.closest('#submit-outcome')) {
      setState({ submitted: true });
      const note = el.querySelector('#outcome-submit-note');
      if (note) {
        note.classList.add('success');
        note.textContent = 'Submitted — appointment closed, follow-up task created, reporting queued.';
      }
      return;
    }
    if (e.target.closest('#reset-outcome')) {
      state.o = defaultOutcome();
      setState({ submitted: false }, { content: true });
    }
  }, { signal });
}

export function unmount() {
  abort?.abort();
  abort = null;
}
