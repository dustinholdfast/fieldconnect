import { ORGS, ROLES_TABLE } from '../data.js';
import { BAD, emptyPanel, esc, OK, WARN } from '../html.js';
import { setState, state } from '../state.js';

let abort = null;

export function render() {
  if (ORGS.length === 0) return emptyPanel('No organizations.');

  let html = '<h4 style="margin-bottom:12px">Organizations</h4>' +
    '<table class="table" style="width:100%;font-size:13px;margin-bottom:28px"><thead><tr>' +
    '<th>Church</th><th>Wave</th><th>Users</th><th>Contacts</th><th>MetaPulse map</th><th>Status</th></tr></thead><tbody>';
  ORGS.forEach((o) => {
    html += '<tr class="fc-row"><td>' + esc(o[0]) + '</td><td>' + esc(o[1]) + '</td>' +
      '<td class="fc-tnum">' + esc(o[2]) + '</td><td class="fc-tnum">' + esc(o[3]) + '</td>' +
      '<td>' + esc(o[4]) + '</td><td>' + esc(o[5]) + '</td></tr>';
  });
  html += '</tbody></table><h4 style="margin-bottom:12px">Roles and permissions</h4>' +
    '<table class="table" style="width:100%;font-size:13px;margin-bottom:28px"><thead><tr>' +
    '<th>Role</th><th>Scope</th><th>Key restriction</th></tr></thead><tbody>';
  ROLES_TABLE.forEach((r) => {
    html += '<tr class="fc-row"><td>' + esc(r[0]) + '</td><td>' + esc(r[1]) + '</td><td style="font-size:12.5px">' + esc(r[2]) + '</td></tr>';
  });
  html += '</tbody></table><div style="display:grid;grid-template-columns:1fr 1fr;gap:24px">' +
    '<div class="fc-panel"><div class="fc-section-title">MetaPulse integration</div>' +
    '<div style="font-size:13px;margin-top:12px">' +
    '<div style="padding:8px 0;border-bottom:1px solid var(--color-divider)">Level 1 — File exchange <span style="float:right;color:' + OK + '">Active</span></div>' +
    '<div style="padding:8px 0;border-bottom:1px solid var(--color-divider)">Level 2 — API adapter <span style="float:right;color:' + (state.adapterOn ? OK : WARN) + '">' + (state.adapterOn ? 'Live' : 'Staged') + '</span></div>' +
    '<div style="padding:8px 0;border-bottom:1px solid var(--color-divider)">Level 3 — Nightly reconciliation (02:00 CT)</div>' +
    '<div style="padding:8px 0">Least-privilege API user · credentials owned by the non-profit</div></div>' +
    '<button class="btn btn-primary" id="toggle-adapter" style="margin-top:14px" type="button">' +
    (state.adapterOn ? 'Switch to file exchange' : 'Activate API adapter') + '</button></div>' +
    '<div class="fc-panel"><div class="fc-section-title">Last reconciliation</div>' +
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:14px;font-size:13px">' +
    '<div><span class="text-muted">Records sent</span><br><span class="fc-tnum" style="font-size:20px;font-family:var(--font-heading);font-weight:600">1,204</span></div>' +
    '<div><span class="text-muted">Accepted</span><br><span class="fc-tnum" style="font-size:20px;font-family:var(--font-heading);font-weight:600;color:' + OK + '">1,196</span></div>' +
    '<div><span class="text-muted">Rejected</span><br><span class="fc-tnum" style="font-size:20px;font-family:var(--font-heading);font-weight:600;color:' + BAD + '">5</span></div>' +
    '<div><span class="text-muted">Need correction</span><br><span class="fc-tnum" style="font-size:20px;font-family:var(--font-heading);font-weight:600;color:' + WARN + '">3</span></div></div>' +
    '<hr class="hr" style="margin:16px 0" /><div class="fc-section-title">Audit trail (recent)</div>' +
    '<div style="font-size:12.5px">' +
    '<div style="padding:6px 0;border-bottom:1px solid var(--color-divider)">16 Aug 14:22 · M. Okafor · Activated API adapter for Twin Cities</div>' +
    '<div style="padding:6px 0;border-bottom:1px solid var(--color-divider)">15 Aug 09:11 · A. Reyes · Uploaded spring-open-house-2026.csv</div>' +
    '<div style="padding:6px 0">14 Aug 16:40 · System · Nightly reconciliation completed</div></div></div></div>';
  return html;
}

export function mount(el) {
  abort = new AbortController();
  el.addEventListener('click', (e) => {
    if (e.target.closest('#toggle-adapter')) {
      setState({ adapterOn: !state.adapterOn }, { content: true });
    }
  }, { signal: abort.signal });
}

export function unmount() {
  abort?.abort();
  abort = null;
}
