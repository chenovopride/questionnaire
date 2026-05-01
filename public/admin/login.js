import { requestJson, showToast } from '/common/theme.js';

const form = document.getElementById('loginForm');

form?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(form);
  const payload = Object.fromEntries(formData.entries());
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  button.textContent = '正在登录...';

  try {
    await requestJson('/api/admin/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    window.location.href = '/dashboard';
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    button.disabled = false;
    button.textContent = '进入管理台';
  }
});
