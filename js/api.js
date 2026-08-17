let csrfToken = null;
let errorHandler = null;

export function setCsrfToken(token) {
  csrfToken = token || null;
}

export function getCsrfToken() {
  return csrfToken;
}

export function setApiErrorHandler(fn) {
  errorHandler = fn;
}

function report(err) {
  errorHandler?.(err);
}

export async function api(path, { method = 'GET', body, headers, silent = false } = {}) {
  const verb = method.toUpperCase();
  const nextHeaders = { ...headers };
  const mutating = verb !== 'GET' && verb !== 'HEAD' && verb !== 'OPTIONS';
  if (mutating && csrfToken) {
    nextHeaders['X-CSRF-Token'] = csrfToken;
  }
  if (body != null && !nextHeaders['Content-Type']) {
    nextHeaders['Content-Type'] = 'application/json';
  }
  const retry = () => api(path, { method, body, headers, silent });
  try {
    const res = await fetch(path, {
      method: verb,
      headers: nextHeaders,
      credentials: 'same-origin',
      body: body == null ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    if (!silent && !res.ok) {
      report({ path, status: res.status, retry });
    }
    return res;
  } catch (err) {
    if (!silent) report({ path, network: true, retry });
    throw err;
  }
}
