import { applyTheme, formatDate, loadTheme, requestJson, showToast, themeColorKeys } from '/common/theme.js';

const state = {
  session: null,
  bugs: [],
  suggestions: [],
  reports: [],
  theme: null,
  selectedReportId: '',
};

const bugStatusOptions = ['新建', '进行中', '无法修复', '取消', '完成修复'];
const bugPriorityOptions = ['高', '中', '低', '未设置'];
const suggestionStatusOptions = ['待评估', '已纳入计划', '暂缓', '已完成'];
const suggestionPriorityOptions = ['高', '中', '低', '未设置'];
const suggestionImportanceOptions = ['非常重要', '值得优化', '灵感建议'];

const colorLabels = {
  mist: '主色 1 / 雾白基底',
  petal: '主色 2 / 柔粉层',
  iris: '主色 3 / 浅紫层',
  violet: '主色 4 / 强调紫',
  mint: '点缀色 A / 微量使用',
  pearl: '点缀色 B / 微量使用',
};

function getFormQuery(form) {
  const params = new URLSearchParams();
  new FormData(form).forEach((value, key) => {
    if (String(value).trim()) {
      params.set(key, String(value).trim());
    }
  });
  return params.toString();
}

function renderMetrics(container, summary, items) {
  const metrics = items.map((item) => `
    <article class="metric-card">
      <span>${item.label}</span>
      <strong>${summary[item.key] ?? 0}</strong>
    </article>
  `);
  container.innerHTML = metrics.join('');
}

function optionList(options, current) {
  return options
    .map((option) => `<option value="${option}" ${option === current ? 'selected' : ''}>${option}</option>`)
    .join('');
}

function imageRow(images) {
  if (!images?.length) {
    return '';
  }
  return `
    <div class="image-row">
      ${images.map((src) => `<a href="${src}" target="_blank" rel="noreferrer"><img src="${src}" alt="反馈截图" /></a>`).join('')}
    </div>
  `;
}

function renderBugList() {
  const container = document.getElementById('bugList');
  if (!state.bugs.length) {
    container.innerHTML = '<p class="empty-state">当前没有匹配的 Bug。</p>';
    return;
  }

  container.innerHTML = state.bugs
    .map(
      (item) => `
        <form class="record-card glass-panel" data-kind="bug" data-id="${item.id}">
          <div class="record-head">
            <div>
              <div class="record-tags">
                <span class="tag">${item.sourceLabel}</span>
                <span class="tag">优先级：${item.priority}</span>
                <span class="tag">状态：${item.status}</span>
              </div>
              <h3>${item.description}</h3>
              <p class="record-note">联系：${item.contact ? `${item.contact.type} / ${item.contact.value}` : '未填写'}</p>
            </div>
            <time>${formatDate(item.createdAt)}</time>
          </div>
          ${imageRow(item.images)}
          <div class="record-grid">
            <label>
              <span>状态</span>
              <select name="status">${optionList(bugStatusOptions, item.status)}</select>
            </label>
            <label>
              <span>优先级</span>
              <select name="priority">${optionList(bugPriorityOptions, item.priority)}</select>
            </label>
            <label class="full">
              <span>Bug 文字说明</span>
              <textarea name="description" rows="3">${item.description}</textarea>
            </label>
            <label class="full">
              <span>开发备注</span>
              <textarea name="developerNote" rows="3">${item.developerNote || ''}</textarea>
            </label>
            <label class="full">
              <span>管理员备注</span>
              <textarea name="adminNote" rows="3">${item.adminNote || ''}</textarea>
            </label>
          </div>
          <div class="record-actions">
            <button class="secondary-button" type="submit">保存修改</button>
            <button class="danger-button" type="button" data-delete>删除</button>
          </div>
        </form>
      `,
    )
    .join('');
}

