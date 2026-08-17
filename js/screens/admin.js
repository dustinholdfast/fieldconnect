import { apiJson } from '../api.js';
import { ROLES_TABLE } from '../../shared/roles.js';
import { emptyPanel, esc, OK, WARN } from '../html.js';

let abort = null;
let pollTimer = null;
let pendingJobId = null;

function titleStatus(value) {
  const s = String(value || '');
  if (!s) return '—';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function shortAt(iso) {
  const m = String(iso || '').match(/(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return iso || '—';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${Number(m[3])} ${months[Number(m[2]) - 1]} ${m[4]}:${m[5]}`;
}

function fmtNum(n) {
  if (n == null || n === '') return '—';
  const num = Number(n);
  if (!Number.isFinite(num)) return String(n);
  return num.toLocaleString();
}

function orgsHtml(orgs) {
  let html = '<h4 style="margin-bottom:8px">Organizations</h4>' +
    '<p class="text-muted" style="font-size:12.5px;margin:0 0 12px">Loaded from GET /api/orgs — the one cross-org metadata read (id, slug, name, wave, status, counts, map). It does not return people, emails, or appointments. Multi-org switcher is Wave 3.</p>';
  if (!orgs) {
    return html + emptyPanel('Loading organizations…');
  }
  if (!orgs.length) return html + emptyPanel('No organizations.');
  html += '<table class="table" style="width:100%;font-size:13px;margin-bottom:28px"><thead><tr>' +
    '<th>Church</th><th>Wave</th><th>Users</th><th>Contacts</th><th>MetaPulse map</th><th>Status</th></tr></thead><tbody>';
  orgs.forEach((o) => {
    html += '<tr class="fc-row"><td>' + esc(o.name) + '</td><td>' + esc(o.wave) + '</td>' +
      '<td class="fc-tnum">' + esc(fmtNum(o.userCount)) + '</td><td class="fc-tnum">' + esc(fmtNum(o.contactCount)) + '</td>' +
      '<td>' + esc(o.metapulseMap || '—') + '</td><td>' + esc(titleStatus(o.status)) + '</td></tr>';
  });
  return html + '</tbody></table>';
}

function laterWavesHtml() {
  return '<div class="fc-panel" style="margin-top:24px"><div class="fc-section-title">Later waves</div>' +
    '<p class="text-muted" style="font-size:12.5px;margin:10px 0 0">These controls stay disabled until their wave. This screen does not implement them.</p>' +
    '<ul class="text-muted" style="font-size:12.5px;margin:10px 0 0;padding-left:18px">' +
    '<li>Multi-org switcher — Wave 3</li>' +
    '<li>Executive (read-only) login — Wave 3</li>' +
    '<li>Public registration and booking pages — Wave 3</li>' +
    '<li>Calendar OAuth (Google / Outlook) — Wave 2</li>' +
    '<li>MetaPulse Level 2 API adapter and Level 3 nightly reconciliation — Wave 2</li>' +
    '</ul></div>';
}

function rolesHtml() {
  let html = '<h4 style="margin-bottom:12px">Roles and permissions</h4>' +
    '<p class="text-muted" style="font-size:12.5px;margin:0 0 12px">Documentation of hats. Extra roles are not Pilot login targets. The executive role is Wave 3.</p>' +
    '<table class="table" style="width:100%;font-size:13px;margin-bottom:28px"><thead><tr>' +
    '<th>Role</th><th>Scope</th><th>Key restriction</th></tr></thead><tbody>';
  ROLES_TABLE.forEach((r) => {
    html += '<tr class="fc-row"><td>' + esc(r[0]) + '</td><td>' + esc(r[1]) + '</td><td style="font-size:12.5px">' + esc(r[2]) + '</td></tr>';
  });
  return html + '</tbody></table>';
}

function level1Label(integration) {
  const status = integration?.level1 || 'active';
  return status === 'active' ? 'Active' : 'Disabled';
}

function integrationHtml(integration) {
  const l1on = !integration || integration.level1 !== 'disabled';
  return '<div class="fc-panel"><div class="fc-section-title">MetaPulse integration</div>' +
    '<div style="font-size:13px;margin-top:12px">' +
    '<div style="padding:8px 0;border-bottom:1px solid var(--color-divider)">Level 1 — File exchange <span style="float:right;color:' + OK + '">' + esc(level1Label(integration)) + '</span></div>' +
    '<div style="padding:8px 0;border-bottom:1px solid var(--color-divider)">Level 2 — API adapter <span style="float:right;color:' + WARN + '">Wave 2 — disabled</span></div>' +
    '<div style="padding:8px 0;border-bottom:1px solid var(--color-divider)">Level 3 — Nightly reconciliation (02:00 CT) <span style="float:right;color:' + WARN + '">Wave 2 — paused</span></div>' +
    '<div style="padding:8px 0">Least-privilege API user · credentials owned by the non-profit</div></div>' +
    '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px;align-items:center">' +
    '<button class="btn btn-primary" id="export-l1" type="button"' + (l1on ? '' : ' disabled') + '>Export now</button>' +
    '<button class="btn btn-secondary" id="toggle-adapter" type="button" disabled title="Wave 2 — API adapter">Wave 2 — API adapter</button>' +
    '</div>' +
    '<div id="export-note" class="fc-note hidden" style="margin-top:12px"></div>' +
    '</div>';
}

function lastExportHtml(integration, exportsList) {
  const last = integration?.lastExport || null;
  const latest = (exportsList || [])[0] || null;
  const rows = last?.rows ?? latest?.rowCount;
  const skipped = last?.skipped ?? 0;
  const at = last?.at || latest?.createdAt;
  const downloadId = latest?.id;
  return '<div class="fc-panel"><div class="fc-section-title">Last L1 export</div>' +
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:14px;font-size:13px">' +
    '<div><span class="text-muted">Records written</span><br><span class="fc-tnum" style="font-size:20px;font-family:var(--font-heading);font-weight:600">' +
      esc(rows == null ? '—' : fmtNum(rows)) + '</span></div>' +
    '<div><span class="text-muted">Skipped</span><br><span class="fc-tnum" style="font-size:20px;font-family:var(--font-heading);font-weight:600;color:' + (skipped ? WARN : OK) + '">' +
      esc(rows == null ? '—' : fmtNum(skipped)) + '</span></div>' +
    '<div><span class="text-muted">Exported at</span><br><span>' + esc(at ? shortAt(at) : '—') + '</span></div>' +
    '<div><span class="text-muted">Download</span><br>' +
      (downloadId
        ? '<a class="btn btn-secondary" href="/api/exports/' + downloadId + '" download>Download CSV</a>'
        : '<span class="text-muted">No export yet</span>') +
    '</div></div>';
}

function auditHtml(items) {
  let html = '<hr class="hr" style="margin:16px 0" /><div class="fc-section-title">Audit trail (recent)</div>';
  if (!items) return html + '<div class="text-muted" style="font-size:12.5px;margin-top:10px">Loading…</div></div>';
  if (!items.length) return html + '<div class="text-muted" style="font-size:12.5px;margin-top:10px">No audit events yet.</div></div>';
  html += '<div style="font-size:12.5px">';
  items.forEach((row, i) => {
    const border = i < items.length - 1 ? 'border-bottom:1px solid var(--color-divider);' : '';
    html += '<div style="padding:6px 0;' + border + '">' +
      esc(shortAt(row.at)) + ' · ' + esc(row.actorName || 'System') + ' · ' +
      esc(row.action) + (row.entityType ? ' (' + esc(row.entityType) + ')' : '') +
      '</div>';
  });
  return html + '</div></div>';
}

export function render() {
  return orgsHtml(null) + rolesHtml() +
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:24px">' +
    integrationHtml(null) +
    lastExportHtml(null, null) + auditHtml(null) +
    '</div>' + laterWavesHtml();
}

function setNote(el, message, kind) {
  const note = el.querySelector('#export-note');
  if (!note) return;
  if (!message) {
    note.textContent = '';
    note.className = 'fc-note hidden';
    return;
  }
  note.textContent = message;
  note.className = 'fc-note ' + (kind || '');
}

function paint(el, bundle) {
  const html = orgsHtml(bundle.orgs) + rolesHtml() +
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:24px">' +
    integrationHtml(bundle.integration) +
    lastExportHtml(bundle.integration, bundle.exports) + auditHtml(bundle.audit) +
    '</div>' + laterWavesHtml();
  el.innerHTML = html;
}

async function loadAdmin(el, signal) {
  const [orgsRes, integRes, auditRes, expRes] = await Promise.all([
    apiJson('/api/orgs', { signal }),
    apiJson('/api/admin/integration', { signal }),
    apiJson('/api/audit?limit=20', { signal }),
    apiJson('/api/exports', { signal }),
  ]);
  if (signal?.aborted) return;
  paint(el, {
    orgs: orgsRes.ok ? (orgsRes.data.items || []) : [],
    integration: integRes.ok ? integRes.data : null,
    audit: auditRes.ok ? (auditRes.data.items || []) : [],
    exports: expRes.ok ? (expRes.data.items || []) : [],
  });
}

function stopPoll() {
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = null;
}

function pollUntilExport(el, signal, beforeIds) {
  stopPoll();
  const tick = async () => {
    if (signal.aborted) return;
    const { ok, data } = await apiJson('/api/exports', { silent: true, signal });
    if (signal.aborted) return;
    const items = ok ? (data.items || []) : [];
    const found = items.find((item) => !beforeIds.has(item.id) || (pendingJobId && item.jobId === pendingJobId));
    if (found) {
      pendingJobId = null;
      setNote(el, 'Export ready.', 'ok');
      await loadAdmin(el, signal);
      return;
    }
    pollTimer = setTimeout(tick, 2000);
  };
  pollTimer = setTimeout(tick, 800);
}

export function mount(el) {
  abort = new AbortController();
  const signal = abort.signal;
  pendingJobId = null;
  loadAdmin(el, signal).catch(() => {});

  el.addEventListener('click', async (e) => {
    if (e.target.closest('#toggle-adapter')) {
      e.preventDefault();
      return;
    }
    if (!e.target.closest('#export-l1')) return;
    const btn = el.querySelector('#export-l1');
    if (btn) btn.disabled = true;
    const listed = await apiJson('/api/exports', { silent: true, signal });
    const beforeIds = new Set((listed.ok ? listed.data.items : []).map((item) => item.id));
    const { ok, data } = await apiJson('/api/exports/metapulse', { method: 'POST', body: {}, silent: true, signal });
    if (signal.aborted) return;
    if (!ok || !data?.jobId) {
      setNote(el, data?.error?.message || 'Could not start the export.', 'bad');
      if (btn) btn.disabled = false;
      return;
    }
    pendingJobId = data.jobId;
    setNote(el, 'Export queued…', '');
    pollUntilExport(el, signal, beforeIds);
  }, { signal });
}

export function unmount() {
  stopPoll();
  abort?.abort();
  abort = null;
  pendingJobId = null;
}
