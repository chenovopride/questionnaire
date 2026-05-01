const express = require('express');
const session = require('express-session');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { loadConfig, saveConfig } = require('./lib/config');
const { ensureStorage, readCollection, writeCollection } = require('./lib/storage');
const { pickRange, generateStructuredReport, renderReportHtml } = require('./lib/reports');

const ROOT_DIR = path.resolve(__dirname, '..');
const UPLOADS_DIR = path.join(ROOT_DIR, 'uploads');
const USER_PUBLIC_DIR = path.join(ROOT_DIR, 'public', 'user');
const ADMIN_PUBLIC_DIR = path.join(ROOT_DIR, 'public', 'admin');
const COMMON_PUBLIC_DIR = path.join(ROOT_DIR, 'public', 'common');

ensureStorage();
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

function createId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function nowIso() {
  return new Date().toISOString();
}

function createMulter() {
  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase() || '.jpg';
      cb(null, `${Date.now()}-${crypto.randomUUID()}${ext}`);
    },
  });

  return multer({
    storage,
    fileFilter: (_req, file, cb) => {
      if ((file.mimetype || '').startsWith('image/')) {
        cb(null, true);
        return;
      }
      cb(new Error('只允许上传图片文件。'));
    },
    limits: {
      files: 24,
      fileSize: 8 * 1024 * 1024,
    },
  });
}

const upload = createMulter();

function readState() {
  return {
    bugs: readCollection('bugs'),
    suggestions: readCollection('suggestions'),
    reports: readCollection('reports'),
  };
}

function writeState(name, data) {
  writeCollection(name, data);
}

function getConfig() {
  return loadConfig();
}

function getFontPreset(config, presetId) {
  return config.fontPresets.find((item) => item.id === presetId) || config.fontPresets[0];
}

function getThemeResponse(config) {
  const preset = getFontPreset(config, config.theme.fontPreset);
  return {
    colors: config.theme.colors,
    fontPreset: config.theme.fontPreset,
    displayFont: preset.displayFont,
    bodyFont: preset.bodyFont,
    fontPresets: config.fontPresets,
  };
}

function sanitizeThemePayload(payload, config) {
  const next = JSON.parse(JSON.stringify(config));
  const colorKeys = ['mist', 'petal', 'iris', 'violet', 'mint', 'pearl'];

  for (const key of colorKeys) {
    const value = payload.colors?.[key];
    if (typeof value === 'string' && /^#[0-9A-Fa-f]{6}$/.test(value.trim())) {
      next.theme.colors[key] = value.trim();
    }
  }

  const fontPreset = payload.fontPreset;
  if (config.fontPresets.some((item) => item.id === fontPreset)) {
    next.theme.fontPreset = fontPreset;
  }

  return next;
}

function authGuard(req, res, next) {
  if (!req.session.adminUser) {
    res.status(401).json({ message: '请先登录管理员账号。' });
    return;
  }
  next();
}

function parsePayload(req) {
  if (!req.body?.payload) {
    throw new Error('缺少 payload 字段。');
  }

  try {
    return JSON.parse(req.body.payload);
  } catch (error) {
    throw new Error('payload 不是合法 JSON。');
  }
}

function collectImages(files, clientId) {
  return files
    .filter((file) => file.fieldname === `images-${clientId}`)
    .map((file) => `/uploads/${file.filename}`)
    .slice(0, 3);
}

function normalizeContact(item, isAdminFeedback) {
  if (isAdminFeedback) {
    return {
      type: '管理员',
      value: '管理员码反馈',
    };
  }

  if (item.contactType && item.contactValue) {
    return {
      type: item.contactType,
      value: item.contactValue.trim(),
    };
  }

  return null;
}

function removeUploadedFiles(fileUrls = []) {
  for (const fileUrl of fileUrls) {
    const filename = path.basename(fileUrl);
    const absolutePath = path.join(UPLOADS_DIR, filename);
    if (fs.existsSync(absolutePath)) {
      fs.unlinkSync(absolutePath);
    }
  }
}

function filterByKeyword(text, keyword) {
  if (!keyword) {
    return true;
  }
  return String(text || '').toLowerCase().includes(keyword.toLowerCase());
}

function formatAdminMeta(req) {
  return req.session.adminUser ? `管理员 ${req.session.adminUser}` : '访客';
}

