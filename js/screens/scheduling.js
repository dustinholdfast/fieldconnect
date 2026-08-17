import { apiJson } from '../api.js';
import { emptyPanel, esc, statusColor } from '../html.js';
import { navigate } from '../router.js';
import { state } from '../state.js';

let abort = null;
let searchTimer = null;
let pickerStart = null;
let pickerPerson = null;
let pickerDuration = 45;

function formatExpires(iso) {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function formatWhen(iso, tz) {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: tz || 'America/Chicago',
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function tzAbbr(tz) {
  if (tz === 'America/New_York') return 'ET';
  if (tz === 'America/Los_Angeles') return 'PT';
  return 'CT';
}

function apptTone(status) {
  if (status === 'Confirmed' || status === 'Completed') return 'ok';
  if (status === 'Booked' || status === 'Reminder due' || status === 'Partial') return 'warn';
  if (status === 'No-show' || status === 'Cancelled') return 'bad';
  if (status === 'Offered') return 'accent';
  return '';
}

function slotLabel(hour) {
  const h = Number(hour);
  const shown = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return shown + ':00';
}

function dayHead(dateStr) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return names[wd] + ' ' + d;
}

function rateLabel(rate) {
  if (rate == null || Number.isNaN(Number(rate))) return '—';
  return Math.round(Number(rate) * 100) + '%';
}

function isFsm() {
  return state.role === 'fsm';
}

function canPickFsm() {
  return state.role === 'manager' || state.role === 'admin';
}

function offerPanel(data, error) {
  if (error) {
    return '<section class="fc-panel">' +
      '<div class="fc-section-title">Scheduling offer</div>' +
      emptyPanel(error) +
      '</section>';
  }
  if (!data) {
    return '<section class="fc-panel" id="offer-panel">' +
      '<div class="fc-section-title">Scheduling offer</div>' +
      emptyPanel('Loading offer…') +
      '</section>';
  }
  const appt = data.appointment || {};
  const terminal = appt.status === 'Booked' || appt.status === 'Cancelled';
  const url = data.offerUrl || '';
  return '<section class="fc-panel" id="offer-panel">' +
    '<div class="fc-section-title">Scheduling offer</div>' +
    '<div style="display:grid;grid-template-columns:96px 1fr;gap:8px 12px;font-size:13px;margin:12px 0 18px">' +
      '<span class="text-muted">Person</span><span>' + esc(data.person || appt.personName || '—') + '</span>' +
      '<span class="text-muted">Event</span><span>' + esc(data.event || appt.event || '—') + '</span>' +
      '<span class="text-muted">FSM</span><span>' + esc(data.fsm || appt.fsmName || '—') + '</span>' +
      '<span class="text-muted">Status</span><span id="offer-status">' + esc(data.status || appt.status || '—') + '</span>' +
      '<span class="text-muted">Expires</span><span>' + esc(formatExpires(data.expires || appt.expiresAt)) + '</span>' +
    '</div>' +
    '<div class="fc-field"><label for="offer-url">Offer URL</label>' +
      '<div style="display:flex;gap:8px">' +
        '<input id="offer-url" class="input" type="text" readonly value="' + esc(url) + '" />' +
        '<button class="btn btn-secondary" id="offer-copy" type="button">Copy</button>' +
      '</div></div>' +
    '<div class="dialog-actions" style="justify-content:flex-start">' +
      '<button class="btn btn-primary" id="offer-book" type="button"' + (terminal ? ' disabled' : '') + '>Mark booked</button>' +
      '<button class="btn btn-secondary" id="offer-cancel" type="button"' + (terminal ? ' disabled' : '') + '>Cancel offer</button>' +
    '</div>' +
    '<div id="offer-note" class="fc-note hidden"></div>' +
  '</section>';
}

function statsHtml(summary) {
  const stats = [
    ['Booked this week', summary ? String(summary.bookedThisWeek ?? 0) : '—'],
    ['Confirmed', summary ? String(summary.confirmed ?? 0) : '—'],
    ['Awaiting outcome form', summary ? String(summary.awaitingOutcome ?? 0) : '—'],
    ['No-show rate (30 d)', summary ? rateLabel(summary.noShowRate30d) : '—'],
  ];
  let html = '<div class="fc-stat-cards" id="sched-stats">';
  stats.forEach((s) => {
    html += '<div class="fc-stat-card"><div class="fc-stat-label">' + esc(s[0]) +
      '</div><div class="fc-stat-value fc-tnum">' + esc(s[1]) + '</div></div>';
  });
  return html + '</div>';
}

function queueHtml(items, selectedId, selected, selectedMissing) {
  let html = '<section><h4 style="margin-bottom:10px">Appointment queue</h4>';
  if (!items) {
    html += emptyPanel('Loading appointments…');
  } else if (items.length === 0) {
    html += emptyPanel('No appointments in the queue.');
  } else {
    html += '<table class="table" style="width:100%;font-size:13px"><thead><tr>' +
      '<th>When</th><th>Attendee</th><th>FSM</th><th>Status</th><th>Action due</th></tr></thead><tbody>';
    items.forEach((a) => {
      html += '<tr class="fc-row' + (a.id === selectedId ? ' selected' : '') +
        '" data-navigate="/scheduling/' + a.id + '" style="cursor:pointer">' +
        '<td><div class="fc-tnum">' + esc(formatWhen(a.startAt, a.timezone)) + '</div>' +
          '<div class="text-muted" style="font-size:11px">' + esc(tzAbbr(a.timezone)) + '</div></td>' +
        '<td><div>' + esc(a.personName) + '</div><div class="text-muted" style="font-size:11.5px">' +
          esc(a.event || '—') + '</div></td>' +
        '<td style="font-size:12.5px">' + esc(a.fsmName || '—') + '</td>' +
        '<td><span style="color:' + statusColor(apptTone(a.status)) + ';font-size:12.5px">' +
          esc(a.status) + '</span></td>' +
        '<td style="font-size:12.5px">' + esc(a.actionDue || '—') + '</td></tr>';
    });
    html += '</tbody></table>';
  }
  if (selectedId && selectedMissing) {
    html += emptyPanel('Appointment not found or not in your assignment set');
  } else if (selected) {
    html += '<div id="sched-detail" class="fc-panel" style="margin-top:14px">' +
      '<div class="fc-section-title">Selected appointment</div>' +
      '<div style="font-size:13.5px;margin-bottom:10px">' +
        esc(selected.personName) + ' · ' + esc(selected.status) +
      '</div>';
    if (selected.needsOutcome && isFsm()) {
      html += '<a class="btn btn-primary" href="/outcome/' + selected.id + '">Open outcome form</a>';
    }
    html += '</div>';
  }
  return html + '</section>';
}

function weekHtml(payload) {
  if (!payload || !payload.days) {
    return '<div class="fc-week" id="sched-week"></div>';
  }
  let html = '<div class="fc-week" id="sched-week">';
  payload.days.forEach((day) => {
    html += '<div class="fc-week-day"><div class="fc-week-head">' + esc(dayHead(day.date)) + '</div>';
    (day.slots || []).forEach((slot) => {
      const hour = Number(String(slot.start || '').slice(11, 13));
      const booked = slot.state === 'booked' && slot.appointmentId;
      html += '<button type="button" class="fc-slot" data-state="' + esc(slot.state) +
        '" data-start="' + esc(slot.start) + '"' +
        (booked ? ' data-id="' + slot.appointmentId + '"' : '') +
        '>' + esc(slotLabel(hour)) + '</button>';
    });
    html += '</div>';
  });
  return html + '</div>';
}

function pickerHtml() {
  return '<div id="sched-picker" class="dialog-backdrop hidden" hidden>' +
    '<div class="dialog" role="dialog" aria-labelledby="sched-picker-title">' +
      '<div class="dialog-title" id="sched-picker-title">Book appointment</div>' +
      '<p class="dialog-body" id="sched-picker-when"></p>' +
      '<div class="fc-field"><label for="sched-picker-q">Search</label>' +
        '<input id="sched-picker-q" class="input" type="search" placeholder="Name, email, or phone" /></div>' +
      '<div id="sched-picker-results" class="fc-merge-results"></div>' +
      (canPickFsm()
        ? '<div class="fc-field" id="sched-picker-fsm-wrap"><label for="sched-picker-fsm">FSM</label>' +
          '<select id="sched-picker-fsm" class="input" required><option value="">Select FSM</option></select></div>'
        : '') +
      '<div id="sched-picker-error" class="fc-note bad hidden"></div>' +
      '<div class="dialog-actions">' +
        '<button type="button" class="btn btn-secondary" id="sched-picker-cancel">Cancel</button>' +
        '<button type="button" class="btn btn-primary" id="sched-picker-confirm" disabled>Book</button>' +
      '</div>' +
    '</div></div>';
}

export function render(route) {
  if (route?.query?.offer) {
    return '<div class="fc-offer-wrap">' + offerPanel(null) + '</div>';
  }

  return statsHtml(null) +
    '<div class="fc-two-col-sched">' +
      '<div id="sched-queue">' + queueHtml(null, null) + '</div>' +
      '<aside class="fc-panel">' +
        '<div class="fc-section-title">Availability (canonical)</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px 16px;font-size:12.5px;margin:12px 0 16px">' +
        '<span class="text-muted">Working hours</span><span>09:00–19:00</span>' +
        '<span class="text-muted">Time zone</span><span>America/Chicago</span>' +
        '<span class="text-muted">Duration</span><span>45 minutes</span>' +
        '<span class="text-muted">Buffer</span><span>15 minutes</span>' +
        '<span class="text-muted">Min notice</span><span>12 hours</span>' +
        '<span class="text-muted">Max per day</span><span>4</span></div>' +
        '<div class="text-muted" style="font-size:12px;margin-bottom:8px">Week slots · only free/busy exposed publicly</div>' +
        weekHtml(null) +
        '<div class="fc-week-note">Calendar sync is Wave 2.</div>' +
      '</aside>' +
    '</div>' +
    pickerHtml();
}

function setOfferNote(el, message, kind) {
  const note = el.querySelector('#offer-note');
  if (!note) return;
  note.textContent = message;
  note.className = 'fc-note ' + (kind || '');
}

async function copyOffer(el) {
  const input = el.querySelector('#offer-url');
  const text = input?.value || '';
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    input.select();
    try { document.execCommand('copy'); } catch { /* ignore */ }
  }
  setOfferNote(el, 'Offer URL copied.', 'ok');
}

