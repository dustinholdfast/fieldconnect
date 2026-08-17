const ROUTES = [
  { pattern: '/login', screen: 'login' },
  { pattern: '/dashboard', screen: 'dashboard' },
  { pattern: '/crm', screen: 'crm' },
  { pattern: '/crm/:personId', screen: 'crm' },
  { pattern: '/scheduling', screen: 'scheduling' },
  { pattern: '/scheduling/:appointmentId', screen: 'scheduling' },
  { pattern: '/outcome', screen: 'outcome' },
  { pattern: '/outcome/:appointmentId', screen: 'outcome' },
  { pattern: '/nurture', screen: 'nurture' },
  { pattern: '/nurture/:journeyId', screen: 'nurture' },
  { pattern: '/lists', screen: 'lists' },
  { pattern: '/lists/:importId', screen: 'lists' },
  { pattern: '/training', screen: 'training' },
  { pattern: '/training/:courseId', screen: 'training' },
  { pattern: '/recruitment', screen: 'recruitment' },
  { pattern: '/stories', screen: 'stories' },
  { pattern: '/admin', screen: 'admin' },
  { pattern: '/forbidden', screen: 'forbidden' },
];

let onChange = null;

export function pathFromHash(hash) {
  if (typeof hash !== 'string' || !hash) return null;
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!raw.startsWith('/')) return null;
  return raw;
}

export function maybeHashRedirect(loc = globalThis.location, hist = globalThis.history) {
  if (!loc) return null;
  const next = pathFromHash(loc.hash);
  if (!next) return null;
  hist?.replaceState({}, '', next);
  return next;
}

function normalizePath(pathname) {
  let path = String(pathname || '/');
  const hashAt = path.indexOf('#');
  if (hashAt !== -1) path = path.slice(0, hashAt);
  const qAt = path.indexOf('?');
  if (qAt !== -1) path = path.slice(0, qAt);
  if (!path.startsWith('/')) path = '/' + path;
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  return path;
}

function parseQuery(search) {
  const query = {};
  const raw = String(search || '');
  const qs = raw.startsWith('?') ? raw.slice(1) : raw;
  if (!qs) return query;
  for (const [key, value] of new URLSearchParams(qs)) query[key] = value;
  return query;
}

function matchRoute(pattern, path) {
  const pParts = pattern.split('/');
  const parts = path.split('/');
  if (pParts.length !== parts.length) return null;
  const params = {};
  for (let i = 0; i < pParts.length; i += 1) {
    if (pParts[i].startsWith(':')) {
      if (!parts[i]) return null;
      params[pParts[i].slice(1)] = decodeURIComponent(parts[i]);
      continue;
    }
    if (pParts[i] !== parts[i]) return null;
  }
  return params;
}

export function parsePath(pathname, search = '') {
  let path = String(pathname || '/');
  let queryStr = search;
  const qAt = path.indexOf('?');
  if (qAt !== -1) {
    queryStr = path.slice(qAt);
    path = path.slice(0, qAt);
  }
  path = normalizePath(path);
  const query = parseQuery(queryStr);

  const ranked = [...ROUTES].sort((a, b) => b.pattern.split('/').length - a.pattern.split('/').length);
  for (const route of ranked) {
    const params = matchRoute(route.pattern, path);
    if (params) {
      return { screen: route.screen, params, query, path, known: true };
    }
  }
  return { screen: null, params: {}, query, path, known: false };
}

export function parse(loc = globalThis.location) {
  if (!loc) return parsePath('/');
  const redirected = pathFromHash(loc.hash);
  if (redirected) return parsePath(redirected, loc.search);
  return parsePath(loc.pathname, loc.search);
}

export function primaryRecordId(route) {
  if (!route || !route.params) return null;
  const p = route.params;
  return p.personId ?? p.appointmentId ?? p.journeyId ?? p.importId ?? p.courseId ?? null;
}

export function fallbackPath(role, allowedScreens) {
  const allowed = allowedScreens || [];
  if (role && allowed.includes('dashboard')) return '/dashboard';
  if (allowed.includes('dashboard')) return '/dashboard';
  return '/forbidden';
}

export function startRouter(handler) {
  onChange = handler;
  if (typeof window !== 'undefined') {
    window.addEventListener('popstate', () => {
      maybeHashRedirect();
      onChange?.(parse());
    });
  }
  maybeHashRedirect();
  onChange?.(parse());
}

export function navigate(path, { replace = false } = {}) {
  const url = path || '/';
  if (typeof history !== 'undefined') {
    if (replace) history.replaceState({ path: url }, '', url);
    else history.pushState({ path: url }, '', url);
  }
  onChange?.(typeof location !== 'undefined' ? parse() : parsePath(url));
}

export { ROUTES };
