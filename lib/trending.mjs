export function strip(html) {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export function toNumber(raw) {
  if (!raw) return 0;
  return Number(String(raw).replace(/,/g, '')) || 0;
}

// GitHub 没有公开的 trending API，只能解析页面 DOM 结构
export function parseTrending(html) {
  const articles = html.split('<article').slice(1);
  const repos = [];

  for (const chunk of articles) {
    const href = chunk.match(/<h2[^>]*>\s*<a[^>]*href="\/([^"?]+)/);
    if (!href) continue;
    const fullName = href[1].trim();

    const descMatch = chunk.match(/<p[^>]*class="col-9[^"]*"[^>]*>([\s\S]*?)<\/p>/);
    const langMatch = chunk.match(/itemprop="programmingLanguage">([^<]+)</);

    const starsWrap = chunk.match(/<a[^>]*href="\/[^"]*\/stargazers"[\s\S]*?<\/a>/);
    const stars = starsWrap ? toNumber((starsWrap[0].match(/([\d,]+)\s*<\/a>/) || [])[1]) : 0;

    const todayWrap = chunk.match(/([\d,]+)\s+stars?\s+(?:today|this week|this month)/);
    const addedStars = todayWrap ? toNumber(todayWrap[1]) : 0;

    const forkWrap = chunk.match(/<a[^>]*href="\/[^"]*\/forks"[\s\S]*?<\/a>/);
    const forks = forkWrap ? toNumber((forkWrap[0].match(/([\d,]+)\s*<\/a>/) || [])[1]) : 0;

    repos.push({
      fullName,
      name: fullName.split('/')[1],
      owner: fullName.split('/')[0],
      url: `https://github.com/${fullName}`,
      description: descMatch ? strip(descMatch[1]) : '',
      language: langMatch ? langMatch[1].trim() : '',
      stars,
      forks,
      addedStars,
    });
  }

  return repos;
}

export function trendingUrl(language, since) {
  const params = new URLSearchParams();
  if (language) params.set('language', language);
  if (since && since !== 'daily') params.set('since', since);
  const qs = params.toString();
  return `https://github.com/trending${qs ? `?${qs}` : ''}`;
}

export const TRENDING_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  Accept: 'text/html',
};