async function patchOffer(el, id, status) {
  const { ok, data } = await apiJson('/api/appointments/' + id, {
    method: 'PATCH',
    body: { status },
    silent: true,
  });
  if (!ok) {
    setOfferNote(el, data?.error?.message || 'Could not update the offer.', 'bad');
    return;
  }
  const next = data.appointment?.status || status;
  const statusEl = el.querySelector('#offer-status');
  if (statusEl) statusEl.textContent = next;
  el.querySelector('#offer-book')?.setAttribute('disabled', 'disabled');
  el.querySelector('#offer-cancel')?.setAttribute('disabled', 'disabled');
  setOfferNote(el, next === 'Booked' ? 'Marked booked.' : 'Offer cancelled.', 'ok');
}

function syncConfirm(el) {
  const btn = el.querySelector('#sched-picker-confirm');
  if (!btn) return;
  const fsmOk = !canPickFsm() || !!el.querySelector('#sched-picker-fsm')?.value;
  btn.disabled = !(pickerPerson && pickerStart && fsmOk);
}

function closePicker(el) {
  const drawer = el.querySelector('#sched-picker');
  if (!drawer) return;
  drawer.classList.add('hidden');
  drawer.hidden = true;
  pickerStart = null;
  pickerPerson = null;
  const q = el.querySelector('#sched-picker-q');
  const results = el.querySelector('#sched-picker-results');
  const err = el.querySelector('#sched-picker-error');
  if (q) q.value = '';
  if (results) results.innerHTML = '';
  if (err) {
    err.textContent = '';
    err.classList.add('hidden');
  }
  syncConfirm(el);
}

