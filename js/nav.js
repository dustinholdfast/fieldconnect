import { ROLE_SCREENS, ROLES, SCREENS } from './data.js';
import { esc } from './html.js';

export function screensForRole(role) {
  return ROLE_SCREENS[role] ? [...ROLE_SCREENS[role]] : [];
}

export function canAccess(role, screen) {
  if (screen === 'login' || screen === 'forbidden') return true;
  return screensForRole(role).includes(screen);
}

export function roleMeta(role) {
  return ROLES.find((r) => r.id === role) || ROLES[0];
}

export function renderNav(role, currentScreen) {
  const allowed = screensForRole(role);
  const items = SCREENS.filter((s) => allowed.includes(s.id)).map((s, i) => {
    const current = s.id === currentScreen;
    return (
      '<a class="fc-nav-item" href="/' + s.id + '"' +
        (current ? ' aria-current="page"' : '') +
      '>' +
        '<span class="fc-nav-num">' + String(i + 1).padStart(2, '0') + '</span>' +
        '<span>' + esc(s.label) + '</span>' +
      '</a>'
    );
  }).join('');
  return '<nav class="fc-nav" aria-label="Primary">' + items + '</nav>';
}
