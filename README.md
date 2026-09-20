# GitHub 星图

发现 GitHub 热门仓库，攒下自己的收藏星图。零第三方依赖，只用 Node 内置模块。

## 启动

```bash
npm start
# 打开 http://localhost:5173
```

换端口：`PORT=8000 npm start`

## 功能

| 标签页 | 说明 |
|---|---|
| 热门榜单 | 抓取 `github.com/trending`，可按语言和今日/本周/本月筛选 |
| 搜索 | 走 GitHub `search/repositories` 接口 |
| 我的收藏 | 收藏的仓库画成星图，节点大小 = star 数，颜色 = 语言 |

两个列表都有「只看 AI 相关」开关，按名称和描述里的关键词（llm / agent / mcp / copilot 等）匹配。
这是纯客户端的启发式判断，不是 GitHub 官方分类，可能漏掉描述里不提 AI 的 AI 项目。

收藏存在 `data/stars.json`，纯本地文件，不上传任何地方。

## 关于榜单顺序

榜单**保留 GitHub trending 页面的原始顺序**，与官网一致。注意该顺序并非按"今日新增 star"降序——
实测存在新增数更少的仓库排在前面，说明 GitHub 用的是另一套未公开的排序算法。

## 为什么没有依赖

GitHub 不提供公开的 trending 接口，`server.mjs` 直接解析 trending 页面的 HTML。
搜索用的是无需鉴权的公开 API，因此**匿名限流为每小时 60 次**——刷新过频会看到限流提示，等几分钟即可。

要解除限流，可设置 GitHub token 后再启动（可选）：

```bash
export GITHUB_TOKEN=你的_token
```

然后在 `server.mjs` 的 `searchRepos` 请求头里加上 `Authorization: \`Bearer ${process.env.GITHUB_TOKEN}\``。

## 结构

```
server.mjs        HTTP 服务 + trending 抓取解析 + 搜索代理 + 收藏读写
public/index.html 页面骨架
public/style.css  样式
public/app.js     交互与星图绘制
data/stars.json   本地收藏（自动创建）
```
