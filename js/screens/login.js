import { api, setCsrfToken } from '../api.js';

export function render() {
  return (
    '<div class="fc-login">' +
      '<div class="fc-brand-name">FieldConnect</div>' +
      '<div class="kicker">Event → Field Conversion</div>' +
      '<form id="login-form" method="post" action="/api/auth/login">' +
        '<div class="fc-field">' +
          '<label for="login-email">Email</label>' +
          '<input id="login-email" class="input" type="email" name="email" required autocomplete="username" />' +
        '</div>' +
        '<div class="fc-field">' +
          '<label for="login-password">Password</label>' +
          '<input id="login-password" class="input" type="password" name="password" required autocomplete="current-password" />' +
        '</div>' +
        '<button type="submit" class="btn btn-primary">Sign in</button>' +
      '</form>' +
      '<p id="login-error" class="hidden"></p>' +
    '</div>'
  );
}

export function mount(el, { onSuccess } = {}) {
  const form = el.querySelector('#login-form');
  const errorEl = el.querySelector('#login-error');
  if (!form) return;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (errorEl) {
      errorEl.classList.add('hidden');
      errorEl.textContent = '';
    }
    const data = new FormData(form);
    let res;
    try {
      res = await api('/api/auth/login', {
        method: 'POST',
        body: {
          email: String(data.get('email') || ''),
          password: String(data.get('password') || ''),
        },
      });
    } catch {
      showError(errorEl, 'Cannot reach FieldConnect.');
      return;
    }
    if (res.status === 401) {
      showError(errorEl, 'Email or password is not recognised.');
      return;
    }
    if (res.status === 429) {
      showError(errorEl, 'Too many sign-in attempts. Please wait 15 minutes.');
      return;
    }
    if (!res.ok) {
      showError(errorEl, 'Cannot reach FieldConnect.');
      return;
    }
    const payload = await res.json();
    setCsrfToken(payload.csrfToken);
    onSuccess?.(payload);
  });
}

function showError(el, message) {
  if (!el) return;
  el.textContent = message;
  el.classList.remove('hidden');
}
