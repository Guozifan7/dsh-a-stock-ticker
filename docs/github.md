# GitHub 发布信息

把下面几段直接复制到 GitHub 仓库设置里即可。

## 仓库名

```
dsh-a-stock-ticker
```

## About / Description（仓库右上角那行简述）

```
DSH 插件｜左上角竖向轮播的 A 股实时行情条，悬浮看全部行情与行业指数，点个股看同花顺式盘中分时图，支持名称搜索与刷新频率设置
```

英文（如果仓库主语言设成 English）：

```
DSH plugin — a compact, rotating A-share quote ticker with a hover panel (quotes + industry boards), Tonghuashun-style intraday charts, and offline name search.
```

## Topics（标签，逗号分隔，GitHub 最多 20 个）

```
dsh-plugin, deepseek-harness, a-share, stock-ticker, eastmoney, intraday-chart, stock-market, finance, typescript-free, web-ui
```

## Release 说明（v1.0.0）

```markdown
## A股实时行情 v1.0.0

首个公开版本，面向 DeepSeek Harness Web 界面的 A 股行情插件。

### 功能
- **行情条**：标题栏空白带常驻，竖向轮播、一次一支，四个角落可停靠
- **悬浮面板**：全部行情字段 + 行业指数右栏（领涨/领跌各 10 个）
- **盘中分时图**：同花顺样式（昨收中轴对称网格、价格线 + VWAP 均价线、成交量柱、09:30–15:00 固定时间轴），另含 1分/5分 蜡烛视图
- **名称搜索**：内置 A 股/指数/ETF 名录（约 7,700 条），离线即时匹配
- **设置页**：开关、监控列表、刷新频率、轮播间隔、停靠角落、运行状态

### 安装
把本仓库目录交给 DSH 的 `plugin_manager`：

plugin_manager(action: "install_bundle", target: "<绝对路径>/dsh-a-stock-ticker")

### 说明
行情来自东方财富公开接口，仅供学习参考，不构成投资建议。
```

## 截图与社交预览

- 仓库首页用的图：`docs/ticker.png`、`docs/panel.png`、`docs/chart.png`、`docs/settings.png`（README 已全部引用）。
- **Social preview**（Settings → General → Social preview，1280×640）：建议用 `docs/panel.png` 居中 + 标题「A股实时行情 · DSH 插件」做一张 1280×640 的图。

## 上架 / 让别人搜到

先说结论：DSH 的「插件市场」是你的安装包内置的**索引阅读器**，官方不提供"提交插件"的入口，也**不内置任何索引源**（官方文档原话）。所以"被搜到"靠三件事：发布索引、发布 npm 包、被社区市场收录。

### A. 社区市场 dsh-plugin.org（实际被搜索的地方）

前置条件（仓库已满足的会打勾）：

- [x] 公开仓库
- [ ] GitHub 仓库 **Topics** 加 `dsh-plugin`（Settings 右上角齿轮 → Topics）
- [x] README 含安装命令 `dsh plugin --profile desktop add github:Guozifan7/dsh-a-stock-ticker`
- [x] 导出 `apply(ctx)`、根目录有 `package.json`
- [ ] 提交 Issue（模板会自动预填）：
      https://github.com/dshplugin/dsh-plugin-hub/issues/new
      按 `docs/github.md` 里的模板填写，能力分类选「界面与体验」
- [ ] 想出现在 DSH 内「插件中心」：**必须发布 npm 包**（见 B）

### B. 发布 npm 包（插件中心与 `dsh plugin add <包名>` 的前提）

```powershell
npm login                     # 需要 npm 账号
cd C:\Users\GUO\Downloads\sound\dsh-a-stock-ticker
npm publish --access public
```

发布前确认：`name` 未被占用（`npm view dsh-a-stock-ticker`）、`version` 已递增、`files` 里没有多余大文件。
发布后把安装命令补成 `dsh plugin --profile desktop add dsh-a-stock-ticker`，并把 `docs/market/index.json` 的版本源改成 `{ "type": "npm" }`（见 `docs/market/README.md`）。

### C. 自己的插件索引（DSH 内置「发现」可直接搜到）

已备好：[`docs/market/index.json`](market/index.json)，用户添加这个 URL 即可搜索安装：

```
https://cdn.jsdelivr.net/gh/Guozifan7/dsh-a-stock-ticker@main/docs/market/index.json
```

每次发版后重新生成并提交：`node scripts/build-market-index.mjs`。

### D. 把索引挂在 GitHub Pages（可选，比 jsDelivr 更稳）

Settings → Pages → Build and deployment → Source: `Deploy from a branch`，Branch 选 `main`、目录 `/docs`，
之后索引 URL 为 `https://Guozifan7.github.io/dsh-a-stock-ticker/market/index.json`。

## 建议勾选

- Releases → 用上面的 `v1.0.0` 说明建一个 Release（打 tag `v1.0.0`）。
- Settings → General → 勾选 **Issues**、**Discussions**（可选）。
- 语言统计：仓库里 JS 占绝对多数（Host/Client 都是 JS，无构建），无需额外配置。
- 仓库 Settings → General → **Topics** 至少加上 `dsh-plugin`（社区市场爬虫按它识别）。
