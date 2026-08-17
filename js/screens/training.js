import { apiJson } from '../api.js';
import { emptyPanel, esc, OK, statusColor, WARN } from '../html.js';
import { navigate } from '../router.js';
import { setState, state } from '../state.js';

let abort = null;
let cache = null;

function courseIdOf(route) {
  const raw = route?.params?.courseId;
  if (!raw) return null;
  const n = Number(raw);
  return Number.isInteger(n) ? n : null;
}

function boardHtml(bundle, route) {
  const items = bundle.items || [];
  const tracks = bundle.tracks || [];
  const gates = bundle.gates || {};
  const courseId = courseIdOf(route);
  const selected = courseId != null ? items.find((c) => c.id === courseId) : null;
  if (route?.params?.courseId && !selected) {
    return emptyPanel('Course not found.');
  }

  const track = selected?.track || state.track || tracks[0] || 'FSM';
  const courses = items.filter((c) => c.track === track);
  const ready = gates.routingEnabled;
  const quals = [
    ['FSM track', gates.complete != null ? (gates.complete + ' of ' + gates.required + ' complete') : '—', ready ? OK : WARN],
    ['Supervisor sign-off', gates.signedOff ? 'Signed' : 'Pending', gates.signedOff ? OK : WARN],
    ['Refresher due', '14 Feb 2027', 'inherit'],
    ['Appointment routing', ready ? 'Enabled' : 'Withheld', ready ? OK : 'bad'],
  ];

  let html = '<div class="fc-tracks">';
  tracks.forEach((t) => {
    html += '<button class="fc-track-chip ' + (t === track ? 'active' : '') + '" data-track="' + esc(t) + '" type="button">' + esc(t) + '</button>';
  });
  html += '</div><div style="display:grid;grid-template-columns:1fr 280px;gap:28px;align-items:start"><div>';
  if (selected) {
    const pct = Number.isFinite(selected.progressPct) ? selected.progressPct : 0;
    html += '<div class="fc-panel" style="margin-bottom:16px">' +
      '<div class="card-kicker">' + esc(selected.track) + '</div>' +
      '<h4 style="margin:6px 0 8px">' + esc(selected.title) + '</h4>' +
      '<p class="text-muted" style="font-size:13px;margin:0 0 10px">' + esc(selected.blurb) + '</p>' +
      '<div class="card-meta" style="margin-bottom:10px"><span>' + esc(selected.durationLabel) + '</span></div>' +
      '<div class="fc-progress"><div class="fc-progress-bar" style="width:' + pct + '%"></div></div>' +
      '<p class="text-muted" style="font-size:12.5px;margin-top:12px">Lesson video is not included. Mark the module complete to count toward the FSM track.</p>' +
      (selected.status !== 'Complete'
        ? '<button class="btn btn-primary" type="button" data-complete="' + selected.id + '">Mark complete</button>'
        : '') +
      '</div>';
  }
  html += '<div class="fc-course-grid">';
  if (courses.length === 0) {
    html += emptyPanel('No courses in this track.');
  }
  courses.forEach((c) => {
    const href = '/training/' + c.id;
    const isSel = selected && selected.id === c.id;
    const pct = Number.isFinite(c.progressPct) ? c.progressPct : 0;
    html += '<a class="card' + (isSel ? ' selected' : '') + '" href="' + href + '" style="text-decoration:none;color:inherit">' +
      '<div class="card-kicker">' + esc(c.track) + '</div>' +
      '<div class="card-title">' + esc(c.title) + '</div><p class="card-body">' + esc(c.blurb) + '</p>' +
      '<div class="fc-progress"><div class="fc-progress-bar" style="width:' + pct + '%"></div></div>' +
      '<div class="card-meta"><span>' + esc(c.durationLabel) + '</span>' +
      '<span style="margin-left:auto;color:' + statusColor(c.tone) + '">' + esc(c.status || '') + '</span></div></a>';
  });
  html += '</div></div><aside class="fc-panel"><div class="fc-section-title">Qualification status</div>';
  quals.forEach((q) => {
    html += '<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--color-divider);font-size:13px">' +
      '<span class="text-muted">' + esc(q[0]) + '</span><span style="color:' + q[2] + '">' + esc(q[1]) + '</span></div>';
  });
  html += '<p class="text-muted" style="font-size:12.5px;margin-top:16px">Appointment routing is withheld until the FSM track is complete and a supervisor signs off.</p>';
  if ((bundle.fsms || []).length) {
    html += '<div class="fc-section-title" style="margin-top:16px">FSM sign-off</div>';
    bundle.fsms.forEach((f) => {
      html += '<div style="display:flex;justify-content:space-between;gap:8px;padding:8px 0;border-bottom:1px solid var(--color-divider);font-size:13px">' +
        '<span>' + esc(f.name) + '<div class="text-muted" style="font-size:11px">' +
        (f.routingEnabled ? 'Routing enabled' : (f.signedOff ? 'Track incomplete' : 'Needs sign-off')) +
        '</div></span>' +
        (f.signedOff ? '<span class="text-muted">Signed</span>'
          : '<button class="btn btn-ghost" type="button" data-signoff="' + f.id + '">Sign off</button>') +
        '</div>';
    });
  }
  html += '</aside></div>';
  return html;
}

export function render(route) {
  if (!cache) return emptyPanel('Loading training…');
  return boardHtml(cache, route);
}

async function load(el, route, signal) {
  const { ok, data } = await apiJson('/api/training', { signal });
  if (signal?.aborted) return;
  cache = ok ? data : { tracks: [], items: [], gates: null };
  el.innerHTML = boardHtml(cache, route);
}

export function mount(el, route) {
  abort = new AbortController();
  load(el, route, abort.signal).catch(() => {});
  el.addEventListener('click', async (e) => {
    const chip = e.target.closest('[data-track]');
    if (chip) {
      setState({ track: chip.dataset.track });
      navigate('/training');
      return;
    }
    const complete = e.target.closest('[data-complete]');
    if (complete) {
      complete.disabled = true;
      await apiJson('/api/training/progress', {
        method: 'POST',
        body: { moduleId: Number(complete.dataset.complete), progressPct: 100 },
        signal: abort.signal,
      });
      await load(el, route, abort.signal);
      return;
    }
    const sign = e.target.closest('[data-signoff]');
    if (sign) {
      sign.disabled = true;
      await apiJson('/api/training/signoff', {
        method: 'POST',
        body: { userId: Number(sign.dataset.signoff), track: 'FSM' },
        signal: abort.signal,
      });
      await load(el, route, abort.signal);
    }
  }, { signal: abort.signal });
}

export function unmount() {
  abort?.abort();
  abort = null;
}