async function searchPeople(el, q) {
  const results = el.querySelector('#sched-picker-results');
  if (!results) return;
  const { ok, data } = await apiJson('/api/people?q=' + encodeURIComponent(q) + '&limit=20', { silent: true });
  if (!ok || !data) return;
  const items = data.items || [];
  if (canPickFsm()) {
    const sel = el.querySelector('#sched-picker-fsm');
    if (sel && (data.fsms || []).length && sel.options.length <= 1) {
      (data.fsms || []).forEach((f) => {
        const opt = document.createElement('option');
        opt.value = String(f.id);
        opt.textContent = f.displayName;
        sel.appendChild(opt);
      });
    }
  }
  if (!items.length) {
    results.innerHTML = '<div class="text-muted" style="padding:8px 10px">No matching people.</div>';
    pickerPerson = null;
    syncConfirm(el);
    return;
  }
  results.innerHTML = items.map((p) => (
    '<button type="button" class="fc-merge-row" data-person-id="' + p.id + '">' +
      '<strong>' + esc(p.displayName) + '</strong>' +
      '<div class="text-muted" style="font-size:12px">' + esc(p.email || p.phone || '') +
        ' · ' + esc(p.stage || '') + '</div>' +
    '</button>'
  )).join('');
}

function openPicker(el, startAt) {
  pickerStart = startAt;
  pickerPerson = null;
  const drawer = el.querySelector('#sched-picker');
  const when = el.querySelector('#sched-picker-when');
  const q = el.querySelector('#sched-picker-q');
  const err = el.querySelector('#sched-picker-error');
  if (!drawer) return;
  if (when) when.textContent = formatWhen(startAt, state.org?.timezone);
  if (err) {
    err.textContent = '';
    err.classList.add('hidden');
  }
  drawer.classList.remove('hidden');
  drawer.hidden = false;
  syncConfirm(el);
  q?.focus();
  searchPeople(el, '');
}

