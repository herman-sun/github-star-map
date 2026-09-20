import { mkdir, writeFile, cp, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTrending, trendingUrl, TRENDING_HEADERS } from './lib/trending.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const DOCS = join(ROOT, 'docs');
const OUT = join(DOCS, 'data');

const LANGUAGES = [
  '', 'typescript', 'javascript', 'python', 'go', 'rust',
  'java', 'swift', 'kotlin', 'c++', 'shell',
];
const SINCES = ['daily', 'weekly', 'monthly'];

// 每个语言/时间段组合都预生成，Pages 上仍能完整筛选
const combos = LANGUAGES.flatMap((language) =>
  SINCES.map((since) => ({ language, since })),
);

async function buildOne({ language, since }, retry = 2) {
  try {
    const res = await fetch(trendingUrl(language, since), { headers: TRENDING_HEADERS });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const repos = parseTrending(await res.text());
    if (!repos.length && !language) throw new Error('解析到 0 条，页面结构可能已变');
    return { ok: true, repos };
  } catch (err) {
    if (retry > 0) {
      await new Promise((r) => setTimeout(r, 4000));
      return buildOne({ language, since }, retry - 1);
    }
    return { ok: false, error: err.message };
  }
}

await mkdir(OUT, { recursive: true });
await rm(DOCS, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

const failed = [];
let done = 0;

for (const combo of combos) {
  const result = await buildOne(combo);
  const key = `${combo.language || 'all'}__${combo.since}`;
  if (result.ok) {
    await writeFile(join(OUT, `${key}.json`), JSON.stringify(result.repos));
    done++;
  } else {
    failed.push(`${key}: ${result.error}`);
  }
  await new Promise((r) => setTimeout(r, 800));
}

await writeFile(
  join(OUT, 'manifest.json'),
  JSON.stringify({ builtAt: new Date().toISOString(), total: combos.length, done }),
);

// 页面本身也要进 docs/，Pages 才能直接访问
await cp(join(ROOT, 'public'), DOCS, { recursive: true });

console.log(`生成 ${done}/${combos.length} 个快照到 docs/data/`);
if (failed.length) {
  console.log('失败组合:');
  failed.forEach((f) => console.log('  ' + f));
}
