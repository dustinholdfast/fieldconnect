export const ACCENT = '#b68235';
export const OK = '#5f7a4a';
export const WARN = '#a06f24';
export const BAD = '#8c4a3a';

export function esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function statusColor(s) {
  if (s === 'ok') return OK;
  if (s === 'warn') return WARN;
  if (s === 'bad') return BAD;
  if (s === 'accent') return '#7d5411';
  return 'inherit';
}

export function emptyPanel(message) {
  return '<div class="fc-panel fc-empty"><p>' + esc(message) + '</p></div>';
}

export function errorBanner(err) {
  if (!err) return '';
  return (
    '<div class="fc-error-banner" role="alert">' +
      '<span>' + esc(err.message) + '</span>' +
      '<button type="button" class="btn btn-secondary" data-retry>Retry</button>' +
    '</div>'
  );
}
