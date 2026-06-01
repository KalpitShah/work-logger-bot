(function () {
  const form = document.getElementById('login-form');
  const errorEl = document.getElementById('login-error');
  const btn = document.getElementById('login-btn');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.hidden = true;
    btn.disabled = true;
    btn.textContent = 'Signing in…';

    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: document.getElementById('username').value,
          password: document.getElementById('password').value,
        }),
      });

      if (res.ok) {
        window.location.href = '/';
        return;
      }

      const data = await res.json().catch(() => ({}));
      errorEl.textContent = data.error || 'Sign in failed. Please try again.';
      errorEl.hidden = false;
    } catch (err) {
      errorEl.textContent = 'Network error. Please try again.';
      errorEl.hidden = false;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Sign in';
    }
  });
})();
