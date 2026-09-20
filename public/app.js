const $ = (sel) => document.querySelector(sel);
const state = {
  view: 'trending',
  stars: new Set(),
  starDetails: new Map(),
  languages: [],
  lastTrending: [],
  lastSearch: [],
  readmes: {},
};

// 关键词两侧必须是非字母，避免 said/aid、maintain/ai 这类误判
const AI_RE = /(?:^|[^a-z])(ai|a\.i\.|llm|gpt|chatgpt|claude|gemini|agent|agentic|rag|fine-?tune|prompt|inference|embedding|vector ?db|machine learning|deep learning|neural|copilot|cursor|mcp|transformer|diffusion|langchain|openai|anthropic|qwen|llama)(?:$|[^a-z])/i;

// Pages 上没有 /api/meta，语言列表必须内置
const LANGUAGES = [
  ['', '全部语言'],
  ['typescript', 'TypeScript'],
  ['javascript', 'JavaScript'],
  ['python', 'Python'],
  ['go', 'Go'],
  ['rust', 'Rust'],
  ['java', 'Java'],
  ['swift', 'Swift'],
  ['kotlin', 'Kotlin'],
  ['c++', 'C++'],
  ['shell', 'Shell'],
];

const isAI = (r) => AI_RE.test(`${r.fullName} ${r.description || ''}`);

function applyFilter(repos, onlyAi) {
  return onlyAi ? repos.filter(isAI) : repos;
}

// Pages 上没有后端：trending 读预生成快照，搜索直连 GitHub API，收藏存浏览器本地
const STATIC = location.hostname.endsWith('github.io');
const LANG_CODE = {
  TypeScript: 'typescript', JavaScript: 'javascript', Python: 'python', Go: 'go',
  Rust: 'rust', Java: 'java', Swift: 'swift', Kotlin: 'kotlin', 'C++': 'c++', Shell: 'shell',
};

const LS_KEY = 'github-star-map:stars';

function localStars() {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveLocalStars(list) {
  localStorage.setItem(LS_KEY, JSON.stringify(list));
}

const LANG_COLORS = [
  '#f1e05a', '#3178c6', '#3572A5', '#00ADD8', '#dea584',
  '#e34c26', '#563d7c', '#ff69b4', '#428bca', '#986d35',
  '#c1a9e5', '#5a5fc5', '#b07219', '#89e051', '#4f5d95',
];

function colorOf(lang) {
  if (!lang) return '#8b949e';
  const idx = state.languages.findIndex((l) => l[1] === lang || l[0] === lang.toLowerCase());
  if (idx >= 0) return LANG_COLORS[idx % LANG_COLORS.length];
  let hash = 0;
  for (const ch of lang) hash = (hash * 31 + ch.charCodeAt(0)) % 9973;
  return LANG_COLORS[hash % LANG_COLORS.length];
}

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

async function api(path, options) {
  const res = await fetch(path, options);
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error) throw new Error(body.error || `请求失败 (${res.status})`);
  return body;
}

