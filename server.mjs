import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTrending, trendingUrl, TRENDING_HEADERS } from './lib/trending.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 5173);
const DATA_DIR = join(ROOT, 'data');
const STARS_FILE = join(DATA_DIR, 'stars.json');
const PUBLIC_DIR = join(ROOT, 'public');

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

const SINCE_LABEL = { daily: '今日', weekly: '本周', monthly: '本月' };

async function loadStars() {
  if (!existsSync(STARS_FILE)) return [];
  try {
    const parsed = JSON.parse(await readFile(STARS_FILE, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function saveStars(list) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(STARS_FILE, JSON.stringify(list, null, 2) + '\n', 'utf8');
}

async function fetchTrending(language, since) {
  const res = await fetch(trendingUrl(language, since), { headers: TRENDING_HEADERS });
  if (!res.ok) throw new Error(`GitHub 返回 ${res.status}`);
  return parseTrending(await res.text());
}

async function searchRepos(query, limit) {
  const params = new URLSearchParams({
    q: query,
    per_page: String(Math.min(Math.max(limit || 20, 1), 50)),
  });
  const res = await fetch(`https://api.github.com/search/repositories?${params}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'github-star-map',
    },
  });

  if (res.status === 403 || res.status === 429) {
    throw new Error('RATE_LIMITED');
  }
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
    pushedAt: it.pushed_at || '',
  }));
}

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
  });
  if (typeof body === 'string' || Buffer.isBuffer(body)) res.end(body);
  else res.end(JSON.stringify(body));
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  try {
    if (path === '/api/meta') {
      return send(res, 200, { languages: LANGUAGES, since: SINCE_LABEL });
    }

    if (path === '/api/trending') {
      const repos = await fetchTrending(url.searchParams.get('language'), url.searchParams.get('since'));
      return send(res, 200, { repos, source: 'github.com/trending' });
    }

    if (path === '/api/search') {
      const q = (url.searchParams.get('q') || '').trim();
      if (!q) return send(res, 200, { repos: [] });
      const repos = await searchRepos(q, Number(url.searchParams.get('limit')));
      return send(res, 200, { repos });
    }

    if (path === '/api/readme') {
      const repo = (url.searchParams.get('repo') || '').trim();
      if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return send(res, 400, { error: 'repo 参数格式不对' });
      const r = await fetch(`https://api.github.com/repos/${repo}/readme`, {
        headers: { Accept: 'application/vnd.github.html', 'User-Agent': 'github-star-map' },
      });
      if (r.status === 404) return send(res, 404, { error: '这个仓库没有 README' });
      if (r.status === 403 || r.status === 429) return send(res, 502, { error: 'GitHub 匿名接口限流，稍后再试' });
      if (!r.ok) return send(res, 502, { error: `GitHub 返回 ${r.status}` });
      return send(res, 200, await r.text());
    }

    if (path === '/api/stars') {
      if (req.method === 'POST') {
        const raw = await new Promise((r) => {
          let buf = '';
          req.on('data', (c) => (buf += c));
          req.on('end', () => r(buf));
        });
        const { fullName } = JSON.parse(raw || '{}');
        if (!fullName) return send(res, 400, { error: '缺少 fullName' });

        const stars = await loadStars();
        if (!stars.find((s) => s.fullName === fullName)) {
          stars.unshift({ fullName, at: new Date().toISOString() });
          await saveStars(stars);
        }
        return send(res, 200, { ok: true, count: stars.length });
      }

      if (req.method === 'DELETE') {
        const fullName = url.searchParams.get('fullName');
        const stars = (await loadStars()).filter((s) => s.fullName !== fullName);
        await saveStars(stars);
        return send(res, 200, { ok: true, count: stars.length });
      }

      return send(res, 200, { stars: await loadStars() });
    }

    if (path === '/' || path === '/index.html') {
      const html = await readFile(join(PUBLIC_DIR, 'index.html'));
      return send(res, 200, html, MIME['.html']);
    }

    const file = join(PUBLIC_DIR, path.replace(/^\/+/, ''));
    if (file.startsWith(PUBLIC_DIR) && existsSync(file) && extname(file)) {
      return send(res, 200, await readFile(file), MIME[extname(file)] || 'application/octet-stream');
    }

    return send(res, 404, { error: 'not found' });
  } catch (err) {
    const message =
      err.message === 'RATE_LIMITED'
        ? 'GitHub 匿名接口限流了（未登录每小时 60 次）。稍等几分钟再试，或减少刷新次数。'
        : `拉取 GitHub 数据失败：${err.message}`;
    return send(res, 502, { error: message });
  }
});

server.listen(PORT, () => {
  console.log(`github-star-map 已启动: http://localhost:${PORT}`);
});
