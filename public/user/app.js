import { loadTheme, requestJson, showToast } from '/common/theme.js';

const page = document.body.dataset.page;

const pageConfig = {
  bug: {
    api: '/api/public/bugs',
    addLabel: 'Bug',
    itemHint: '描述出现问题的场景、操作步骤和实际结果。',
  },
  suggestions: {
    api: '/api/public/suggestions',
    addLabel: '建议',
    itemHint: '描述你希望新增或优化的功能，以及它为什么重要。',
  },
};

function createPreviewTile(file) {
  const wrapper = document.createElement('div');
  wrapper.className = 'preview-tile';
  const image = document.createElement('img');
  image.src = URL.createObjectURL(file);
  image.alt = file.name;
  image.onload = () => URL.revokeObjectURL(image.src);
  const label = document.createElement('span');
  label.textContent = file.name;
  wrapper.append(image, label);
  return wrapper;
}

function getImportanceOptions() {
  return `
    <option value="非常重要">非常重要</option>
    <option value="值得优化">值得优化</option>
    <option value="灵感建议">灵感建议</option>
  `;
}

function getPriorityOptions() {
  return `
    <option value="低">低</option>
    <option value="中" selected>中</option>
    <option value="高">高</option>
  `;
}

function buildEntryTemplate(type, index) {
  const isBug = type === 'bug';
  return `
    <article class="entry-card glass-panel fade-rise">
      <div class="entry-head">
        <div>
          <h2 class="entry-title">${isBug ? 'Bug' : '建议'} #${index}</h2>
          <p class="entry-subtitle">${pageConfig[type].itemHint}</p>
        </div>
        <button class="remove-entry" type="button">删除这一条</button>
      </div>

      <div class="entry-grid">
        <label class="field full">
          <span>${isBug ? '* Bug 文字说明' : '* 文字说明'}</span>
          <textarea name="description" required placeholder="${isBug ? '例如：点击提交后页面一直转圈，没有任何成功提示。' : '例如：希望在会话列表里加入收藏与分组能力。'}"></textarea>
        </label>

        ${isBug ? '' : `
          <label class="field">
            <span>* 重要性</span>
            <select name="importance" required>${getImportanceOptions()}</select>
          </label>
        `}

        <label class="field ${isBug ? '' : ''}">
          <span>${isBug ? '截图（0-3 张）' : '图片说明（0-3 张）'}</span>
          <input type="file" name="images" accept="image/*" multiple />
          <div class="file-caption">建议上传关键界面或问题现场图。最多 3 张，单张不超过 8MB。</div>
          <div class="preview-grid" data-preview></div>
        </label>

        <label class="field">
          <span>联系方式类型（选填）</span>
          <select name="contactType">
            <option value="">不填写</option>
            <option value="微信号">微信号</option>
            <option value="小红书号">小红书号</option>
            <option value="QQ号">QQ号</option>
          </select>
        </label>

        <label class="field">
          <span>联系方式内容（选填）</span>
          <input name="contactValue" type="text" placeholder="例如：lume-feedback" />
        </label>

        <label class="field admin-fields">
          <span>${isBug ? 'Bug 优先级（仅管理员）' : '管理员优先级（仅管理员）'}</span>
          <select name="${isBug ? 'priority' : 'adminPriority'}">${getPriorityOptions()}</select>
        </label>
      </div>
    </article>
  `;
}

function refreshRemoveButtons(container) {
  const cards = [...container.children];
  cards.forEach((card, index) => {
    const button = card.querySelector('.remove-entry');
    button.disabled = cards.length === 1;
    button.textContent = cards.length === 1 ? '至少保留一条' : '删除这一条';
    const title = card.querySelector('.entry-title');
    title.textContent = `${page === 'bug' ? 'Bug' : '建议'} #${index + 1}`;
  });
}