async function createServers() {
  const userApp = express();
  const adminApp = express();

  const sessionMiddleware = session({
    secret: 'questionare-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 1000 * 60 * 60 * 12,
    },
  });

  const sharedSetup = (app) => {
    app.use('/common', express.static(COMMON_PUBLIC_DIR));
    app.use('/vendor', express.static(path.join(ROOT_DIR, 'node_modules')));
    app.use('/uploads', express.static(UPLOADS_DIR));
    app.use(express.json({ limit: '2mb' }));
    app.use(express.urlencoded({ extended: true, limit: '2mb' }));
  };

  sharedSetup(userApp);
  sharedSetup(adminApp);
  adminApp.use(sessionMiddleware);

  userApp.get('/api/theme', (_req, res) => {
    res.json(getThemeResponse(getConfig()));
  });

  userApp.post('/api/public/bugs', upload.any(), (req, res) => {
    try {
      const payload = parsePayload(req);
      const config = getConfig();
      const isAdminFeedback = payload.adminCode?.trim() === config.adminPassword;
      const files = Array.isArray(req.files) ? req.files : [];
      const state = readState();
      const items = Array.isArray(payload.items) ? payload.items : [];

      if (!items.length) {
        res.status(400).json({ message: '请至少提交一条 Bug。' });
        return;
      }

      const created = items.map((item) => {
        if (!item.description?.trim()) {
          throw new Error('每条 Bug 都需要填写文字说明。');
        }

        return {
          id: createId('bug'),
          createdAt: nowIso(),
          source: isAdminFeedback ? 'admin' : 'user',
          sourceLabel: isAdminFeedback ? '管理员' : '用户',
          description: item.description.trim(),
          images: collectImages(files, item.clientId),
          contact: normalizeContact(item, isAdminFeedback),
          priority: isAdminFeedback ? item.priority || '中' : '未设置',
          status: '新建',
          developerNote: '',
          adminNote: '',
          updatedAt: nowIso(),
        };
      });

      state.bugs.unshift(...created);
      writeState('bugs', state.bugs);
      res.json({ message: `已提交 ${created.length} 条 Bug。`, count: created.length });
    } catch (error) {
      if (Array.isArray(req.files)) {
        removeUploadedFiles(req.files.map((item) => `/uploads/${item.filename}`));
      }
      res.status(400).json({ message: error.message || '提交 Bug 失败。' });
    }
  });

  userApp.post('/api/public/suggestions', upload.any(), (req, res) => {
    try {
      const payload = parsePayload(req);
      const config = getConfig();
      const isAdminFeedback = payload.adminCode?.trim() === config.adminPassword;
      const files = Array.isArray(req.files) ? req.files : [];
      const state = readState();
      const items = Array.isArray(payload.items) ? payload.items : [];

      if (!items.length) {
        res.status(400).json({ message: '请至少提交一条功能建议。' });
        return;
      }

      const created = items.map((item) => {
        if (!item.description?.trim()) {
          throw new Error('每条功能建议都需要填写文字说明。');
        }
        if (!item.importance?.trim()) {
          throw new Error('每条功能建议都需要填写重要性。');
        }

        return {
          id: createId('suggestion'),
          createdAt: nowIso(),
          source: isAdminFeedback ? 'admin' : 'user',
          sourceLabel: isAdminFeedback ? '管理员' : '用户',
          description: item.description.trim(),
          importance: item.importance,
          images: collectImages(files, item.clientId),
          contact: normalizeContact(item, isAdminFeedback),
          adminPriority: isAdminFeedback ? item.adminPriority || '中' : '未设置',
          status: '待评估',
          adminNote: '',
          updatedAt: nowIso(),
        };
      });

      state.suggestions.unshift(...created);
      writeState('suggestions', state.suggestions);
      res.json({ message: `已提交 ${created.length} 条建议。`, count: created.length });
    } catch (error) {
      if (Array.isArray(req.files)) {
        removeUploadedFiles(req.files.map((item) => `/uploads/${item.filename}`));
      }
      res.status(400).json({ message: error.message || '提交建议失败。' });
    }
  });

  adminApp.post('/api/admin/login', (req, res) => {
    const { username, password } = req.body || {};
    const config = getConfig();

    if (!config.adminUsers.includes(username) || password !== config.adminPassword) {
      res.status(401).json({ message: '管理员名称或密码错误。' });
      return;
    }

    req.session.adminUser = username;
    res.json({ message: '登录成功。', username });
  });

  adminApp.post('/api/admin/logout', authGuard, (req, res) => {
    req.session.destroy(() => {
      res.json({ message: '已退出登录。' });
    });
  });

  adminApp.get('/api/admin/session', (req, res) => {
    if (!req.session.adminUser) {
      res.status(401).json({ message: '未登录。' });
      return;
    }
    res.json({ username: req.session.adminUser });
  });

  adminApp.get('/api/admin/theme', authGuard, (_req, res) => {
    res.json(getThemeResponse(getConfig()));
  });

  adminApp.put('/api/admin/theme', authGuard, (req, res) => {
    const nextConfig = sanitizeThemePayload(req.body || {}, getConfig());
    saveConfig(nextConfig);
    res.json({ message: '主题已更新。', theme: getThemeResponse(nextConfig) });
  });

  adminApp.get('/api/admin/bugs', authGuard, (req, res) => {
    const { keyword = '', status = '', priority = '', source = '' } = req.query;
    const bugs = readCollection('bugs').filter((item) => {
      if (status && item.status !== status) return false;
      if (priority && item.priority !== priority) return false;
      if (source && item.source !== source) return false;
      return filterByKeyword(`${item.description} ${item.adminNote} ${item.developerNote}`, keyword);
    });

    res.json({
      items: bugs,
      summary: {
        total: bugs.length,
        open: bugs.filter((item) => ['新建', '进行中'].includes(item.status)).length,
        high: bugs.filter((item) => item.priority === '高').length,
      },
    });
  });

  adminApp.patch('/api/admin/bugs/:id', authGuard, (req, res) => {
    const bugs = readCollection('bugs');
    const target = bugs.find((item) => item.id === req.params.id);
    if (!target) {
      res.status(404).json({ message: '未找到对应 Bug。' });
      return;
    }

    const allowedStatuses = ['新建', '无法修复', '取消', '进行中', '完成修复'];
    const allowedPriorities = ['低', '中', '高', '未设置'];
    const body = req.body || {};

    target.description = body.description?.trim() || target.description;
    target.status = allowedStatuses.includes(body.status) ? body.status : target.status;
    target.priority = allowedPriorities.includes(body.priority) ? body.priority : target.priority;
    target.developerNote = typeof body.developerNote === 'string' ? body.developerNote.trim() : target.developerNote;
    target.adminNote = typeof body.adminNote === 'string' ? body.adminNote.trim() : target.adminNote;
    target.updatedAt = nowIso();
    target.updatedBy = formatAdminMeta(req);

    writeState('bugs', bugs);
    res.json({ message: 'Bug 已更新。', item: target });
  });

  adminApp.delete('/api/admin/bugs/:id', authGuard, (req, res) => {
    const bugs = readCollection('bugs');
    const index = bugs.findIndex((item) => item.id === req.params.id);
    if (index === -1) {
      res.status(404).json({ message: '未找到对应 Bug。' });
      return;
    }

    const [removed] = bugs.splice(index, 1);
    removeUploadedFiles(removed.images);
    writeState('bugs', bugs);
    res.json({ message: 'Bug 已删除。' });
  });

  adminApp.get('/api/admin/suggestions', authGuard, (req, res) => {
    const { keyword = '', status = '', importance = '', priority = '', source = '' } = req.query;
    const suggestions = readCollection('suggestions').filter((item) => {
      if (status && item.status !== status) return false;
      if (importance && item.importance !== importance) return false;
      if (priority && item.adminPriority !== priority) return false;
      if (source && item.source !== source) return false;
      return filterByKeyword(`${item.description} ${item.adminNote}`, keyword);
    });

    res.json({
      items: suggestions,
      summary: {
        total: suggestions.length,
        pending: suggestions.filter((item) => item.status === '待评估').length,
        high: suggestions.filter((item) => item.adminPriority === '高').length,
      },
    });
  });

  adminApp.patch('/api/admin/suggestions/:id', authGuard, (req, res) => {
    const suggestions = readCollection('suggestions');
    const target = suggestions.find((item) => item.id === req.params.id);
    if (!target) {
      res.status(404).json({ message: '未找到对应建议。' });
      return;
    }

    const allowedStatuses = ['待评估', '已纳入计划', '暂缓', '已完成'];
    const allowedPriorities = ['低', '中', '高', '未设置'];
    const allowedImportance = ['非常重要', '值得优化', '灵感建议'];
    const body = req.body || {};

    target.description = body.description?.trim() || target.description;
    target.status = allowedStatuses.includes(body.status) ? body.status : target.status;
    target.adminPriority = allowedPriorities.includes(body.adminPriority) ? body.adminPriority : target.adminPriority;
    target.importance = allowedImportance.includes(body.importance) ? body.importance : target.importance;
    target.adminNote = typeof body.adminNote === 'string' ? body.adminNote.trim() : target.adminNote;
    target.updatedAt = nowIso();
    target.updatedBy = formatAdminMeta(req);

    writeState('suggestions', suggestions);
    res.json({ message: '建议已更新。', item: target });
  });

  adminApp.delete('/api/admin/suggestions/:id', authGuard, (req, res) => {
    const suggestions = readCollection('suggestions');
    const index = suggestions.findIndex((item) => item.id === req.params.id);
    if (index === -1) {
      res.status(404).json({ message: '未找到对应建议。' });
      return;
    }

    const [removed] = suggestions.splice(index, 1);
    removeUploadedFiles(removed.images);
    writeState('suggestions', suggestions);
    res.json({ message: '建议已删除。' });
  });

  adminApp.get('/api/admin/reports', authGuard, (_req, res) => {
    const reports = readCollection('reports').sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json({ items: reports });
  });

  async function processReport(reportId) {
    const config = getConfig();
    const reports = readCollection('reports');
    const report = reports.find((item) => item.id === reportId);
    if (!report) {
      return;
    }

    try {
      const suggestions = readCollection('suggestions').filter((item) => {
        const createdAt = new Date(item.createdAt).getTime();
        return createdAt >= new Date(report.rangeMeta.from).getTime() && createdAt <= new Date(report.rangeMeta.to).getTime();
      });

      if (!suggestions.length) {
        report.status = 'completed';
        report.completedAt = nowIso();
        report.structured = {
          title: '该时间范围内暂无用户建议',
          overview: '没有新的功能建议进入当前时间范围，因此本次未生成新增需求项。',
          narrative: '建议维持当前产品节奏，并等待下一轮用户反馈进入后再继续归纳。',
          highlights: ['该时间段内没有新增建议', '可优先复盘历史高优先级事项', '可等待下一轮反馈后再次生成'],
          priorities: [],
          requirements: [],
          quickWins: ['整理现有反馈标签', '补充反馈引导文案'],
          risks: ['缺少新样本，容易误判用户趋势'],
          nextActions: ['等待更多反馈后再次生成文档'],
        };
        report.html = renderReportHtml(report.structured, {
          rangeMeta: report.rangeMeta,
          suggestions: [],
        });
        writeState('reports', reports);
        return;
      }

      const { structured, providerName, model } = await generateStructuredReport({
        providers: config.llmProviders,
        rangeMeta: report.rangeMeta,
        suggestions,
      });

      report.status = 'completed';
      report.completedAt = nowIso();
      report.structured = structured;
      report.providerName = providerName;
      report.model = model;
      report.html = renderReportHtml(structured, {
        rangeMeta: report.rangeMeta,
        suggestions,
        providerName,
        model,
      });
      report.sourceCount = suggestions.length;
      writeState('reports', reports);
    } catch (error) {
      report.status = 'failed';
      report.error = error.message;
      report.completedAt = nowIso();
      writeState('reports', reports);
    }
  }

  adminApp.post('/api/admin/reports', authGuard, (req, res) => {
    const { range = 'two-weeks' } = req.body || {};
    const state = readState();
    const rangeMeta = pickRange(range, state.suggestions, state.reports);

    const report = {
      id: createId('report'),
      createdAt: nowIso(),
      createdBy: req.session.adminUser,
      status: 'queued',
      rangeMeta,
      html: '',
      structured: null,
      sourceCount: 0,
      error: '',
    };

    state.reports.unshift(report);
    writeState('reports', state.reports);
    void processReport(report.id);
    res.status(202).json({ message: '已开始生成文档。', item: report });
  });

  userApp.get('/', (_req, res) => res.sendFile(path.join(USER_PUBLIC_DIR, 'index.html')));
  userApp.get('/bug', (_req, res) => res.sendFile(path.join(USER_PUBLIC_DIR, 'bug.html')));
  userApp.get('/suggestions', (_req, res) => res.sendFile(path.join(USER_PUBLIC_DIR, 'suggestions.html')));
  userApp.use(express.static(USER_PUBLIC_DIR));

  adminApp.get('/', (req, res) => {
    if (req.session.adminUser) {
      res.redirect('/dashboard');
      return;
    }
    res.sendFile(path.join(ADMIN_PUBLIC_DIR, 'index.html'));
  });

  adminApp.get('/dashboard', (req, res) => {
    if (!req.session.adminUser) {
      res.redirect('/');
      return;
    }
    res.sendFile(path.join(ADMIN_PUBLIC_DIR, 'dashboard.html'));
  });
  adminApp.use(express.static(ADMIN_PUBLIC_DIR));

  userApp.use((error, _req, res, _next) => {
    res.status(400).json({ message: error.message || '请求失败。' });
  });

  adminApp.use((error, _req, res, _next) => {
    res.status(400).json({ message: error.message || '请求失败。' });
  });

  const config = getConfig();
  userApp.listen(config.ports.user, () => {
    console.log(`用户侧网站已启动: http://localhost:${config.ports.user}`);
  });

  adminApp.listen(config.ports.admin, () => {
    console.log(`管理侧网站已启动: http://localhost:${config.ports.admin}`);
  });
}

createServers().catch((error) => {
  console.error(error);
  process.exit(1);
});
