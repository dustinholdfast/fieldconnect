import { apiJson } from '../api.js';
import { APPTS } from '../data.js';
import { emptyPanel, esc, statusColor } from '../html.js';

let abort = null;

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

export function render(route) {
  if (route?.query?.offer) {
    return '<div class="fc-offer-wrap">' + offerPanel(null) + '</div>';
  }

  const stats = [['Booked this week', '23'], ['Confirmed', '19'], ['Awaiting outcome form', '7'], ['No-show rate (30 d)', '14%']];
  const slots = ['9:00','10:00','11:00','1:00','2:00','3:00','4:00','5:00','6:30','7:30','9:00','10:00','11:00','1:00','2:00','3:00','4:00','5:00','6:30','7:30'];
  const bookedIdx = [2, 5, 8, 11, 16];
  const selectedId = route?.params?.appointmentId ? Number(route.params.appointmentId) : null;

  let html = '<div class="fc-stat-cards">';
  stats.forEach((s) => {
    html += '<div class="fc-stat-card"><div class="fc-stat-label">' + esc(s[0]) + '</div><div class="fc-stat-value fc-tnum">' + esc(s[1]) + '</div></div>';
  });
  html += '</div><div class="fc-two-col-sched"><section><h4 style="margin-bottom:10px">Appointment queue</h4>';
  if (APPTS.length === 0) {
    html += emptyPanel('No appointments in the queue.');
  } else {
    html += '<table class="table" style="width:100%;font-size:13px"><thead><tr>' +
      '<th>When</th><th>Attendee</th><th>FSM</th><th>Status</th><th>Action due</th></tr></thead><tbody>';
    APPTS.forEach((a, i) => {
      const id = i + 1;
      html += '<tr class="fc-row' + (id === selectedId ? ' selected' : '') + '" data-navigate="/scheduling/' + id + '" style="cursor:pointer">' +
        '<td><div class="fc-tnum">' + esc(a[0]) + '</div><div class="text-muted" style="font-size:11px">' + esc(a[1]) + '</div></td>' +
        '<td><div>' + esc(a[2]) + '</div><div class="text-muted" style="font-size:11.5px">' + esc(a[3]) + '</div></td>' +
        '<td style="font-size:12.5px">' + esc(a[4]) + '</td>' +
        '<td><span style="color:' + statusColor(a[6]) + ';font-size:12.5px">' + esc(a[5]) + '</span></td>' +
        '<td style="font-size:12.5px">' + esc(a[7]) + '</td></tr>';
    });
    html += '</tbody></table>';
  }
  if (selectedId && (selectedId < 1 || selectedId > APPTS.length)) {
    html += emptyPanel('Appointment not found or not in your assignment set');
  }
  html += '</section><aside class="fc-panel">' +
    '<div class="fc-section-title">Availability (canonical)</div>' +
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px 16px;font-size:12.5px;margin:12px 0 16px">' +
    '<span class="text-muted">Working hours</span><span>09:00–19:00</span>' +
    '<span class="text-muted">Time zone</span><span>America/Chicago</span>' +
    '<span class="text-muted">Duration</span><span>45 minutes</span>' +
    '<span class="text-muted">Buffer</span><span>15 minutes</span>' +
    '<span class="text-muted">Min notice</span><span>12 hours</span>' +
    '<span class="text-muted">Max per day</span><span>4</span></div>' +
    '<div class="text-muted" style="font-size:12px;margin-bottom:8px">Week slots · only free/busy exposed publicly</div>' +
    '<div class="fc-slots">';
  slots.forEach((t, i) => {
    html += '<div class="fc-slot ' + (bookedIdx.includes(i) ? 'booked' : '') + '">' + t + '</div>';
  });
  html += '</div></aside></div>';
  return html;
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

export function mount(el, route) {
  abort = new AbortController();
  const token = route?.query?.offer;
  if (!token) return;
  const signal = abort.signal;

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
}

export function unmount() {
  abort?.abort();
  abort = null;
}
