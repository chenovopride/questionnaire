const fs = require('fs');
const path = require('path');

const DATA_DIR = path.resolve(__dirname, '..', '..', 'data');
const FILES = {
  bugs: path.join(DATA_DIR, 'bugs.json'),
  suggestions: path.join(DATA_DIR, 'suggestions.json'),
  reports: path.join(DATA_DIR, 'reports.json'),
};

function ensureStorage() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  for (const filePath of Object.values(FILES)) {
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, '[]\n', 'utf8');
    }
  }
}

function readCollection(name) {
  ensureStorage();
  const filePath = FILES[name];
  if (!filePath) {
    throw new Error(`未知数据集合: ${name}`);
  }

  const raw = fs.readFileSync(filePath, 'utf8').trim();
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    throw new Error(`${name}.json 解析失败: ${error.message}`);
  }
}

function writeCollection(name, data) {
  ensureStorage();
  const filePath = FILES[name];
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

module.exports = {
  DATA_DIR,
  FILES,
  ensureStorage,
  readCollection,
  writeCollection,
};
