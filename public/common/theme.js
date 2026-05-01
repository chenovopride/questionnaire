export const themeColorKeys = ['mist', 'petal', 'iris', 'violet', 'mint', 'pearl'];

export function applyTheme(theme, target = document.documentElement) {
  const source = target.style;
  source.setProperty('--tone-mist', theme.colors.mist);
  source.setProperty('--tone-petal', theme.colors.petal);
  source.setProperty('--tone-iris', theme.colors.iris);
  source.setProperty('--tone-violet', theme.colors.violet);
  source.setProperty('--tone-mint', theme.colors.mint);
  source.setProperty('--tone-pearl', theme.colors.pearl);
  source.setProperty('--display-font', theme.displayFont);
  source.setProperty('--body-font', theme.bodyFont);
}

export async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const isJson = (response.headers.get('content-type') || '').includes('application/json');
  const payload = isJson ? await response.json() : {};

  if (!response.ok) {
    throw new Error(payload.message || '请求失败');
  }

  return payload;
}

export async function loadTheme(url, target = document.documentElement) {
  const theme = await requestJson(url);
  applyTheme(theme, target);
  return theme;
}

export function formatDate(dateValue) {
  return new Date(dateValue).toLocaleString('zh-CN');
}

export function ensureToast() {
  let toast = document.querySelector('.toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  return toast;
}

export function showToast(message, type = 'info') {
  const toast = ensureToast();
  toast.textContent = message;
  toast.className = `toast ${type === 'error' ? 'error' : ''}`.trim();
  requestAnimationFrame(() => toast.classList.add('show'));
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    toast.classList.remove('show');
  }, 2600);
}
