import { apiJson } from '../api.js';
import { emptyPanel, esc } from '../html.js';

let abort = null;

function slotLabel(iso) {
  const m = String(iso || '').match(/T(\d{2}):(\d{2})/);
  if (!m) return iso || '';
  let h = Number(m[1]);
  const suffix = h >= 12 ? 'pm' : 'am';
  if (h === 0) h = 12;
  else if (h > 12) h -= 12;
  return h + ':' + m[2] + ' ' + suffix;
}

function dayHead(dateStr) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return names[wd] + ' ' + d;
}

function formHtml(page, slots, note) {
  if (!page) return emptyPanel('Loading this event…');
  const days = slots?.days || [];
  let html = '<div class="fc-public">' +
    '<div class="fc-brand-name">FieldConnect</div>' +
    '<div class="kicker">' + esc(page.orgName || '') + '</div>' +
    '<h2 style="text-align:center;margin:0 0 8px">' + esc(page.campaign) + '</h2>' +
    '<p class="text-muted" style="text-align:center;font-size:13px;margin:0 0 20px">Register for this event. Book a consultation if a free slot is open.</p>' +
    '<form id="public-form">' +
      '<div class="fc-field"><label for="pub-first">First name</label>' +
        '<input id="pub-first" class="input" name="firstName" required autocomplete="given-name" /></div>' +
      '<div class="fc-field"><label for="pub-last">Last name</label>' +
        '<input id="pub-last" class="input" name="lastName" required autocomplete="family-name" /></div>' +
      '<div class="fc-field"><label for="pub-email">Email</label>' +
        '<input id="pub-email" class="input" type="email" name="email" autocomplete="email" /></div>' +
      '<div class="fc-field"><label for="pub-phone">Phone</label>' +
        '<input id="pub-phone" class="input" type="tel" name="phone" autocomplete="tel" /></div>' +
      '<input type="hidden" id="pub-start" name="startAt" value="" />';
  if (page.canBook && days.length) {
    html += '<div class="fc-section-title">Available times</div>' +
      '<div class="fc-week" id="pub-week">';
    days.forEach((day) => {
      html += '<div class="fc-week-day"><div class="fc-week-head">' + esc(dayHead(day.date)) + '</div>';
      (day.slots || []).forEach((slot) => {
        html += '<button type="button" class="fc-slot" data-state="' + esc(slot.state) +
          '" data-start="' + esc(slot.start) + '"' +
          (slot.state === 'free' ? '' : ' disabled') +
          '>' + esc(slotLabel(slot.start)) + '</button>';
      });
      html += '</div>';
    });
    html += '</div>';
  }
  html += '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:16px">' +
    '<button class="btn btn-primary" type="submit" id="pub-register">Register</button>' +
    (page.canBook ? '<button class="btn btn-secondary" type="button" id="pub-book">Book selected time</button>' : '') +
    '</div></form>' +
    '<div id="pub-note" class="fc-note' + (note ? '' : ' hidden') + '">' + esc(note || '') + '</div>' +
    '</div>';
  return html;
}

export function render() {
  return formHtml(null, null);
}

function setNote(el, message, kind) {
  const note = el.querySelector('#pub-note');
  if (!note) return;
  note.textContent = message || '';
  note.className = 'fc-note' + (kind ? ' ' + kind : '') + (message ? '' : ' hidden');
}

function readIdentity(el) {
  return {
    firstName: el.querySelector('#pub-first')?.value.trim() || '',
    lastName: el.querySelector('#pub-last')?.value.trim() || '',
    email: el.querySelector('#pub-email')?.value.trim() || '',
    phone: el.querySelector('#pub-phone')?.value.trim() || '',
    startAt: el.querySelector('#pub-start')?.value || '',
  };
}

export function mount(el, route) {
  abort = new AbortController();
  const signal = abort.signal;
  const slug = route?.params?.slug;
  if (!slug) {
    el.innerHTML = emptyPanel('Event not found.');
    return;
  }

  Promise.all([
    apiJson('/api/public/' + encodeURIComponent(slug), { silent: true, signal }),
    apiJson('/api/public/' + encodeURIComponent(slug) + '/slots', { silent: true, signal }),
  ]).then(([pageRes, slotRes]) => {
    if (signal.aborted) return;
    if (!pageRes.ok || !pageRes.data) {
      el.innerHTML = emptyPanel('Event not found.');
      return;
    }
    el.innerHTML = formHtml(pageRes.data, slotRes.ok ? slotRes.data : null);

    el.addEventListener('click', (e) => {
      const slot = e.target.closest('.fc-slot[data-state="free"]');
      if (slot) {
        el.querySelectorAll('.fc-slot').forEach((n) => n.classList.toggle('selected', n === slot));
        const hidden = el.querySelector('#pub-start');
        if (hidden) hidden.value = slot.dataset.start || '';
        return;
      }
      if (e.target.closest('#pub-book')) {
        e.preventDefault();
        const body = readIdentity(el);
        if (!body.startAt) {
          setNote(el, 'Select a free time first.', 'bad');
          return;
        }
        apiJson('/api/public/' + encodeURIComponent(slug) + '/book', {
          method: 'POST', body, silent: true, signal,
        }).then(({ ok, data }) => {
          if (signal.aborted) return;
          if (!ok) {
            setNote(el, data?.error?.message || 'Could not book this time.', 'bad');
            return;
          }
          setNote(el, 'Booked. We will confirm with ' + (data.person?.displayName || 'you') + '.', 'ok');
        }).catch(() => setNote(el, 'Cannot reach FieldConnect.', 'bad'));
      }
    }, { signal });

    el.querySelector('#public-form')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const body = readIdentity(el);
      apiJson('/api/public/' + encodeURIComponent(slug) + '/register', {
        method: 'POST', body, silent: true, signal,
      }).then(({ ok, data }) => {
        if (signal.aborted) return;
        if (!ok) {
          setNote(el, data?.error?.message || 'Could not register.', 'bad');
          return;
        }
        setNote(el, 'Registered. Thank you, ' + (data.person?.displayName || '') + '.', 'ok');
      }).catch(() => setNote(el, 'Cannot reach FieldConnect.', 'bad'));
    }, { signal });
  }).catch(() => {
    if (!signal.aborted) el.innerHTML = emptyPanel('Could not load this event.');
  });
}

export function unmount() {
  abort?.abort();
  abort = null;
}
