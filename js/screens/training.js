import { COURSES } from '../data.js';
import { emptyPanel, esc, OK, statusColor, WARN } from '../html.js';
import { setState, state } from '../state.js';

let abort = null;

function parseCourseId(courseId) {
  if (!courseId) return null;
  const idx = courseId.lastIndexOf('-');
  if (idx === -1) return null;
  return { track: courseId.slice(0, idx), i: Number(courseId.slice(idx + 1)) };
}

export function render(route) {
  const tracks = ['Host', 'FSM', 'Qual handling', 'Campaign manager', 'Disseminator', 'Recruiter', 'Success line'];
  const courses = COURSES[state.track] || [];
  const quals = [['FSM track', '3 of 6 complete', WARN], ['Supervisor sign-off', 'Pending', WARN], ['Refresher due', '14 Feb 2027', 'inherit'], ['Appointment routing', 'Enabled (provisional)', OK]];
  const parsed = parseCourseId(route?.params?.courseId);

  if (parsed && (!(parsed.track in COURSES) || !COURSES[parsed.track][parsed.i])) {
    return emptyPanel('Course not found.');
  }

  let html = '<div class="fc-tracks">';
  tracks.forEach((t) => {
    html += '<button class="fc-track-chip ' + (t === state.track ? 'active' : '') + '" data-track="' + esc(t) + '" type="button">' + esc(t) + '</button>';
  });
  html += '</div><div style="display:grid;grid-template-columns:1fr 280px;gap:28px;align-items:start"><div class="fc-course-grid">';
  if (courses.length === 0) {
    html += emptyPanel('No courses in this track.');
  }
  courses.forEach((c, i) => {
    const href = '/training/' + encodeURIComponent(state.track) + '-' + i;
    const selected = parsed && parsed.track === state.track && parsed.i === i;
    html += '<a class="card' + (selected ? ' selected' : '') + '" href="' + href + '" style="text-decoration:none;color:inherit">' +
      '<div class="card-kicker">' + esc(state.track) + '</div>' +
      '<div class="card-title">' + esc(c[0]) + '</div><p class="card-body">' + esc(c[1]) + '</p>' +
      '<div class="fc-progress"><div class="fc-progress-bar" style="width:' + esc(c[2]) + '"></div></div>' +
      '<div class="card-meta"><span>' + esc(c[3]) + '</span>' +
      '<span style="margin-left:auto;color:' + statusColor(c[5]) + '">' + esc(c[4]) + '</span></div></a>';
  });
  html += '</div><aside class="fc-panel"><div class="fc-section-title">Qualification status</div>';
  quals.forEach((q) => {
    html += '<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--color-divider);font-size:13px">' +
      '<span class="text-muted">' + esc(q[0]) + '</span><span style="color:' + q[2] + '">' + esc(q[1]) + '</span></div>';
  });
  html += '<p class="text-muted" style="font-size:12.5px;margin-top:16px">Appointment routing is withheld until the FSM track is complete and signed off.</p></aside></div>';
  return html;
}

export function mount(el) {
  abort = new AbortController();
  el.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-track]');
    if (chip) setState({ track: chip.dataset.track }, { content: true });
  }, { signal: abort.signal });
}

export function unmount() {
  abort?.abort();
  abort = null;
}