function renderSuggestionList() {
  const container = document.getElementById('suggestionList');
  if (!state.suggestions.length) {
    container.innerHTML = '<p class="empty-state">当前没有匹配的建议。</p>';
    return;
  }

  container.innerHTML = state.suggestions
    .map(
      (item) => `
        <form class="record-card glass-panel" data-kind="suggestion" data-id="${item.id}">
          <div class="record-head">
            <div>
              <div class="record-tags">
                <span class="tag">${item.sourceLabel}</span>
                <span class="tag">重要性：${item.importance}</span>
                <span class="tag">管理员优先级：${item.adminPriority}</span>
                <span class="tag">状态：${item.status}</span>
              </div>
              <h3>${item.description}</h3>
              <p class="record-note">联系：${item.contact ? `${item.contact.type} / ${item.contact.value}` : '未填写'}</p>
            </div>
            <time>${formatDate(item.createdAt)}</time>
          </div>
          ${imageRow(item.images)}
          <div class="record-grid">
            <label>
              <span>状态</span>
              <select name="status">${optionList(suggestionStatusOptions, item.status)}</select>
            </label>
            <label>
              <span>重要性</span>
              <select name="importance">${optionList(suggestionImportanceOptions, item.importance)}</select>
            </label>
            <label>
              <span>管理员优先级</span>
              <select name="adminPriority">${optionList(suggestionPriorityOptions, item.adminPriority)}</select>
            </label>
            <label class="full">
              <span>文字说明</span>
              <textarea name="description" rows="3">${item.description}</textarea>
            </label>
            <label class="full">
              <span>管理员备注</span>
              <textarea name="adminNote" rows="3">${item.adminNote || ''}</textarea>
            </label>
          </div>
          <div class="record-actions">
            <button class="secondary-button" type="submit">保存修改</button>
            <button class="danger-button" type="button" data-delete>删除</button>
          </div>
        </form>
      `,
    )
    .join('');
}

function renderReportHistory() {
  const container = document.getElementById('reportHistory');
  if (!state.reports.length) {
    container.innerHTML = '<p class="empty-state">还没有生成过文档。</p>';
    return;
  }

  container.innerHTML = `
    <div class="report-history-list">
      ${state.reports
        .map(
          (item) => {
            const modelLabel = item.providerName || item.model
              ? `${item.providerName || ''}${item.providerName && item.model ? ' / ' : ''}${item.model || ''}`
              : '';
            return `
            <button class="history-item" type="button" data-report-id="${item.id}">
              <strong>${item.structured?.title || item.rangeMeta.label}</strong>
              <small>${formatDate(item.createdAt)} · ${item.status}</small>
              ${modelLabel ? `<small>模型：${modelLabel}</small>` : ''}
              ${item.error ? `<small>${item.error}</small>` : ''}
            </button>
          `;
          },
        )
        .join('')}
    </div>
  `;
}

function renderSelectedReport() {
  const viewer = document.getElementById('reportViewer');
  const report = state.reports.find((item) => item.id === state.selectedReportId) || state.reports[0];
  if (!report) {
    viewer.innerHTML = '<p class="empty-state">选择一份历史文档，或先发起新的总结任务。</p>';
    return;
  }
  state.selectedReportId = report.id;

  if (report.status === 'failed') {
    viewer.innerHTML = `<p class="empty-state">生成失败：${report.error || '未知错误'}</p>`;
    return;
  }

  if (report.status === 'queued') {
    viewer.innerHTML = '<p class="empty-state">文档仍在生成中，请稍后刷新或等待自动更新。</p>';
    return;
  }

  viewer.innerHTML = report.html || '<p class="empty-state">暂无可展示内容。</p>';
}

