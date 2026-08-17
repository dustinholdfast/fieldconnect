export const SCREENS = [
  'dashboard',
  'crm',
  'scheduling',
  'outcome',
  'nurture',
  'lists',
  'training',
  'recruitment',
  'stories',
  'admin',
];

export const ROLE_SCREENS = {
  fsm: ['dashboard', 'crm', 'scheduling', 'outcome', 'training'],
  manager: ['dashboard', 'crm', 'scheduling', 'nurture', 'lists', 'training', 'recruitment', 'stories'],
  admin: [...SCREENS],
};

export const ROLE_LABELS = {
  fsm: 'Field Staff Member',
  manager: 'Campaign manager / host',
  admin: 'Platform administrator',
};

// Allow matrix: true | 'asg' | 'own' | false (403) | 'unauth' | 'public'.
export const ROUTE_ROLES = [
  { method: 'POST', path: '/api/auth/login', fsm: 'unauth', manager: 'unauth', admin: 'unauth' },
  { method: 'POST', path: '/api/auth/logout', fsm: true, manager: true, admin: true },
  { method: 'GET', path: '/api/auth/me', fsm: true, manager: true, admin: true },
  { method: 'GET', path: '/api/people', fsm: 'asg', manager: true, admin: true },
  { method: 'POST', path: '/api/people', fsm: false, manager: true, admin: true },
  { method: 'GET', path: '/api/people/:id', fsm: 'asg', manager: true, admin: true },
  { method: 'PATCH', path: '/api/people/:id', fsm: 'asg', manager: true, admin: true },
  { method: 'POST', path: '/api/people/:id/merge', fsm: false, manager: true, admin: true },
  { method: 'POST', path: '/api/people/:id/send-link', fsm: 'asg', manager: true, admin: true },
  { method: 'GET', path: '/api/people/:id/engagements', fsm: 'asg', manager: true, admin: true },
  { method: 'GET', path: '/api/scheduling/summary', fsm: 'own', manager: true, admin: true },
  { method: 'GET', path: '/api/scheduling/slots', fsm: 'own', manager: true, admin: true },
  { method: 'GET', path: '/api/scheduling/offer/:token', fsm: 'own', manager: true, admin: true },
  { method: 'GET', path: '/api/appointments', fsm: 'own', manager: true, admin: true },
  { method: 'POST', path: '/api/appointments', fsm: 'own', manager: true, admin: true },
  { method: 'GET', path: '/api/appointments/:id', fsm: 'own', manager: true, admin: true },
  { method: 'PATCH', path: '/api/appointments/:id', fsm: 'own', manager: true, admin: true },
  { method: 'GET', path: '/api/catalog', fsm: true, manager: true, admin: true },
  { method: 'GET', path: '/api/pathways', fsm: true, manager: true, admin: true },
  { method: 'POST', path: '/api/outcomes', fsm: 'own', manager: false, admin: false },
  { method: 'GET', path: '/api/outcomes/:id', fsm: 'own', manager: false, admin: true },
  { method: 'GET', path: '/api/imports', fsm: false, manager: true, admin: true },
  { method: 'POST', path: '/api/imports', fsm: false, manager: true, admin: true },
  { method: 'GET', path: '/api/imports/:id', fsm: false, manager: true, admin: true },
  { method: 'PATCH', path: '/api/imports/:id', fsm: false, manager: true, admin: true },
  { method: 'POST', path: '/api/imports/:id/validate', fsm: false, manager: true, admin: true },
  { method: 'POST', path: '/api/imports/:id/activate', fsm: false, manager: true, admin: true },
  { method: 'GET', path: '/api/dashboard', fsm: 'own', manager: true, admin: true },
  { method: 'GET', path: '/api/attention', fsm: 'own', manager: true, admin: true },
  { method: 'POST', path: '/api/exports/metapulse', fsm: false, manager: false, admin: true },
  { method: 'GET', path: '/api/exports', fsm: false, manager: false, admin: true },
  { method: 'GET', path: '/api/audit', fsm: false, manager: false, admin: true },
  { method: 'GET', path: '/api/training', fsm: true, manager: true, admin: true },
  { method: 'GET', path: '/api/journeys', fsm: false, manager: true, admin: true },
  { method: 'GET', path: '/api/stories', fsm: false, manager: true, admin: true },
  { method: 'POST', path: '/api/stories/:id/advance', fsm: false, manager: true, admin: true },
  { method: 'GET', path: '/api/recruitment', fsm: false, manager: true, admin: true },
  { method: 'GET', path: '/api/orgs', fsm: false, manager: false, admin: true },
  { method: 'GET', path: '/api/admin/integration', fsm: false, manager: false, admin: true },
  { method: 'GET', path: '/metrics', fsm: false, manager: false, admin: true },
  { method: 'GET', path: '/healthz', fsm: 'public', manager: 'public', admin: 'public' },
];

export function screensForRole(role) {
  return ROLE_SCREENS[role] ? [...ROLE_SCREENS[role]] : [];
}

export function isAdmin(role) {
  return role === 'admin';
}

function matchPath(pattern, pathname) {
  if (pattern === pathname) return true;
  const patternParts = pattern.split('/');
  const pathParts = pathname.split('/');
  if (patternParts.length !== pathParts.length) return false;
  for (let i = 0; i < patternParts.length; i += 1) {
    if (patternParts[i].startsWith(':')) continue;
    if (patternParts[i] !== pathParts[i]) return false;
  }
  return true;
}

export function allowRoute(role, method, pathname) {
  const verb = String(method || 'GET').toUpperCase();
  const row = ROUTE_ROLES.find((entry) => entry.method === verb && matchPath(entry.path, pathname));
  if (!row) return null;
  return row[role] ?? false;
}
