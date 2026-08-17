import { api, setApiErrorHandler, setCsrfToken } from './api.js';
import { startOutcomeFlush } from './outcome/queue.js';
import { ROLE_SCREENS, ROLES, SCREENS } from '../shared/roles.js';
import { errorBanner, esc } from './html.js';
import { canAccess, renderNav, roleMeta, screensForRole } from './nav.js';
import {
  fallbackPath, maybeHashRedirect, navigate, parse, parsePath, primaryRecordId, startRouter
} from './router.js';
import * as admin from './screens/admin.js';
import * as crm from './screens/crm.js';
import * as dashboard from './screens/dashboard.js';
import * as forbidden from './screens/forbidden.js';
import * as lists from './screens/lists.js';
import * as login from './screens/login.js';
import * as nurture from './screens/nurture.js';
import * as outcome from './screens/outcome.js';
import * as recruitment from './screens/recruitment.js';
import * as scheduling from './screens/scheduling.js';
import * as stories from './screens/stories.js';
import * as training from './screens/training.js';
import { setRouteHandler, setState, state } from './state.js';

const screens = {
  dashboard, crm, scheduling, outcome, nurture, lists, training, recruitment, stories, admin, forbidden, login
};

let current = { screen: null, recordId: null, unmount: null, shellKey: null };
let firstAuthPaint = true;

function applySession(payload) {
  setCsrfToken(payload.csrfToken);
  state.user = payload.user;
  state.org = payload.org;
  state.role = payload.user.role;
}

function safeNext(raw) {
  if (typeof raw !== 'string' || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) {
    return '/dashboard';
  }
  if (raw === '/login' || raw.startsWith('/login?')) return '/dashboard';
  return raw;
}

function screenMeta(id) {
  return SCREENS.find((s) => s.id === id) || { kicker: '', title: id };
}

function shellKey(user, route) {
  return [user?.id ?? '', user?.role ?? '', route?.screen ?? ''].join('|');
}

function shellChanged(user, route) {
  return shellKey(user, route) !== current.shellKey;
}

export function renderShell(user, route) {
  const root = document.getElementById('app');
  if (!root || !route) return;

  if (route.screen === 'login') {
    root.className = 'fc-root fc-login-page';
    return;
  }

  const standalone = route.screen === 'outcome';
  root.className = 'fc-root' + (standalone ? ' fc-outcome-standalone' : '');

  const role = roleMeta(state.role);
  const orgName = (state.org && state.org.name) || 'Church of Scientology of Twin Cities';
  const initials = user?.initials || role.initials;
  const displayName = user?.displayName || role.name;
  const roleLabel = role.full;
  const screen = screenMeta(route.screen);
  const chip =
    '<div class="fc-user-chip">' +
      '<div class="fc-avatar">' + esc(initials) + '</div>' +
      '<div class="fc-user-meta">' +
        '<div class="fc-user-name">' + esc(displayName) + '</div>' +
        '<div class="fc-user-role">' + esc(roleLabel) + '</div>' +
      '</div>' +
    '</div>';

  const sidebarInner =
    '<div class="fc-brand">' +
      '<div class="fc-brand-name">FieldConnect</div>' +
      '<div class="fc-brand-kicker">Event → Field Conversion</div>' +
    '</div>' +
    renderNav(state.role, route.screen) +
    '<div class="fc-sidebar-footer">' +
      '<div class="fc-org-name">' + esc(orgName) + '</div>' +
      '<div class="fc-sync">MetaPulse sync — ' + (state.adapterOn ? 'API adapter live' : 'file exchange') + '</div>' +
    '</div>';

  const headerInner = standalone
    ? '<a class="btn btn-ghost" href="/scheduling">← Schedule</a>' +
      '<h2>Post-interview outcome</h2>' +
      '<div class="fc-header-right">' + chip +
        '<button class="btn btn-secondary" id="logout" type="button">Log out</button>' +
      '</div>'
    : '<div class="fc-header-left">' +
        '<div class="kicker">' + esc(screen.kicker) + '</div>' +
        '<h2>' + esc(screen.title) + '</h2>' +
      '</div>' +
      '<div class="fc-header-right">' + chip +
        '<button class="btn btn-secondary" id="logout" type="button">Log out</button>' +
      '</div>';

  if (!root.querySelector('.fc-content')) {
    root.innerHTML =
      '<aside class="fc-sidebar">' + sidebarInner + '</aside>' +
      '<div class="fc-main">' +
        '<header class="fc-header">' + headerInner + '</header>' +
        '<div class="fc-content"></div>' +
      '</div>';
  } else {
    const sidebar = root.querySelector('.fc-sidebar');
    const header = root.querySelector('.fc-header');
    if (sidebar) sidebar.innerHTML = sidebarInner;
    if (header) header.innerHTML = headerInner;
  }
  current.shellKey = shellKey(user, route);
}

export function renderScreen(route) {
  if (current.unmount) {
    current.unmount();
    current.unmount = null;
  }
  const el = document.querySelector('.fc-content');
  if (!el || !route) return;
  const def = screens[route.screen];
  const body = def ? def.render(route, state) : '<p>Screen not found</p>';
  el.innerHTML = errorBanner(state.error) + body;
  current.screen = route.screen;
  current.recordId = primaryRecordId(route);
  current.unmount = def?.unmount ? () => def.unmount() : null;
  def?.mount?.(el, route, { user: state.user, org: state.org, navigate, setState });
}