function renderThemeControls() {
  const container = document.getElementById('themeControls');
  const theme = state.theme;
  if (!theme) {
    return;
  }

  container.innerHTML = `
    <div>
      <span class="eyebrow">Six color params</span>
      <h3>六个颜色超参 + 字体预设</h3>
      <p>前四个颜色为主层，后两个建议只作为小面积点缀色使用。</p>
    </div>
    <div class="theme-control-grid">
      ${themeColorKeys
        .map(
          (key) => `
            <label class="theme-control" data-color-key="${key}">
              <span>${colorLabels[key]}</span>
              <div class="theme-inline">
                <input type="color" value="${theme.colors[key]}" data-color-picker="${key}" />
                <input type="text" value="${theme.colors[key]}" data-color-text="${key}" />
              </div>
            </label>
          `,
        )
        .join('')}
      <label class="theme-control">
        <span>字体预设</span>
        <select name="fontPreset" id="fontPresetSelect">
          ${theme.fontPresets
            .map((item) => `<option value="${item.id}" ${item.id === theme.fontPreset ? 'selected' : ''}>${item.label}</option>`)
            .join('')}
        </select>
      </label>
    </div>
  `;

  bindThemeControls();
  updateThemePreview();
}

function currentThemeDraft() {
  const fontPreset = document.getElementById('fontPresetSelect')?.value || state.theme.fontPreset;
  const fontConfig = state.theme.fontPresets.find((item) => item.id === fontPreset) || state.theme.fontPresets[0];
  const colors = Object.fromEntries(
    themeColorKeys.map((key) => [key, document.querySelector(`[data-color-text="${key}"]`)?.value || state.theme.colors[key]]),
  );
  return {
    colors,
    fontPreset,
    displayFont: fontConfig.displayFont,
    bodyFont: fontConfig.bodyFont,
    fontPresets: state.theme.fontPresets,
  };
}

function updateThemePreview() {
  const preview = document.getElementById('themePreview');
  if (!preview) {
    return;
  }
  applyTheme(currentThemeDraft(), preview);
}

function bindThemeControls() {
  themeColorKeys.forEach((key) => {
    const picker = document.querySelector(`[data-color-picker="${key}"]`);
    const text = document.querySelector(`[data-color-text="${key}"]`);
    picker?.addEventListener('input', () => {
      text.value = picker.value.toUpperCase();
      updateThemePreview();
    });
    text?.addEventListener('input', () => {
      if (/^#[0-9A-Fa-f]{6}$/.test(text.value.trim())) {
        picker.value = text.value.trim();
        updateThemePreview();
      }
    });
  });

  document.getElementById('fontPresetSelect')?.addEventListener('change', updateThemePreview);
}

async function loadBugs() {
  const query = getFormQuery(document.getElementById('bugFilters'));
  const result = await requestJson(`/api/admin/bugs${query ? `?${query}` : ''}`);
  state.bugs = result.items;
  renderMetrics(document.getElementById('bugMetrics'), result.summary, [
    { label: '当前匹配总数', key: 'total' },
    { label: '待处理 / 进行中', key: 'open' },
    { label: '高优先级', key: 'high' },
  ]);
  renderBugList();
}

async function loadSuggestions() {
  const query = getFormQuery(document.getElementById('suggestionFilters'));
  const result = await requestJson(`/api/admin/suggestions${query ? `?${query}` : ''}`);
  state.suggestions = result.items;
  renderMetrics(document.getElementById('suggestionMetrics'), result.summary, [
    { label: '当前匹配总数', key: 'total' },
    { label: '待评估', key: 'pending' },
    { label: '高优先级', key: 'high' },
  ]);
  renderSuggestionList();
}

async function loadReports() {
  const result = await requestJson('/api/admin/reports');
  state.reports = result.items;
  renderReportHistory();
  renderSelectedReport();
  scheduleReportPolling();
}

function scheduleReportPolling() {
  window.clearInterval(scheduleReportPolling.timer);
  const hasQueued = state.reports.some((item) => item.status === 'queued');
  if (hasQueued) {
    scheduleReportPolling.timer = window.setInterval(() => {
      loadReports().catch((error) => showToast(error.message, 'error'));
    }, 5000);
  }
}