function fmt(n) {
  if (n >= 1000) return (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k';
  return String(n);
}

function skeleton(grid, n = 8) {
  grid.innerHTML = Array.from({ length: n }, () => '<div class="skeleton"></div>').join('');
}

function cardHtml(r) {
  const starred = state.stars.has(r.fullName);
  return `<div class="card" data-repo="${r.fullName}">
  <h3><a href="${r.url}" target="_blank" rel="noreferrer">${r.fullName}</a></h3>
  <p class="desc">${r.description ? escapeHtml(r.description) : '（无描述）'}</p>
  <div class="meta">
    ${r.language ? `<span class="lang"><span class="dot" style="background:${colorOf(r.language)}"></span>${escapeHtml(r.language)}</span>` : ''}
    <span class="stars">★ ${fmt(r.stars)}</span>
    <span>⑂ ${fmt(r.forks)}</span>
    ${r.addedStars ? `<span class="gain">+${fmt(r.addedStars)}</span>` : ''}
  </div>
  <div class="card-foot">
    <button class="readme-btn" data-readme="${r.owner}/${r.name}" data-repo="${r.fullName}">README</button>
    <button class="star-btn ${starred ? 'on' : ''}" data-star="${r.fullName}">
      ${starred ? '已收藏' : '☆ 收藏'}
    </button>
  </div>
  <div class="readme" id="readme-${r.fullName.replace(/[^A-Za-z0-9]/g, '_')}" hidden></div>
</div>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// GitHub 渲染好的 README 属于第三方内容，注入前必须清洗
function sanitize(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  tpl.content
    .querySelectorAll('script, style, iframe, object, embed, link, meta')
    .forEach((n) => n.remove());
  for (const el of tpl.content.querySelectorAll('*')) {
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      if (name.startsWith('on')) el.removeAttribute(attr.name);
      if ((name === 'href' || name === 'src') && /^\s*javascript:/i.test(attr.value)) {
        el.removeAttribute(attr.name);
      }
    }
    if (el.tagName === 'A') {
      el.setAttribute('target', '_blank');
      el.setAttribute('rel', 'noreferrer noopener');
    }
  }
  return tpl.innerHTML;
}

async function fetchReadme(slug) {
  const path = STATIC
    ? `https://api.github.com/repos/${slug}/readme`
    : `/api/readme?repo=${encodeURIComponent(slug)}`;
  const res = await fetch(path, { headers: { Accept: 'application/vnd.github.html' } });
  if (res.status === 404) return { notFound: true };
  if (res.status === 403 || res.status === 429) return { error: 'GitHub 匿名接口限流（每小时 60 次），稍后再试' };
  if (!res.ok) return { error: `GitHub 返回 ${res.status}` };
  return { html: await res.text() };
}

async function toggleReadme(btn) {
  const slug = btn.dataset.readme;
  const box = document.getElementById(`readme-${btn.dataset.repo.replace(/[^A-Za-z0-9]/g, '_')}`);
  if (!box) return;

  if (!box.hidden) {
    box.hidden = true;
    btn.textContent = 'README';
    return;
  }

  box.hidden = false;
  btn.textContent = '收起';

  if (box.dataset.loaded === '1') return;

  if (state.readmes[slug]) {
    box.innerHTML = state.readmes[slug];
    box.dataset.loaded = '1';
    return;
  }

  box.innerHTML = '<p class="readme-hint">加载中…</p>';
  btn.disabled = true;
  try {
    const result = await fetchReadme(slug);
    if (result.notFound) {
      box.innerHTML = '<p class="readme-hint">这个仓库没有 README</p>';
    } else if (result.error) {
      box.innerHTML = `<p class="readme-hint err">${escapeHtml(result.error)}</p>`;
    } else {
      const clean = sanitize(result.html);
      state.readmes[slug] = clean;
      box.innerHTML = clean;
    }
    box.dataset.loaded = '1';
  } catch (err) {
    box.innerHTML = `<p class="readme-hint err">${escapeHtml(err.message)}</p>`;
  } finally {
    btn.disabled = false;
  }
}

function render(grid, repos, emptyText) {
  if (!repos.length) {
    grid.innerHTML = `<div class="empty">${emptyText}</div>`;
    return;
  }
  grid.innerHTML = repos.map(cardHtml).join('');
}

async function fetchTrending(lang, since) {
  if (!STATIC) {
    const qs = new URLSearchParams({ since });
    if (lang) qs.set('language', lang);
    const { repos } = await api(`/api/trending?${qs}`);
    return { repos, builtAt: null };
  }
  const key = `${lang || 'all'}__${since}.json`;
  const repos = await (await fetch(`data/${key}`)).json().catch(() => {
    throw new Error(`快照 ${key} 缺失，等下一次 Actions 构建`);
  });
  const { builtAt } = await (await fetch('data/manifest.json')).json().catch(() => ({ builtAt: null }));
  return { repos, builtAt };
}

function snapshotNote(builtAt) {
  if (!builtAt) return '';
  const d = new Date(builtAt);
  return ` · 快照 ${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

async function loadTrending(hintEl) {
  const grid = $('#trendingGrid');
  skeleton(grid);
  hintEl.textContent = STATIC ? '读取最新快照…' : '正在抓取 GitHub Trending…';
  hintEl.classList.remove('err');
  try {
    const { repos, builtAt } = await fetchTrending($('#langSelect').value, $('#sinceSelect').value);
    state.lastTrending = repos;
    state.builtAt = builtAt;
    renderTrending();
  } catch (err) {
    grid.innerHTML = `<div class="empty">${escapeHtml(err.message)}</div>`;
    hintEl.textContent = '加载失败';
    hintEl.classList.add('err');
  }
}

function renderTrending() {
  const onlyAi = $('#aiOnly').checked;
  const shown = applyFilter(state.lastTrending, onlyAi);
  render($('#trendingGrid'), shown, onlyAi ? '这个筛选条件下没有 AI 相关仓库' : '这个组合下没有结果');
  const hint = $('#trendingHint');
  hint.classList.remove('err');
  const note = STATIC ? snapshotNote(state.builtAt) : '';
  hint.textContent = onlyAi
    ? `${shown.length} / ${state.lastTrending.length} 个仓库与 AI 相关${note}`
    : `${shown.length} 个仓库${STATIC ? ` · Actions 预生成快照${note}` : ' · 来自 github.com/trending'}`;
}

async function runSearch(q) {
  if (STATIC) {
    const res = await fetch(
      `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&per_page=30`,
      { headers: { Accept: 'application/vnd.github+json' } },
    );
    if (res.status === 403 || res.status === 429) throw new Error('GitHub 匿名搜索限流（每分钟约 10 次），稍等再试');
    if (!res.ok) throw new Error(`GitHub API 返回 ${res.status}`);
    const body = await res.json();
    return (body.items || []).map((it) => ({
      fullName: it.full_name,
      name: it.name,
      owner: it.owner?.login || '',
      url: it.html_url,
      description: it.description || '',
      language: it.language || '',
      stars: it.stargazers_count || 0,
      forks: it.forks_count || 0,
      addedStars: 0,
    }));
  }
  const { repos } = await api(`/api/search?q=${encodeURIComponent(q)}&limit=30`);
  return repos;
}

async function doSearch() {
  const q = $('#searchInput').value.trim();
  const hint = $('#searchHint');
  if (!q) { toast('先输入关键词'); return; }
  hint.classList.remove('err');
  skeleton($('#searchGrid'));
  hint.textContent = '搜索中…';
  try {
    state.lastSearch = await runSearch(q);
    renderSearch();
  } catch (err) {
    $('#searchGrid').innerHTML = `<div class="empty">${escapeHtml(err.message)}</div>`;
    hint.textContent = '搜索失败';
    hint.classList.add('err');
  }
}

function renderSearch() {
  const onlyAi = $('#aiOnlySearch').checked;
  const shown = applyFilter(state.lastSearch, onlyAi);
  render($('#searchGrid'), shown, '没有匹配的仓库');
  $('#searchHint').textContent = onlyAi
    ? `${shown.length} / ${state.lastSearch.length} 个结果与 AI 相关`
    : `${shown.length} 个结果`;
}

async function refreshStars() {
  const stars = STATIC
    ? localStars()
    : (await api('/api/stars')).stars;
  state.stars = new Set(stars.map((s) => s.fullName));
  state.starDetails = new Map(stars.map((s) => [s.fullName, s]));
  $('#starCount').textContent = String(stars.length);
  document.querySelectorAll('[data-star]').forEach((btn) => {
    const on = state.stars.has(btn.dataset.star);
    btn.classList.toggle('on', on);
    btn.textContent = on ? '已收藏' : '☆ 收藏';
  });
  return stars;
}

async function toggleStar(fullName) {
  if (STATIC) {
    const list = localStars();
    if (state.stars.has(fullName)) {
      saveLocalStars(list.filter((s) => s.fullName !== fullName));
      toast(`已取消收藏 ${fullName}`);
    } else {
      list.unshift({ fullName, at: new Date().toISOString() });
      saveLocalStars(list);
      toast(`已收藏 ${fullName}`);
    }
  } else if (state.stars.has(fullName)) {
    await api(`/api/stars?fullName=${encodeURIComponent(fullName)}`, { method: 'DELETE' });
    toast(`已取消收藏 ${fullName}`);
  } else {
    await api('/api/stars', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fullName }),
    });
    toast(`已收藏 ${fullName}`);
  }
  await refreshStars();
  if (state.view === 'stars') await loadStarsView();
}

// 收藏列表里的卡片拿不到 star 总数，逐个补齐（限量避免限流）
async function hydrate(names) {
  const missing = names.filter((n) => !state.starDetails.get(n)?.stars);
  for (const name of missing.slice(0, STATIC ? 8 : 20)) {
    try {
      const repos = await runSearch(name);
      const hit = repos.find((r) => r.fullName === name);
      if (hit) state.starDetails.set(name, { ...state.starDetails.get(name), ...hit });
    } catch {
      break;
    }
  }
}

function drawMap(repos) {
  const canvas = $('#starMap');
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  if (!repos.length) {
    ctx.fillStyle = '#9198a1';
    ctx.font = '15px -apple-system, PingFang SC';
    ctx.textAlign = 'center';
    ctx.fillText('还没有收藏，去「热门榜单」点几个 ☆ 就有了', W / 2, H / 2);
    return;
  }

  const max = Math.max(...repos.map((r) => r.stars || 1), 1);
  const nodes = repos.map((r) => ({
    r,
    radius: 14 + 34 * Math.sqrt((r.stars || 1) / max),
  }));

  let cursorAngle = 0;
  let cursorRadius = 0;
  const cx = W / 2;
  const cy = H / 2;

  for (const node of nodes) {
    let placed = false;
    let angle = cursorAngle;
    let radius = cursorRadius;
    for (let step = 0; step < 900 && !placed; step++) {
      angle += 0.32;
      if (step % 28 === 27) radius += 9;
      const x = cx + Math.cos(angle) * radius;
      const y = cy + Math.sin(angle) * radius * 0.62;
      if (x < node.radius || x > W - node.radius || y < node.radius || y > H - node.radius) continue;
      node.x = x;
      node.y = y;
      placed = nodes.every((o) => o === node || !o.x || Math.hypot(o.x - x, o.y - y) > o.radius + node.radius + 4);
    }
    if (!placed) { node.x = cx; node.y = cy; }
    cursorAngle = angle;
    cursorRadius = radius;
  }

  canvas._nodes = nodes;

  for (const node of nodes) {
    const color = colorOf(node.r.language);
    ctx.beginPath();
    ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
    ctx.fillStyle = color + '33';
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = '#e6edf3';
    ctx.font = '11px -apple-system, PingFang SC';
    ctx.textAlign = 'center';
    const label = node.r.name && node.r.name.length > 13 ? node.r.name.slice(0, 12) + '…' : node.r.name;
    ctx.fillText(label, node.x, node.y + node.radius + 13);
  }
}

async function loadStarsView() {
  const list = await refreshStars();
  const names = list.map((s) => s.fullName);
  skeleton($('#starsGrid'), Math.max(names.length, 1));
  await hydrate(names);
  const repos = names.map((n) => state.starDetails.get(n) || {
    fullName: n,
    name: n.split('/')[1],
    url: `https://github.com/${n}`,
    description: '',
    language: '',
    stars: 0,
    forks: 0,
    addedStars: 0,
  });
  render($('#starsGrid'), repos, '还没有收藏');
  drawMap(repos);
  $('#starsHint').textContent = names.length ? `已收藏 ${names.length} 个仓库` : '收藏后会在这里画成星图';
}

