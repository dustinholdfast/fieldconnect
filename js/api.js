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

export async function apiJson(path, opts = {}) {
  const res = await api(path, opts);
  const text = await res.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = null; }
  }
  return { ok: res.ok, status: res.status, data, res };
}

export async function api(path, { method = 'GET', body, headers, silent = false, signal } = {}) {
  const verb = method.toUpperCase();
  const nextHeaders = { ...headers };
  const mutating = verb !== 'GET' && verb !== 'HEAD' && verb !== 'OPTIONS';
  if (mutating && csrfToken) {
    nextHeaders['X-CSRF-Token'] = csrfToken;
  }
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  if (body != null && !isForm && !nextHeaders['Content-Type']) {
    nextHeaders['Content-Type'] = 'application/json';
  }
  const retry = () => api(path, { method, body, headers, silent, signal });
  try {
    const res = await fetch(path, {
      method: verb,
      headers: nextHeaders,
      credentials: 'same-origin',
      signal,
      body: body == null ? undefined : isForm || typeof body === 'string' ? body : JSON.stringify(body),
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
