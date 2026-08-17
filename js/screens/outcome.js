import { apiJson } from '../api.js';
import { emptyPanel, esc } from '../html.js';
import { enqueue, removeQueued, startOutcomeFlush } from '../outcome/queue.js';
import { navigate } from '../router.js';
import { defaultOutcome, setState, state } from '../state.js';
import { validateOutcome } from '../../shared/outcome/validate.js';

const RUINS = [
  'Relationships / family',
  'Work & livelihood',
  'Health & well-being',
  'Grief or loss',
  'Stress & anxiety',
  'Study / learning',
  'Purpose & direction',
];
const RESULTS = ['Qualified', 'Follow-up required', 'Not a fit', 'Reschedule requested', 'Declined'];
const CHANNELS = ['Email', 'Phone', 'WhatsApp', 'Signal'];
const OFFLINE_NOTE = 'Saved on this device — will send when online';

let abort = null;

function mintClientId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const n = Math.random() * 16 | 0;
    const v = ch === 'x' ? n : (n & 0x3) | 0x8;
    return v.toString(16);
  });
}

function dollars(cents) {
  const n = Number(cents) || 0;
  return (n / 100).toFixed(n % 100 === 0 ? 0 : 2);
}

function tzAbbr(tz) {
  if (tz === 'America/New_York') return 'ET';
  if (tz === 'America/Los_Angeles') return 'PT';
  return 'CT';
}

function formatWhen(iso, tz) {
  if (!iso) return '';
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: tz || 'America/Chicago',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(iso)) + ' ' + tzAbbr(tz);
  } catch {
    return iso;
  }
}

function hydrateLineItems(catalog, existing) {
  return (catalog || []).map((p) => {
    const prev = (existing || []).find((item) => item.productId === p.id);
    return prev || {
      productId: p.id,
      sku: p.sku,
      name: p.name,
      kind: p.kind,
      qty: 0,
      listPriceCents: p.listPriceCents,
      unitPriceCents: p.listPriceCents,
      overrideOpen: false,
      overrideReason: '',
    };
  });
}

function bindFromAppointment(appt, catalog) {
  const next = defaultOutcome();
  next.appointmentId = appt?.id ?? null;
  next.lineItems = hydrateLineItems(catalog || [], state.o?.lineItems);
  if (appt?.status === 'Partial') {
    next.delivered = 'partial';
    next.duration = appt.actualDurationMin != null ? String(appt.actualDurationMin) : '';
    next.partialReason = appt.partialReason || '';
  }
  return next;
}

