# GitHub 星图

发现 GitHub 热门仓库，攒下自己的收藏星图。零第三方依赖，只用 Node 内置模块。

**在线地址**：<https://herman-sun.github.io/github-star-map/>

## 两种运行模式

| | 本地 `npm start` | GitHub Pages |
|---|---|---|
| trending 数据 | 实时抓取 `github.com/trending` | Actions 每小时预生成的快照 |
| 搜索 | 服务端转发 | 浏览器直连 `api.github.com` |
| 收藏 | 写 `data/stars.json` | 写浏览器 `localStorage` |
| 语言/时间筛选 | ✅ | ✅ |
| AI 筛选 | ✅ | ✅ |

## 启动（本地）

```bash
npm start
# 打开 http://localhost:5173
```

换端口：`PORT=8000 npm start`

## 部署（Pages）

`.github/workflows/deploy.yml` 每小时执行一次 `build-static.mjs`：抓取
11 种语言 × 3 个时间段共 33 个组合，生成 `docs/data/*.json`，再把 `public/`
与快照一起作为静态站点发布。快照同时提交回仓库，避免每次访问都重新构建。

## 功能

| 标签页 | 说明 |
|---|---|
| 热门榜单 | 抓取 `github.com/trending`，可按语言和今日/本周/本月筛选 |
| 搜索 | 走 GitHub `search/repositories` 接口 |
| 我的收藏 | 收藏的仓库画成星图，节点大小 = star 数，颜色 = 语言 |

每张卡片有 **README** 按钮，点击就地展开该仓库的 README，再点收起。
内容取自 GitHub API 的 `application/vnd.github.html` 媒体类型，即 GitHub 自己渲染好的
HTML，因此不需要自带 markdown 渲染器。属第三方内容，注入前会剥离
`script/style/iframe` 等节点与 `on*` 事件属性，并给所有链接加 `rel="noreferrer noopener"`。
已加载的 README 缓存在内存里，重复展开不再请求。

两个列表都有「只看 AI 相关」开关，按名称和描述里的关键词（llm / agent / mcp / copilot 等）匹配。
这是纯客户端的启发式判断，不是 GitHub 官方分类，可能漏掉描述里不提 AI 的 AI 项目。

## 关于榜单顺序

榜单**保留 GitHub trending 页面的原始顺序**，与官网一致。注意该顺序并非按"今日新增 star"降序——
实测存在新增数更少的仓库排在前面，说明 GitHub 用的是另一套未公开的排序算法。

## 为什么 trending 必须走服务端或预生成

浏览器直接 `fetch('https://github.com/trending')` 会被 CORS 拦掉（实测 `Failed to fetch`），
因为它是 HTML 页面而非 API、不返回 `Access-Control-Allow-Origin`。
`api.github.com` 则带 CORS 头，所以搜索可以在纯前端完成。

## 限流

匿名调用 GitHub API 限流为每小时 60 次（搜索约每分钟 10 次）。
刷新过频会看到限流提示，等几分钟即可。要解除可设置 `GITHUB_TOKEN` 并在请求头带上
`Authorization: Bearer <token>`。

## 结构

```
server.mjs              本地 HTTP 服务（实时模式）
build-static.mjs        生成 Pages 静态站点到 docs/
lib/trending.mjs        trending 抓取解析，两种模式共用
public/                 前端；STATIC 标志切换数据来源
.github/workflows/      每小时刷新快照并部署 Pages
data/stars.json         本地模式的收藏
docs/                   构建产物（已 gitignore，由 Actions 生成）
```