async function confirmBook(el) {
  const err = el.querySelector('#sched-picker-error');
  if (!pickerPerson || !pickerStart) return;
  const fsmUserId = canPickFsm()
    ? Number(el.querySelector('#sched-picker-fsm')?.value)
    : state.user?.id;
  if (canPickFsm() && !fsmUserId) {
    if (err) {
      err.textContent = 'Select an FSM.';
      err.classList.remove('hidden');
    }
    return;
  }
  const { ok, data } = await apiJson('/api/appointments', {
    method: 'POST',
    body: {
      personId: pickerPerson,
      startAt: pickerStart,
      fsmUserId,
      durationMin: pickerDuration,
    },
    silent: true,
  });
  if (!ok || !data?.appointment) {
    if (err) {
      err.textContent = data?.error?.message || 'Could not book this slot.';
      err.classList.remove('hidden');
    }
    return;
  }
  closePicker(el);
  navigate('/scheduling/' + data.appointment.id);
}

function paint(el, route, bundle) {
  const selectedId = route?.params?.appointmentId ? Number(route.params.appointmentId) : null;
  const stats = el.querySelector('#sched-stats');
  if (stats) stats.outerHTML = statsHtml(bundle.summary);
  const queue = el.querySelector('#sched-queue');
  if (queue) {
    queue.innerHTML = queueHtml(bundle.items, selectedId, bundle.selected, bundle.selectedMissing);
  }
  const week = el.querySelector('#sched-week');
  if (week) week.outerHTML = weekHtml(bundle.slots);
}

