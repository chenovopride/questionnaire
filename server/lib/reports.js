const SUMMARY_GUIDELINES = {
  'two-weeks': {
    label: '最近两周',
    days: 14,
  },
  'one-month': {
    label: '最近一个月',
    days: 30,
  },
  'since-last': {
    label: '上次总结至今',
    days: null,
  },
};

function pickRange(rangeKey, suggestions, reports) {
  const now = new Date();
  const rule = SUMMARY_GUIDELINES[rangeKey] || SUMMARY_GUIDELINES['two-weeks'];
  let start = new Date(now);

  if (rule.days) {
    start.setDate(start.getDate() - rule.days);
  } else {
    const lastCompleted = [...reports]
      .filter((item) => item.status === 'completed' && item.rangeMeta?.to)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];

    if (lastCompleted) {
      start = new Date(lastCompleted.rangeMeta.to);
    } else if (suggestions.length) {
      start = new Date(
        [...suggestions].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))[0].createdAt,
      );
    }
  }

  return {
    key: rangeKey,
    label: rule.label,
    from: start.toISOString(),
    to: now.toISOString(),
  };
}

function normalizeAssistantText(messageContent) {
  if (Array.isArray(messageContent)) {
    return messageContent
      .map((item) => (typeof item === 'string' ? item : item?.text || ''))
      .join('');
  }

  return typeof messageContent === 'string' ? messageContent : '';
}

function extractJsonPayload(rawText) {
  const fenced = rawText.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : rawText;
  const firstBrace = candidate.indexOf('{');
  const lastBrace = candidate.lastIndexOf('}');

  if (firstBrace === -1 || lastBrace === -1) {
    throw new Error('模型未返回可解析的 JSON。');
  }

  const jsonText = candidate.slice(firstBrace, lastBrace + 1);
  return JSON.parse(jsonText);
}

function normalizeApiUrl(rawUrl) {
  const trimmed = String(rawUrl || '').trim().replace(/\/+$/, '');
  if (/\/chat\/completions$/.test(trimmed)) {
    return trimmed;
  }
  return `${trimmed}/chat/completions`;
}