function bindEntryBehaviors(card, container) {
  const fileInput = card.querySelector('input[type="file"]');
  const preview = card.querySelector('[data-preview]');
  const removeButton = card.querySelector('.remove-entry');

  fileInput.addEventListener('change', () => {
    preview.innerHTML = '';
    const files = [...fileInput.files];
    if (files.length > 3) {
      showToast('每条记录最多上传 3 张图片。', 'error');
      fileInput.value = '';
      return;
    }

    files.forEach((file) => preview.append(createPreviewTile(file)));
  });

  removeButton.addEventListener('click', () => {
    card.remove();
    refreshRemoveButtons(container);
  });
}

function toggleAdminFields(isVisible) {
  document.querySelectorAll('.admin-fields').forEach((field) => {
    field.classList.toggle('visible', isVisible);
  });
}

function addEntry(container) {
  const wrapper = document.createElement('div');
  wrapper.innerHTML = buildEntryTemplate(page, container.children.length + 1).trim();
  const card = wrapper.firstElementChild;
  card.dataset.entryId = crypto.randomUUID();
  container.appendChild(card);
  bindEntryBehaviors(card, container);
  refreshRemoveButtons(container);
  toggleAdminFields(Boolean(document.querySelector('input[name="adminCode"]').value.trim()));
}

function serializeEntries(container) {
  return [...container.querySelectorAll('.entry-card')].map((card) => {
    const fileInput = card.querySelector('input[type="file"]');
    return {
      clientId: card.dataset.entryId,
      description: card.querySelector('[name="description"]').value.trim(),
      importance: card.querySelector('[name="importance"]')?.value || '',
      contactType: card.querySelector('[name="contactType"]').value,
      contactValue: card.querySelector('[name="contactValue"]').value.trim(),
      priority: card.querySelector('[name="priority"]')?.value || '',
      adminPriority: card.querySelector('[name="adminPriority"]')?.value || '',
      files: [...fileInput.files],
    };
  });
}

async function submitFeedback(form, container) {
  const config = pageConfig[page];
  const items = serializeEntries(container);
  if (!items.every((item) => item.description)) {
    showToast('每条记录都需要填写文字说明。', 'error');
    return;
  }

  if (page === 'suggestions' && !items.every((item) => item.importance)) {
    showToast('每条建议都需要选择重要性。', 'error');
    return;
  }

  if (items.some((item) => item.files.length > 3)) {
    showToast('每条记录最多上传 3 张图片。', 'error');
    return;
  }

  const payload = {
    adminCode: form.querySelector('[name="adminCode"]').value.trim(),
    items: items.map(({ files, ...item }) => item),
  };

  const formData = new FormData();
  formData.append('payload', JSON.stringify(payload));
  items.forEach((item) => {
    item.files.forEach((file) => {
      formData.append(`images-${item.clientId}`, file);
    });
  });

  const submitButton = form.querySelector('.submit-button');
  submitButton.disabled = true;
  submitButton.textContent = '正在提交...';

  try {
    const result = await requestJson(config.api, {
      method: 'POST',
      body: formData,
    });
    showToast(result.message);
    form.reset();
    container.innerHTML = '';
    addEntry(container);
    toggleAdminFields(false);
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = page === 'bug' ? '提交本次 Bug 反馈' : '提交本次建议';
  }
}

async function initForm() {
  const form = document.querySelector('[data-feedback-form]');
  if (!form) {
    return;
  }

  const container = form.querySelector('[data-entry-container]');
  const addButton = form.querySelector('[data-add-entry]');
  const adminCodeInput = form.querySelector('[name="adminCode"]');

  addEntry(container);

  addButton.addEventListener('click', () => addEntry(container));
  adminCodeInput.addEventListener('input', () => {
    toggleAdminFields(Boolean(adminCodeInput.value.trim()));
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    await submitFeedback(form, container);
  });
}

async function bootstrap() {
  try {
    await loadTheme('/api/theme');
  } catch (error) {
    showToast(`主题加载失败：${error.message}`, 'error');
  }

  if (page === 'bug' || page === 'suggestions') {
    await initForm();
  }
}

bootstrap();