function renderLoginPage(route) {
  if (current.unmount) {
    current.unmount();
    current.unmount = null;
  }
  const root = document.getElementById('app');
  if (!root) return;
  root.className = 'fc-root fc-login-page';
  root.innerHTML = login.render(route, state);
  current.screen = 'login';
  current.recordId = null;
  current.shellKey = 'login';
  current.unmount = () => login.unmount();
  login.mount(root, route, { onSuccess: handleLoginSuccess });
}

function onRoute(route, flags = {}) {
  if (!route) return;
  if (route.screen === 'login') {
    renderLoginPage(route);
    return;
  }
  const user = state.user;
  if (flags.shell || shellChanged(user, route)) renderShell(user, route);
  if (flags.content) {
    renderScreen(route);
    return;
  }
  if (current.screen !== route.screen || current.recordId !== primaryRecordId(route)) {
    renderScreen(route);
  }
}

function handleLoginSuccess(payload) {
  applySession(payload);
  const next = safeNext(new URLSearchParams(location.search).get('next'));
  navigate(next, { replace: true });
}

async function logoutUser() {
  try {
    await api('/api/auth/logout', { method: 'POST', silent: true });
  } catch { /* leave locally even if the request fails */ }
  setCsrfToken(null);
  state.user = null;
  state.org = null;
  location.replace('/login');
}

function shouldIntercept(anchor, event) {
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  if (anchor.target && anchor.target !== '_self') return false;
  if (anchor.hasAttribute('download')) return false;
  const href = anchor.getAttribute('href');
  if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('http')) return false;
  if (href.startsWith('/api/') || href === '/metrics' || href === '/healthz') return false;
  return href.startsWith('/');
}

function bindAppClicks() {
  const root = document.getElementById('app');
  if (!root || root.dataset.navBound) return;
  root.dataset.navBound = '1';
  root.addEventListener('click', (event) => {
    if (event.target.closest('#logout')) {
      event.preventDefault();
      logoutUser();
      return;
    }
    if (event.target.closest('[data-retry]')) {
      event.preventDefault();
      const retry = state.error?.retry;
      setState({ error: null }, { content: true });
      retry?.();
      return;
    }
    const go = event.target.closest('[data-navigate]');
    if (go) {
      event.preventDefault();
      navigate(go.getAttribute('data-navigate'));
      return;
    }
    const legacy = event.target.closest('[data-go]');
    if (legacy) {
      event.preventDefault();
      navigate('/' + legacy.dataset.go);
      return;
    }
    const anchor = event.target.closest('a[href]');
    if (anchor && shouldIntercept(anchor, event)) {
      event.preventDefault();
      navigate(anchor.getAttribute('href'));
    }
  });
}

function handleLocation(parsed) {
  const route = parsed || parse();
  if (!state.user) {
    if (route.screen === 'login') {
      state.route = route;
      onRoute(route, { shell: true, content: true });
    }
    return;
  }
  if (route.screen === 'login') {
    const next = safeNext(new URLSearchParams(location.search).get('next'));
    navigate(next, { replace: true });
    return;
  }
  if (!route.known) {
    const dest = fallbackPath(state.role, screensForRole(state.role));
    navigate(dest, { replace: true });
    return;
  }
  if (!canAccess(state.role, route.screen)) {
    navigate('/forbidden', { replace: true });
    return;
  }
  if (route.params.personId) {
    const sel = crm.contactById(route.params.personId);
    if (sel) state.contactIdx = sel.i;
  }
  if (route.params.journeyId) state.journeyId = route.params.journeyId;
  setState({ route, screen: route.screen, error: state.error });
  const flags = firstAuthPaint ? { shell: true, content: true } : { content: true };
  firstAuthPaint = false;
  onRoute(route, flags);
}

function wireApiErrors() {
  setApiErrorHandler((err) => {
    if (!err) return;
    if (typeof err.path === 'string' && err.path.startsWith('/api/auth')) return;
    if (err.status === 401) return;
    if (err.status === 403) {
      navigate('/forbidden', { replace: true });
      return;
    }
    const message = err.network
      ? 'Cannot reach FieldConnect.'
      : 'Something went wrong. Please try again.';
    setState({ error: { message, retry: err.retry } }, { content: true });
  });
}

async function fetchMe() {
  try {
    const res = await api('/api/auth/me', { silent: true });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

async function boot() {
  bindAppClicks();
  wireApiErrors();
  setRouteHandler(onRoute);
  maybeHashRedirect();

  const me = await fetchMe();
  if (!me) {
    const here = parse();
    if (here.screen !== 'login') {
      const next = location.pathname + location.search || '/dashboard';
      location.replace('/login?next=' + encodeURIComponent(next));
      return;
    }
    startRouter(handleLocation);
    return;
  }

  applySession(me);
  startOutcomeFlush();
  startRouter(handleLocation);
}

export { ROLE_SCREENS, ROLES, onRoute };

if (typeof document !== 'undefined' && document.getElementById('app')) {
  boot();
}