export function derivedFrom(o, catalog = state.outcomeCatalog, pathways = state.outcomePathways) {
  const checked = validateOutcome({
    ...o,
    appointmentId: o.appointmentId ?? 0,
    clientId: o.clientId || 'preview',
  }, catalog || [], pathways || []);
  const d = checked.derived;
  return {
    status: d.status,
    pathway: d.pathway,
    revenue: d.revenue,
    journey: d.journey,
    followup: d.followup,
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
  const hideProduct = o.delivered === 'no' || o.delivered === 'partial' || o.result === 'Not a fit';
  root.querySelector('#outcome-section-ruin')?.classList.toggle('hidden', hideRuin);
  root.querySelector('#outcome-section-product')?.classList.toggle('hidden', hideProduct);
  root.querySelector('#outcome-partial')?.classList.toggle('hidden', o.delivered !== 'partial');
}

function pathwayItemsFor(ruinCat, items) {
  return (items || []).filter((p) => p.ruinCategory === ruinCat);
}

function pathwayHtml(o, items = state.outcomePathways) {
  if (!o.ruinCat) return '';
  const list = pathwayItemsFor(o.ruinCat, items);
  let html = '<div class="fc-accent-panel"><div class="fc-section-title" style="margin-bottom:8px">Approved Dianetics pathway for “' +
    esc(o.ruinCat) + '”</div>' +
    '<p class="text-muted" style="font-size:12px;margin-bottom:12px">The system offers Church-approved options only; the FSM chooses; nothing is auto-recommended.</p>';
  list.forEach((p) => {
    html += '<div class="fc-pathway ' + (o.pathway === p.label ? 'selected' : '') +
      '" data-pathway="' + esc(p.label) + '">' +
      '<span>' + esc(p.label) + '</span><span class="text-muted" style="font-size:12px">' +
      esc(p.detail || '') + '</span></div>';
  });
  html += '</div>';
  return html;
}

function lineItemsHtml(o) {
  let html = '';
  (o.lineItems || []).forEach((item) => {
    html += '<div class="fc-line-item" data-product-id="' + item.productId + '">' +
      '<div class="fc-qty">' +
        '<button type="button" data-qty="-1" aria-label="Decrease">−</button>' +
        '<span class="fc-tnum" data-qty-value>' + esc(item.qty) + '</span>' +
        '<button type="button" data-qty="1" aria-label="Increase">+</button>' +
      '</div>' +
      '<span>' + esc(item.name) + '</span>' +
      '<span class="fc-tnum">$' + esc(dollars(item.unitPriceCents)) + '</span>' +
      '<button type="button" class="btn btn-secondary" data-override>Override</button>' +
    '</div>';
    if (item.overrideOpen) {
      html += '<div class="fc-override" data-product-id="' + item.productId + '">' +
        '<div class="fc-field"><label>Unit price (USD)</label>' +
          '<input type="number" min="0" step="0.01" data-line="unitPrice" value="' +
          esc(dollars(item.unitPriceCents)) + '" /></div>' +
        '<div class="fc-field"><label>Override reason</label>' +
          '<input type="text" data-line="overrideReason" value="' +
          esc(item.overrideReason || '') + '" /></div>' +
      '</div>';
    }
  });
  return html;
}

function fieldError(errors, key) {
  if (!errors || !errors[key]) return '';
  return '<div class="fc-field-error" data-error="' + esc(key) + '">' + esc(errors[key]) + '</div>';
}

function pickerHtml(items) {
  if (!items || items.length === 0) {
    return '<section class="fc-panel">' +
      '<h3>Select an appointment</h3>' +
      emptyPanel('No interviews need an outcome form.') +
      '<p><a href="/scheduling">← Schedule</a></p>' +
    '</section>';
  }
  let html = '<section class="fc-panel">' +
    '<h3>Select an appointment</h3>' +
    '<p class="text-muted">Interviews that still need an outcome form</p>' +
    '<ul class="fc-outcome-picker">';
  items.forEach((a) => {
    html += '<li><a href="/outcome/' + a.id + '">' +
      '<strong>' + esc(a.personName) + '</strong>' +
      '<span>' + esc(formatWhen(a.startAt, a.timezone) + ' · ' + (a.event || '—') + ' · ' + a.status) +
      '</span></a></li>';
  });
  return html + '</ul></section>';
}

function formHtml(current) {
  const o = current.o;
  const d = derivedFrom(o);
  const appt = current.outcomeAppointment;
  const hideRuin = o.delivered === 'no';
  const hideProduct = o.delivered === 'no' || o.delivered === 'partial' || o.result === 'Not a fit';
  const errors = current.outcomeErrors || {};
  const name = appt?.personName || 'Interview';
  const meta = appt
    ? formatWhen(appt.startAt, appt.timezone) + ' · ' + (appt.event || '')
    : '';

  let html = '<div class="fc-two-col-outcome"><section class="fc-panel" style="padding:24px 26px">' +
    '<div style="display:flex;justify-content:space-between;align-items:baseline">' +
    '<h4 style="font-size:23px;margin:0">' + esc(name) + '</h4>' +
    '<span class="text-muted" style="font-size:12.5px">' + esc(meta) + '</span></div>' +
    '<hr class="hr" style="margin:14px 0" />' +
    '<div class="fc-section-title">Attendance & result</div>' +
    '<div class="fc-form-grid" style="margin-bottom:18px">' +
    '<div class="fc-field"><label>Interview delivered</label><select data-o="delivered">' +
    '<option value="yes"' + (o.delivered === 'yes' ? ' selected' : '') + '>Yes</option>' +
    '<option value="no"' + (o.delivered === 'no' ? ' selected' : '') + '>No — attendee not present</option>' +
    '<option value="partial"' + (o.delivered === 'partial' ? ' selected' : '') + '>Partial</option></select></div>' +
    '<div class="fc-field"><label for="outcome-duration">Actual duration (minutes)</label>' +
    '<input id="outcome-duration" type="text" data-o="duration" value="' + esc(o.duration) + '" />' +
    fieldError(errors, 'duration') + '</div>' +
    '<div class="fc-field"><label>Appointment result</label><select data-o="result">' +
    '<option value="">—</option>' +
    RESULTS.map((v) =>
      '<option value="' + v + '"' + (o.result === v ? ' selected' : '') + '>' + v + '</option>'
    ).join('') +
    '</select>' + fieldError(errors, 'result') + '</div>' +
    '<div class="fc-field"><label>Preferred contact method</label><select data-o="channel">' +
    CHANNELS.map((v) =>
      '<option value="' + v + '"' + (o.channel === v ? ' selected' : '') + '>' + v + '</option>'
    ).join('') +
    '</select></div></div>' +
    '<div id="outcome-partial" class="fc-field' + (o.delivered === 'partial' ? '' : ' hidden') + '" style="margin-bottom:16px">' +
    '<label>Reason the interview was partial</label>' +
    '<input type="text" data-o="partialReason" value="' + esc(o.partialReason || '') + '" />' +
    fieldError(errors, 'partialReason') + '</div>' +
    '<div id="outcome-section-ruin"' + (hideRuin ? ' class="hidden"' : '') + '>' +
    '<div class="fc-section-title">Ruin</div>' +
    '<div class="fc-form-grid" style="margin-bottom:10px">' +
    '<div class="fc-field"><label>Ruin category</label><select data-o="ruinCat">' +
    '<option value="">— select —</option>';
  RUINS.forEach((k) => {
    html += '<option value="' + esc(k) + '"' + (o.ruinCat === k ? ' selected' : '') + '>' + esc(k) + '</option>';
  });
  html += '</select></div>' +
    '<div class="fc-field"><label>Desired improvement</label>' +
    '<input type="text" data-o="desired" value="' + esc(o.desired) + '" placeholder="In their words" /></div></div>' +
    '<div id="outcome-pathways">' + pathwayHtml(o, current.outcomePathways) + '</div>' +
    fieldError(errors, 'pathway') + '</div>' +
    '<div id="outcome-notes" class="fc-field" style="margin-bottom:16px">' +
    '<label>Notes — record what they said, not an interpretation</label>' +
    '<textarea data-o="ruinNotes" rows="2">' + esc(o.ruinNotes) + '</textarea></div>' +
    '<div id="outcome-section-product"' + (hideProduct ? ' class="hidden"' : '') + '>' +
    '<div class="fc-section-title" style="margin-top:18px">Product results</div>' +
    '<div id="outcome-line-items" style="margin-bottom:16px">' + lineItemsHtml(o) + '</div>' +
    fieldError(errors, 'overrideReason') +
    fieldError(errors, 'lineItems') + '</div>' +
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
    '<label class="fc-check"><input type="checkbox" data-consent="followup"' +
      (o.consents?.followup ? ' checked' : '') + ' /> Permission to contact for follow-up</label>' +
    '<label class="fc-check"><input type="checkbox" data-consent="testimonial"' +
      (o.consents?.testimonial ? ' checked' : '') + ' /> Permission to request a testimonial</label>' +
    '<label class="fc-check"><input type="checkbox" data-consent="publicStory"' +
      (o.consents?.publicStory ? ' checked' : '') + ' /> Permission to use the story publicly</label>' +
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

export function render(route, current = state) {
  const appointmentId = route?.params?.appointmentId;
  if (!appointmentId && Array.isArray(current.outcomePicker)) {
    return pickerHtml(current.outcomePicker);
  }
  return formHtml(current);
}

function patchO(partial) {
  state.o = { ...state.o, ...partial };
  state.submitted = false;
}

function patchLine(productId, mutate) {
  state.o = {
    ...state.o,
    lineItems: (state.o.lineItems || []).map((item) => (
      item.productId === productId ? mutate({ ...item }) : item
    )),
  };
  state.submitted = false;
}

function showNote(el, text, kind) {
  const note = el.querySelector('#outcome-submit-note');
  if (!note) return;
  note.textContent = text;
  note.className = 'fc-submit-note' + (kind ? ' ' + kind : '');
}

function showErrors(el, errors) {
  el.querySelectorAll('[data-error]').forEach((n) => n.remove());
  Object.entries(errors || {}).forEach(([key, message]) => {
    const field = el.querySelector(
      key === 'duration' ? '#outcome-duration' :
      key === 'partialReason' ? '[data-o="partialReason"]' :
      key === 'result' ? '[data-o="result"]' :
      key === 'pathway' ? '#outcome-pathways' :
      key === 'overrideReason' ? '#outcome-line-items' :
      key === 'lineItems' ? '#outcome-line-items' : null,
    );
    const host = field?.closest('.fc-field') || field?.parentElement || el.querySelector('#outcome-submit-note');
    if (!host) return;
    const div = document.createElement('div');
    div.className = 'fc-field-error';
    div.dataset.error = key;
    div.textContent = message;
    host.appendChild(div);
  });
}

function payloadFrom(o) {
  return {
    clientId: o.clientId,
    appointmentId: o.appointmentId,
    delivered: o.delivered,
    durationMin: o.duration === '' ? null : Number(o.duration),
    partialReason: o.partialReason || null,
    result: o.result || null,
    channel: o.channel,
    ruinCategory: o.ruinCat || null,
    desired: o.desired || null,
    ruinNotes: o.ruinNotes || null,
    pathwayLabel: o.pathway || null,
    objection: o.objection || null,
    storySignal: o.storySignal,
    nextAction: o.next || null,
    nextDue: o.due || null,
    consents: {
      followup: !!o.consents?.followup,
      testimonial: !!o.consents?.testimonial,
      publicStory: !!o.consents?.publicStory,
    },
    lineItems: (o.lineItems || [])
      .filter((item) => (Number(item.qty) || 0) > 0)
      .map((item) => ({
        productId: item.productId,
        qty: item.qty,
        unitPriceCents: item.unitPriceCents,
        overrideReason: item.overrideReason || null,
      })),
  };
}

async function submitOutcome(el) {
  if (!state.o.appointmentId) {
    showNote(el, 'Select an appointment first.', 'bad');
    return;
  }
  if (!state.o.clientId) patchO({ clientId: mintClientId() });
  const checked = validateOutcome(state.o, state.outcomeCatalog || [], state.outcomePathways || []);
  if (!checked.ok) {
    showErrors(el, checked.errors);
    showNote(el, 'Fix the highlighted fields before submitting.', 'bad');
    return;
  }
  const payload = payloadFrom(state.o);
  const queued = {
    clientId: payload.clientId,
    appointmentId: payload.appointmentId,
    payload,
    createdAt: new Date().toISOString(),
    attempts: 0,
    lastError: null,
  };
  try {
    const { ok, status, data } = await apiJson('/api/outcomes', {
      method: 'POST',
      body: payload,
      headers: { 'Idempotency-Key': payload.clientId },
      silent: true,
    });
    if (ok && (status === 200 || status === 201)) {
      await removeQueued(payload.clientId);
      state.submitted = true;
      const closed = data?.appointment?.status;
      const isPartial = closed === 'Partial' || data?.outcome == null;
      const msg = isPartial
        ? 'Saved as Partial — finish the outcome form when the interview is complete.'
        : 'Submitted — appointment closed, follow-up task created, reporting queued.';
      showNote(el, msg, 'success');
      if (data?.appointment) state.outcomeAppointment = { ...state.outcomeAppointment, ...data.appointment };
      // Completing yes/no must not replay the Partial idempotency key.
      if (isPartial) patchO({ clientId: null });
      updateOutcomeDerived(el);
      return;
    }
    if (status === 400 || status === 403 || status === 404 || status === 409) {
      await removeQueued(payload.clientId);
      if (status === 400 && data?.error?.fields) {
        showErrors(el, data.error.fields);
        showNote(el, 'Fix the highlighted fields before submitting.', 'bad');
        return;
      }
      showNote(el, data?.error?.message || 'Could not submit this outcome.', 'bad');
      return;
    }
    await enqueue(queued);
    showNote(el, OFFLINE_NOTE);
  } catch {
    await enqueue(queued);
    showNote(el, OFFLINE_NOTE);
  }
}

function paintLineItems(el) {
  const box = el.querySelector('#outcome-line-items');
  if (box) box.innerHTML = lineItemsHtml(state.o);
}

async function loadBound(el, route, signal) {
  const id = Number(route.params.appointmentId);
  const [one, cat, paths] = await Promise.all([
    apiJson('/api/appointments/' + id, { silent: true, signal }),
    apiJson('/api/catalog', { silent: true, signal }),
    apiJson('/api/pathways', { silent: true, signal }),
  ]);
  if (signal.aborted) return;
  if (!one.ok || !one.data) {
    el.innerHTML = emptyPanel('Appointment not found or not in your assignment set');
    return;
  }
  const catalog = one.ok ? (cat.data?.items || []) : [];
  const pathways = paths.ok ? (paths.data?.items || []) : [];
  const same = state.outcomeAppointment?.id === id && state.o.appointmentId === id;
  const nextO = same ? { ...state.o, lineItems: hydrateLineItems(catalog, state.o.lineItems) }
    : bindFromAppointment(one.data, catalog);
  setState({
    outcomeAppointment: one.data,
    outcomeCatalog: catalog,
    outcomePathways: pathways,
    outcomePicker: null,
    o: nextO,
  }, { content: true });
}

async function loadPicker(signal) {
  const { ok, data } = await apiJson('/api/appointments?filter=needs_outcome', { silent: true, signal });
  if (signal.aborted) return;
  const items = (ok ? (data.items || []) : []).slice().sort((a, b) => {
    const cmp = String(b.startAt || '').localeCompare(String(a.startAt || ''));
    return cmp !== 0 ? cmp : (b.id - a.id);
  });
  if (items.length === 1) {
    navigate('/outcome/' + items[0].id, { replace: true });
    return;
  }
  setState({ outcomePicker: items, outcomeAppointment: null }, { content: true });
}

export function mount(el, route) {
  abort = new AbortController();
  const signal = abort.signal;
  startOutcomeFlush();

  const appointmentId = route?.params?.appointmentId;
  // Tests and first paint have no session; do not fetch (happy-dom has no API).
  if (state.user) {
    if (appointmentId) {
      if (state.outcomeAppointment?.id !== Number(appointmentId) || !state.outcomeCatalog) {
        loadBound(el, route, signal).catch(() => {
          if (!signal.aborted) el.innerHTML = emptyPanel('Could not load this appointment.');
        });
      }
    } else if (!Array.isArray(state.outcomePicker)) {
      loadPicker(signal).catch(() => {
        if (!signal.aborted) setState({ outcomePicker: [] }, { content: true });
      });
    }
  }

  el.addEventListener('input', (e) => {
    const line = e.target.closest('[data-line]');
    if (line) {
      const wrap = e.target.closest('[data-product-id]');
      const productId = Number(wrap?.dataset.productId);
      if (line.dataset.line === 'unitPrice') {
        const cents = Math.round(Number(line.value) * 100);
        patchLine(productId, (item) => {
          item.unitPriceCents = Number.isFinite(cents) ? cents : item.listPriceCents;
          return item;
        });
      } else if (line.dataset.line === 'overrideReason') {
        patchLine(productId, (item) => {
          item.overrideReason = line.value;
          return item;
        });
      }
      setState({});
      updateOutcomeDerived(el);
      return;
    }
    const field = e.target.closest('[data-o]');
    if (!field || field.type === 'checkbox' || field.tagName === 'SELECT') return;
    patchO({ [field.dataset.o]: field.value });
    setState({});
    updateOutcomeDerived(el);
  }, { signal });

  el.addEventListener('change', (e) => {
    const consent = e.target.closest('[data-consent]');
    if (consent) {
      patchO({
        consents: { ...state.o.consents, [consent.dataset.consent]: consent.checked },
      });
      setState({});
      updateOutcomeDerived(el);
      return;
    }
    const field = e.target.closest('[data-o]');
    if (!field) return;
    const key = field.dataset.o;
    const value = field.type === 'checkbox' ? field.checked : field.value;
    patchO({ [key]: value });
    // New delivered mode is a new submit, not a replay of a queued Partial.
    if (key === 'delivered') patchO({ clientId: null });
    setState({});
    if (key === 'delivered' || key === 'result' || key === 'ruinCat') {
      toggleOutcomeSections(el);
      if (key === 'ruinCat') {
        patchO({ pathway: '' });
        const box = el.querySelector('#outcome-pathways');
        if (box) box.innerHTML = pathwayHtml(state.o, state.outcomePathways);
      }
    }
    updateOutcomeDerived(el);
  }, { signal });

  el.addEventListener('click', (e) => {
    const path = e.target.closest('[data-pathway]');
    if (path) {
      patchO({ pathway: path.dataset.pathway });
      setState({});
      el.querySelectorAll('[data-pathway]').forEach((n) => {
        n.classList.toggle('selected', n.dataset.pathway === state.o.pathway);
      });
      updateOutcomeDerived(el);
      return;
    }
    const qtyBtn = e.target.closest('[data-qty]');
    if (qtyBtn) {
      const wrap = qtyBtn.closest('[data-product-id]');
      const productId = Number(wrap?.dataset.productId);
      const delta = Number(qtyBtn.dataset.qty);
      patchLine(productId, (item) => {
        item.qty = Math.max(0, (Number(item.qty) || 0) + delta);
        return item;
      });
      paintLineItems(el);
      setState({});
      updateOutcomeDerived(el);
      return;
    }
    if (e.target.closest('[data-override]')) {
      const wrap = e.target.closest('[data-product-id]');
      const productId = Number(wrap?.dataset.productId);
      patchLine(productId, (item) => {
        item.overrideOpen = !item.overrideOpen;
        return item;
      });
      paintLineItems(el);
      setState({});
      updateOutcomeDerived(el);
      return;
    }
    if (e.target.closest('#submit-outcome')) {
      submitOutcome(el);
      return;
    }
    if (e.target.closest('#reset-outcome')) {
      const catalog = state.outcomeCatalog || [];
      const appt = state.outcomeAppointment;
      state.o = bindFromAppointment(appt, catalog);
      setState({ submitted: false, outcomeErrors: null }, { content: true });
    }
  }, { signal });
}

export function unmount() {
  abort?.abort();
  abort = null;
}
