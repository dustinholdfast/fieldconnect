import { STAGE_ORDER, STORY_BASE } from '../data.js';
import { emptyPanel, esc, OK, WARN } from '../html.js';
import { setState, state } from '../state.js';

let abort = null;

export function render() {
  const stageCounts = [['Submitted', '12'], ['Screened', '6'], ['Recorded', '4'], ['Consent pending', '3'], ['Published', '9']];
  const stories = STORY_BASE.map((s, i) => {
    const stage = state.storyStages[i] || s[3];
    const nextIdx = Math.min(STAGE_ORDER.indexOf(stage) + 1, STAGE_ORDER.length - 1);
    const next = STAGE_ORDER[nextIdx];
    const releaseColor = s[4].includes('Not requested') ? WARN : OK;
    return { who: s[0], src: s[1], summary: s[2], stage, release: s[4], releaseColor, next, i };
  });

  if (stories.length === 0) return emptyPanel('No stories in the pipeline.');

  let html = '<div class="fc-stage-cards">';
  stageCounts.forEach((s) => {
    html += '<div class="fc-stat-card"><div class="fc-stat-label">' + esc(s[0]) + '</div><div class="fc-stat-value fc-tnum">' + esc(s[1]) + '</div></div>';
  });
  html += '</div><div style="display:grid;grid-template-columns:1fr 300px;gap:28px;align-items:start">' +
    '<table class="table" style="width:100%;font-size:13px"><thead><tr>' +
    '<th>Contributor</th><th>Story summary</th><th>Stage</th><th>Release</th><th></th></tr></thead><tbody>';
  stories.forEach((s) => {
    html += '<tr class="fc-row"><td><div>' + esc(s.who) + '</div><div class="text-muted" style="font-size:11.5px">' + esc(s.src) + '</div></td>' +
      '<td style="font-size:12.5px">' + esc(s.summary) + '</td>' +
      '<td><span class="tag tag-outline" style="font-size:11px">' + esc(s.stage) + '</span></td>' +
      '<td style="color:' + s.releaseColor + ';font-size:12.5px">' + esc(s.release) + '</td>' +
      '<td><button class="btn btn-ghost" data-advance="' + s.i + '" style="font-size:12px" type="button">Advance → ' + esc(s.next) + '</button></td></tr>';
  });
  html += '</tbody></table><aside class="fc-panel"><div class="fc-section-title">Consent record</div>' +
    '<p class="text-muted" style="font-size:12.5px;margin:10px 0">Stored separately from the story text. Names allowed channels and withdrawal dates.</p>' +
    '<div style="font-size:13px;margin-top:12px">' +
    '<div style="padding:6px 0;border-bottom:1px solid var(--color-divider)">Newsletter — signed 12 Aug</div>' +
    '<div style="padding:6px 0;border-bottom:1px solid var(--color-divider)">Social (SCN groups) — signed 12 Aug</div>' +
    '<div style="padding:6px 0;border-bottom:1px solid var(--color-divider)">Training examples — pending</div>' +
    '<div style="padding:6px 0">Public website — withdrawn 3 Sep</div></div>' +
    '<p class="text-muted" style="font-size:12px;margin-top:16px">Repurposing destinations: recruitment funnel, newsletter, social, training.</p></aside></div>';
  return html;
}

export function mount(el) {
  abort = new AbortController();
  el.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-advance]');
    if (!btn) return;
    const i = +btn.dataset.advance;
    const current = state.storyStages[i] || STORY_BASE[i][3];
    const idx = STAGE_ORDER.indexOf(current);
    const next = STAGE_ORDER[Math.min(idx + 1, STAGE_ORDER.length - 1)];
    setState({ storyStages: { ...state.storyStages, [i]: next } }, { content: true });
  }, { signal: abort.signal });
}

export function unmount() {
  abort?.abort();
  abort = null;
}
