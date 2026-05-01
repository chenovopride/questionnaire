const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.resolve(__dirname, '..', '..', 'config.cfg');

const defaultConfig = {
  adminPassword: 'asdf',
  adminUsers: ['cyx', 'jy'],
  ports: {
    user: 5011,
    admin: 5012,
  },
  theme: {
    colors: {
      mist: '#F7EFF6',
      petal: '#EDE2F2',
      iris: '#D5C8E8',
      violet: '#8D82C7',
      mint: '#CFFFC0',
      pearl: '#FFFDFE',
    },
    fontPreset: 'velvet-mist',
  },
  fontPresets: [
    {
      id: 'velvet-mist',
      label: 'Velvet Mist',
      displayFont: "'Cormorant Garamond', 'Noto Serif SC', serif",
      bodyFont: "'Noto Sans SC', 'Manrope', sans-serif",
    },
    {
      id: 'moon-story',
      label: 'Moon Story',
      displayFont: "'Lora', 'Noto Serif SC', serif",
      bodyFont: "'Noto Serif SC', 'Noto Sans SC', serif",
    },
    {
      id: 'soft-signal',
      label: 'Soft Signal',
      displayFont: "'Cormorant Garamond', 'Noto Serif SC', serif",
      bodyFont: "'Manrope', 'Noto Sans SC', sans-serif",
    },
  ],
  llmProviders: [],
};

function deepMerge(base, override) {
  if (Array.isArray(base)) {
    return Array.isArray(override) ? override : base;
  }

  if (typeof base !== 'object' || base === null) {
    return override === undefined ? base : override;
  }

  const output = { ...base };
  const source = override && typeof override === 'object' ? override : {};

  for (const key of Object.keys(source)) {
    const nextValue = source[key];

    if (Array.isArray(nextValue)) {
      output[key] = nextValue;
      continue;
    }

    if (nextValue && typeof nextValue === 'object') {
      output[key] = deepMerge(base[key], nextValue);
      continue;
    }

    output[key] = nextValue;
  }

  return output;
}

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    saveConfig(defaultConfig);
    return structuredClone(defaultConfig);
  }

  const raw = fs.readFileSync(CONFIG_PATH, 'utf8').trim();
  if (!raw) {
    saveConfig(defaultConfig);
    return structuredClone(defaultConfig);
  }

  try {
    const parsed = JSON.parse(raw);
    return deepMerge(defaultConfig, parsed);
  } catch (error) {
    throw new Error(`config.cfg 解析失败: ${error.message}`);
  }
}

function saveConfig(config) {
  fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

module.exports = {
  CONFIG_PATH,
  defaultConfig,
  loadConfig,
  saveConfig,
};
