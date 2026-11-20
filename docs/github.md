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

- 仓库首页用的图：`docs/panel.png`（README 里已引用 `docs/ticker.png` 与 `docs/panel.png`）。
- 建议再补两张：`docs/chart.png`（分时图）与 `docs/settings.png`（设置页），README 的「盘中分时图」与「使用」两节可以各引一张。
- **Social preview**（Settings → General → Social preview，1280×640）：建议用 `docs/panel.png` 居中 + 标题「A股实时行情 · DSH 插件」做一张 1280×640 的图。

## 建议勾选

- Releases → 用上面的 `v1.0.0` 说明建一个 Release（打 tag `v1.0.0`）。
- Settings → General → 勾选 **Issues**、**Discussions**（可选）。
- 语言统计：仓库里 JS 占绝对多数（Host/Client 都是 JS，无构建），无需额外配置。
