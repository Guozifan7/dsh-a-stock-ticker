# 参与贡献

欢迎 Issue 与 PR。改动前请先看这几条，能省不少来回。

## 环境

- Node.js ≥ 18（`scripts/build-symbols.mjs` 与测试用）。
- 一套可用的 DeepSeek Harness（桌面版或 `dsh web`），用于实机验证。

## 本地开发流程

```bash
# 1. 安装到 DSH profile（让 Agent 执行，或手动登记到 profile package.json）
plugin_manager(action: "install_bundle", target: "<绝对路径>/dsh-a-stock-ticker")

# 2. 改 client.js 后刷新页面即可（Host 半侧 index.js 需要重启 DSH）

# 3. 跑测试
node test/harness.mjs
```

## 硬性约定

1. **不加构建步骤**：`client.js` 是浏览器直接执行的经典脚本，只能通过 `require('react')` 使用模块表里的东西；不要引入第三方运行时依赖（图表、图标库都不要）。
2. **资源必须可回收**：定时器、事件监听、注入的 `<style>` 一律放在 `ctx.effect` 或组件 effect 里，并返回清理函数。
3. **文案走 locale**：所有可见文字通过 `ctx.locale.bind(NS)`，`zh` / `en` 两份都要补。
4. **数据字段集中管理**：上游字段表在 `client.js` 顶部常量与 `index.js` 的 `FIELDS`/`KLINE_FIELDS*`，改字段请两边一起改，并同步测试用的样例 payload。
5. **样式只用自己的前缀**：所有 class 以 `ast-` 开头，颜色优先用 `--dsw-alias-*` 主题变量，保证明暗主题都能看。

## 测试

`test/harness.mjs` 用一个自带的小型 React 运行时加载真实的 `client.js`，覆盖：

- 代码解析、设置归一化、格式化；
- 行情轮询（Host 路由优先 / 直连兜底 / 错误 / 禁用）、板块、临时查看；
- 面板与设置页渲染、股票名录搜索、切换行更新分时图（端到端重渲染）；
- 分时/蜡烛的几何计算（网格档位、时段槽位、VWAP、一字板）。

新增行为请顺手加断言；任何 PR 至少要让 `node test/harness.mjs` 全绿。

## 提交

- 一个 PR 一件事，描述里写清「改了什么、为什么、怎么验证的」。
- 涉及界面改动的，附一张前后对比截图（只截插件本身，不要带个人工作区 / 会话内容）。
- 更新 `CHANGELOG.md` 的 `Unreleased` 段（如果存在）。

## 数据接口

行情来自东方财富的公开接口，属非官方接口：字段可能在无通知的情况下变化。若发现接口不可用，请附上
`curl` 原始响应片段（可脱敏）与截图，方便定位是接口变了还是解析错了。