function buildProviderHeaders(provider, apiUrl) {
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${provider.apiKey}`,
  };

  if (apiUrl.includes('openrouter.ai')) {
    headers['HTTP-Referer'] = 'http://localhost:5012';
    headers['X-Title'] = 'Questionnaire Admin';
  }

  return headers;
}

async function callProvider(provider, payload) {
  const apiUrl = normalizeApiUrl(provider.apiUrl);
  let response;
  try {
    response = await fetch(apiUrl, {
      method: 'POST',
      headers: buildProviderHeaders(provider, apiUrl),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(45000),
    });
  } catch (error) {
    throw new Error(`${provider.name}/${provider.model} 网络错误：${error.message || 'fetch failed'}`);
  }

  if (!response.ok) {
    let detail = '';
    try {
      detail = (await response.text()).slice(0, 200);
    } catch (_error) {
      detail = '';
    }
    throw new Error(`${provider.name}/${provider.model} 请求失败 (${response.status})${detail ? `：${detail}` : ''}`);
  }

  const data = await response.json();
  const content = normalizeAssistantText(data?.choices?.[0]?.message?.content);

  if (!content) {
    throw new Error(`${provider.name}/${provider.model} 未返回正文内容`);
  }

  return extractJsonPayload(content);
}

function buildPrompt(rangeMeta, suggestions) {
  const records = suggestions.map((item) => ({
    id: item.id,
    createdAt: item.createdAt,
    description: item.description,
    importance: item.importance,
    adminPriority: item.adminPriority || '未设置',
    status: item.status,
    contactType: item.contact?.type || '未填写',
    hasImages: Array.isArray(item.images) && item.images.length > 0,
  }));

  return [
    {
      role: 'system',
      content: '你是一名产品经理与需求分析师。请只输出合法 JSON，不要输出 Markdown、解释或代码块。',
    },
    {
      role: 'user',
      content: JSON.stringify(
        {
          task: '请根据用户反馈生成结构化总结与简易需求文档。需要区分优先级，内容用中文。',
          range: rangeMeta,
          outputSchema: {
            title: '字符串，文档标题',
            overview: '字符串，80-160字概览',
            narrative: '字符串，简短的产品洞察描述',
            highlights: ['字符串数组，3-5条洞察'],
            priorities: [
              {
                level: '高/中/低',
                summary: '该优先级总结',
                items: ['该优先级下的要点数组'],
              },
            ],
            requirements: [
              {
                title: '需求标题',
                goal: '要解决的问题',
                userStory: '用户故事',
                acceptance: ['验收标准数组'],
                priority: '高/中/低',
                relatedIds: ['相关反馈 id 数组'],
              },
            ],
            quickWins: ['字符串数组，2-4条'],
            risks: ['字符串数组，2-4条'],
            nextActions: ['字符串数组，2-4条'],
          },
          suggestions: records,
        },
        null,
        2,
      ),
    },
  ];
}

async function generateStructuredReport({ providers, rangeMeta, suggestions }) {
  const messages = buildPrompt(rangeMeta, suggestions);
  const errors = [];

  for (const provider of providers) {
    try {
      const structured = await callProvider(provider, {
        model: provider.model,
        temperature: 0.35,
        messages,
      });
      return {
        structured,
        providerName: provider.name,
        model: provider.model,
      };
    } catch (error) {
      errors.push(error.message);
    }
  }

  throw new Error(errors.join('；') || '没有可用的大模型服务');
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function joinList(items) {
  return (Array.isArray(items) ? items : []).map((item) => `<li>${escapeHtml(item)}</li>`).join('');
}

function renderRelatedCards(relatedMap, requirement) {
  return (Array.isArray(requirement.relatedIds) ? requirement.relatedIds : [])
    .map((id) => relatedMap.get(id))
    .filter(Boolean)
    .slice(0, 3)
    .map((item) => {
      const firstImage = item.images?.[0];
      return `
        <article class="report-related-card">
          ${firstImage ? `<img src="${escapeHtml(firstImage)}" alt="反馈图片" />` : ''}
          <div>
            <span class="report-chip">${escapeHtml(item.importance)} / ${escapeHtml(item.adminPriority || '未设优先级')}</span>
            <p>${escapeHtml(item.description)}</p>
          </div>
        </article>
      `;
    })
    .join('');
}

function renderReportHtml(structured, context) {
  const relatedMap = new Map(context.suggestions.map((item) => [item.id, item]));
  const requirementCards = (Array.isArray(structured.requirements) ? structured.requirements : [])
    .map((requirement) => {
      const relatedCards = renderRelatedCards(relatedMap, requirement);
      return `
        <section class="report-section report-requirement">
          <div class="report-requirement-head">
            <div>
              <span class="report-eyebrow">需求条目</span>
              <h3>${escapeHtml(requirement.title)}</h3>
            </div>
            <span class="report-priority priority-${escapeHtml((requirement.priority || '中').toLowerCase())}">${escapeHtml(requirement.priority || '中')}</span>
          </div>
          <p class="report-goal">${escapeHtml(requirement.goal)}</p>
          <p class="report-story">${escapeHtml(requirement.userStory)}</p>
          <div class="report-grid two-up">
            <div>
              <h4>验收标准</h4>
              <ul>${joinList(requirement.acceptance)}</ul>
            </div>
            <div>
              <h4>关联反馈</h4>
              <div class="report-related-list">${relatedCards || '<p class="report-empty">该需求没有关联截图反馈。</p>'}</div>
            </div>
          </div>
        </section>
      `;
    })
    .join('');

  const priorityPanels = (Array.isArray(structured.priorities) ? structured.priorities : [])
    .map(
      (item) => `
        <div class="report-panel">
          <span class="report-priority priority-${escapeHtml((item.level || '中').toLowerCase())}">${escapeHtml(item.level || '中')}</span>
          <h3>${escapeHtml(item.summary || '')}</h3>
          <ul>${joinList(item.items)}</ul>
        </div>
      `,
    )
    .join('');

  return `
    <article class="report-document">
      <header class="report-hero">
        <div>
          <span class="report-badge">智能产品纪要</span>
          <h1>${escapeHtml(structured.title || '产品优化需求文档')}</h1>
          <p>${escapeHtml(structured.overview || '')}</p>
        </div>
        <aside class="report-meta">
          <span>时间范围</span>
          <strong>${escapeHtml(context.rangeMeta.label)}</strong>
          <small>${escapeHtml(new Date(context.rangeMeta.from).toLocaleString('zh-CN'))} - ${escapeHtml(new Date(context.rangeMeta.to).toLocaleString('zh-CN'))}</small>
          ${context.providerName || context.model ? `
            <span style="margin-top: 8px;">生成模型</span>
            <small>${escapeHtml(context.providerName || '')}${context.providerName && context.model ? ' / ' : ''}${escapeHtml(context.model || '')}</small>
          ` : ''}
        </aside>
      </header>

      <section class="report-section narrative-block">
        <h2>产品洞察</h2>
        <p>${escapeHtml(structured.narrative || '')}</p>
        <ul class="report-highlights">${joinList(structured.highlights)}</ul>
      </section>

      <section class="report-section priority-block">
        <h2>优先级梳理</h2>
        <div class="report-grid three-up">${priorityPanels}</div>
      </section>

      ${requirementCards}

      <section class="report-grid three-up report-tail-grid">
        <div class="report-panel">
          <h3>Quick Wins</h3>
          <ul>${joinList(structured.quickWins)}</ul>
        </div>
        <div class="report-panel">
          <h3>风险提醒</h3>
          <ul>${joinList(structured.risks)}</ul>
        </div>
        <div class="report-panel">
          <h3>下一步动作</h3>
          <ul>${joinList(structured.nextActions)}</ul>
        </div>
      </section>
    </article>
  `;
}

module.exports = {
  SUMMARY_GUIDELINES,
  pickRange,
  generateStructuredReport,
  renderReportHtml,
};