async function updateRecord(kind, form) {
  const id = form.dataset.id;
  const payload = Object.fromEntries(new FormData(form).entries());
  const endpoint = kind === 'bug' ? `/api/admin/bugs/${id}` : `/api/admin/suggestions/${id}`;
  await requestJson(endpoint, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  showToast('保存成功。');
  if (kind === 'bug') {
    await loadBugs();
  } else {
    await loadSuggestions();
  }
}

async function deleteRecord(kind, id) {
  const endpoint = kind === 'bug' ? `/api/admin/bugs/${id}` : `/api/admin/suggestions/${id}`;
  await requestJson(endpoint, { method: 'DELETE' });
  showToast('删除成功。');
  if (kind === 'bug') {
    await loadBugs();
  } else {
    await loadSuggestions();
  }
}

function bindTabSwitching() {
  document.querySelectorAll('[data-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      const target = button.dataset.tab;
      document.querySelectorAll('[data-tab]').forEach((item) => item.classList.toggle('active', item === button));
      document.querySelectorAll('[data-panel]').forEach((panel) => panel.classList.toggle('active', panel.dataset.panel === target));
    });
  });
}

function bindFilterForms() {
  ['bugFilters', 'suggestionFilters'].forEach((id) => {
    document.getElementById(id)?.addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        if (id === 'bugFilters') {
          await loadBugs();
        } else {
          await loadSuggestions();
        }
      } catch (error) {
        showToast(error.message, 'error');
      }
    });
  });
}

function bindRecordActions() {
  document.body.addEventListener('submit', async (event) => {
    const form = event.target.closest('.record-card');
    if (!form) {
      return;
    }
    event.preventDefault();
    const kind = form.dataset.kind;
    try {
      await updateRecord(kind, form);
    } catch (error) {
      showToast(error.message, 'error');
    }
  });

  document.body.addEventListener('click', async (event) => {
    const deleteButton = event.target.closest('[data-delete]');
    const historyButton = event.target.closest('[data-report-id]');
    const rangeButton = event.target.closest('[data-range]');

    if (deleteButton) {
      const form = deleteButton.closest('.record-card');
      if (!form) {
        return;
      }
      const kind = form.dataset.kind;
      const confirmed = window.confirm('确定删除这条记录吗？');
      if (!confirmed) {
        return;
      }
      try {
        await deleteRecord(kind, form.dataset.id);
      } catch (error) {
        showToast(error.message, 'error');
      }
      return;
    }

    if (historyButton) {
      state.selectedReportId = historyButton.dataset.reportId;
      renderSelectedReport();
      return;
    }

    if (rangeButton) {
      try {
        await requestJson('/api/admin/reports', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ range: rangeButton.dataset.range }),
        });
        showToast('已开始生成文档。');
        await loadReports();
      } catch (error) {
        showToast(error.message, 'error');
      }
    }
  });
}

function bindThemeForm() {
  document.getElementById('themeForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const payload = currentThemeDraft();
    try {
      const result = await requestJson('/api/admin/theme', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          colors: payload.colors,
          fontPreset: payload.fontPreset,
        }),
      });
      state.theme = result.theme;
      applyTheme(state.theme);
      renderThemeControls();
      showToast('用户站风格已保存。');
    } catch (error) {
      showToast(error.message, 'error');
    }
  });
}

async function bootstrap() {
  try {
    state.session = await requestJson('/api/admin/session');
    document.getElementById('welcomeText').textContent = `欢迎回来，${state.session.username}`;
    state.theme = await loadTheme('/api/admin/theme');
    renderThemeControls();
    applyTheme(state.theme);
    bindTabSwitching();
    bindFilterForms();
    bindRecordActions();
    bindThemeForm();
    document.getElementById('logoutButton').addEventListener('click', async () => {
      await requestJson('/api/admin/logout', { method: 'POST' });
      window.location.href = '/';
    });

    await Promise.all([loadBugs(), loadSuggestions(), loadReports()]);
  } catch (error) {
    showToast(error.message, 'error');
    window.setTimeout(() => {
      window.location.href = '/';
    }, 1200);
  }
}

bootstrap();
