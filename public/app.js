const $ = (sel) => document.querySelector(sel);
const state = {
  view: 'trending',
  stars: new Set(),
  starDetails: new Map(),
  languages: [],
};

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
    <button class="star-btn ${starred ? 'on' : ''}" data-star="${r.fullName}">
      ${starred ? '已收藏' : '☆ 收藏'}
    </button>
  </div>
</div>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function render(grid, repos, emptyText) {
  if (!repos.length) {
    grid.innerHTML = `<div class="empty">${emptyText}</div>`;
    return;
  }
  grid.innerHTML = repos.map(cardHtml).join('');
}

async function loadTrending(hintEl) {
  const grid = $('#trendingGrid');
  skeleton(grid);
  hintEl.textContent = '正在抓取 GitHub Trending…';
  hintEl.classList.remove('err');
  try {
    const lang = $('#langSelect').value;
    const since = $('#sinceSelect').value;
    const qs = new URLSearchParams({ since });
    if (lang) qs.set('language', lang);
    const { repos } = await api(`/api/trending?${qs}`);
    render(grid, repos, '这个组合下没有结果');
    hintEl.textContent = `${repos.length} 个仓库 · 来自 github.com/trending`;
  } catch (err) {
    grid.innerHTML = `<div class="empty">${escapeHtml(err.message)}</div>`;
    hintEl.textContent = '加载失败';
    hintEl.classList.add('err');
  }
}

async function doSearch() {
  const q = $('#searchInput').value.trim();
  const hint = $('#searchHint');
  if (!q) { toast('先输入关键词'); return; }
  hint.classList.remove('err');
  skeleton($('#searchGrid'));
  hint.textContent = '搜索中…';
  try {
    const { repos } = await api(`/api/search?q=${encodeURIComponent(q)}&limit=30`);
    render($('#searchGrid'), repos, '没有匹配的仓库');
    hint.textContent = `${repos.length} 个结果`;
  } catch (err) {
    $('#searchGrid').innerHTML = `<div class="empty">${escapeHtml(err.message)}</div>`;
    hint.textContent = '搜索失败';
    hint.classList.add('err');
  }
}

async function refreshStars() {
  const { stars } = await api('/api/stars');
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
  if (state.stars.has(fullName)) {
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
  for (const name of missing.slice(0, 20)) {
    try {
      const { repos } = await api(`/api/search?q=${encodeURIComponent(name)}&limit=1`);
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
  try {
    const { languages } = await api('/api/meta');
    state.languages = languages;
    $('#langSelect').innerHTML = languages
      .map(([value, label]) => `<option value="${value}">${label}</option>`)
      .join('');
  } catch {
    $('#langSelect').innerHTML = '<option value="">全部语言</option>';
  }
  await refreshStars();
  loadTrending($('#trendingHint'));
})();