export function mount(el, route) {
  abort = new AbortController();
  const token = route?.query?.offer;
  const signal = abort.signal;

  if (token) {
    apiJson('/api/scheduling/offer/' + encodeURIComponent(token), { silent: true, signal })
      .then(({ ok, data }) => {
        if (signal.aborted) return;
        const wrap = el.querySelector('.fc-offer-wrap') || el;
        if (!ok || !data) {
          wrap.innerHTML = offerPanel(null, 'Offer not found or not in your assignment set');
          return;
        }
        wrap.innerHTML = offerPanel(data);
        wrap.querySelector('#offer-copy')?.addEventListener('click', () => copyOffer(wrap), { signal });
        wrap.querySelector('#offer-book')?.addEventListener('click', () => {
          patchOffer(wrap, data.appointment.id, 'Booked');
        }, { signal });
        wrap.querySelector('#offer-cancel')?.addEventListener('click', () => {
          patchOffer(wrap, data.appointment.id, 'Cancelled');
        }, { signal });
      })
      .catch(() => {
        if (signal.aborted) return;
        const wrap = el.querySelector('.fc-offer-wrap') || el;
        wrap.innerHTML = offerPanel(null, 'Could not load this offer.');
      });
    return;
  }

  const selectedId = route?.params?.appointmentId ? Number(route.params.appointmentId) : null;
  const filter = route?.query?.filter;
  const apptUrl = filter
    ? '/api/appointments?filter=' + encodeURIComponent(filter)
    : '/api/appointments';
  const loads = [
    apiJson('/api/scheduling/summary', { signal }),
    apiJson('/api/scheduling/slots', { signal }),
    apiJson(apptUrl, { signal }),
  ];
  if (selectedId) loads.push(apiJson('/api/appointments/' + selectedId, { silent: true, signal }));

  Promise.all(loads).then((results) => {
    if (signal.aborted) return;
    const [sumRes, slotRes, listRes, oneRes] = results;
    if (slotRes?.data?.durationMin) pickerDuration = slotRes.data.durationMin;
    let selected = null;
    let selectedMissing = false;
    if (selectedId) {
      if (oneRes?.ok && oneRes.data) selected = oneRes.data;
      else selectedMissing = true;
    }
    paint(el, route, {
      summary: sumRes?.ok ? sumRes.data : null,
      slots: slotRes?.ok ? slotRes.data : null,
      items: listRes?.ok ? (listRes.data.items || []) : null,
      selected,
      selectedMissing,
    });
  }).catch(() => {});

  el.addEventListener('click', (e) => {
    if (e.target.id === 'sched-picker' || e.target.closest('#sched-picker-cancel')) {
      closePicker(el);
      return;
    }
    if (e.target.closest('#sched-picker-confirm')) {
      confirmBook(el);
      return;
    }
    const person = e.target.closest('[data-person-id]');
    if (person) {
      pickerPerson = Number(person.dataset.personId);
      el.querySelectorAll('#sched-picker-results .fc-merge-row').forEach((n) => {
        n.classList.toggle('selected', n === person);
      });
      syncConfirm(el);
      return;
    }
    const slot = e.target.closest('.fc-slot');
    if (!slot || slot.closest('#sched-picker')) return;
    const slotState = slot.dataset.state;
    if (slotState === 'free') {
      openPicker(el, slot.dataset.start);
      return;
    }
    if (slotState === 'booked' && slot.dataset.id) {
      navigate('/scheduling/' + slot.dataset.id);
    }
  }, { signal });

  el.querySelector('#sched-picker-fsm')?.addEventListener('change', () => syncConfirm(el), { signal });
  el.querySelector('#sched-picker-q')?.addEventListener('input', (e) => {
    const q = e.target.value.trim();
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => searchPeople(el, q), 200);
  }, { signal });
}

export function unmount() {
  abort?.abort();
  abort = null;
  clearTimeout(searchTimer);
  searchTimer = null;
  pickerStart = null;
  pickerPerson = null;
}