function switchView(view) {
  state.view = view;
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === view));
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${view}`));
  if (view === 'trending' && !$('#trendingGrid').children.length) loadTrending($('#trendingHint'));
  if (view === 'stars') loadStarsView();
}

document.addEventListener('click', (e) => {
  const tab = e.target.closest('.tab');
  if (tab) return switchView(tab.dataset.view);

  const readmeBtn = e.target.closest('[data-readme]');
  if (readmeBtn) return toggleReadme(readmeBtn);

  const starBtn = e.target.closest('[data-star]');
  if (starBtn) {
    starBtn.disabled = true;
    toggleStar(starBtn.dataset.star).catch((err) => toast(err.message)).finally(() => (starBtn.disabled = false));
  }
});

$('#searchForm').addEventListener('submit', (e) => {
  e.preventDefault();
  doSearch();
});

$('#refreshBtn').addEventListener('click', () => loadTrending($('#trendingHint')));
$('#langSelect').addEventListener('change', () => loadTrending($('#trendingHint')));
$('#sinceSelect').addEventListener('change', () => loadTrending($('#trendingHint')));
$('#aiOnly').addEventListener('change', renderTrending);
$('#aiOnlySearch').addEventListener('change', renderSearch);

const mapTip = $('#mapWrap');
mapTip.addEventListener('mousemove', (e) => {
  const canvas = $('#starMap');
  const nodes = canvas._nodes || [];
  const rect = canvas.getBoundingClientRect();
  const x = (e.clientX - rect.left) * (canvas.width / rect.width);
  const y = (e.clientY - rect.top) * (canvas.height / rect.height);
  const hit = nodes.find((n) => n.x && Math.hypot(n.x - x, n.y - y) <= n.radius);
  mapTip.style.cursor = hit ? 'pointer' : 'default';
  canvas.title = hit ? `${hit.r.fullName} · ★${fmt(hit.r.stars)} · ${hit.r.language || '无语言'}` : '';
});

(async function init() {
  state.languages = LANGUAGES.map(([, label]) => label);
  $('#langSelect').innerHTML = LANGUAGES
    .map(([value, label]) => `<option value="${value}">${label}</option>`)
    .join('');
  await refreshStars();
  loadTrending($('#trendingHint'));
})();
