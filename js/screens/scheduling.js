import { APPTS } from '../data.js';
import { emptyPanel, esc, statusColor } from '../html.js';

export function render(route) {
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

export function mount() {}

export function unmount() {}
