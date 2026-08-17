let csrfToken = null;

export function setCsrfToken(token) {
  csrfToken = token || null;
}

export function getCsrfToken() {
  return csrfToken;
}

export async function api(path, { method = 'GET', body, headers } = {}) {
  const verb = method.toUpperCase();
  const nextHeaders = { ...headers };
  const mutating = verb !== 'GET' && verb !== 'HEAD' && verb !== 'OPTIONS';
  if (mutating && csrfToken) {
    nextHeaders['X-CSRF-Token'] = csrfToken;
  }
  if (body != null && !nextHeaders['Content-Type']) {
    nextHeaders['Content-Type'] = 'application/json';
  }
  return fetch(path, {
    method: verb,
    headers: nextHeaders,
    credentials: 'same-origin',
    body: body == null ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
}
