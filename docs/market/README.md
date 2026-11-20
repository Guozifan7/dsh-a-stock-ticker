# 插件索引（DSH 「发现」用）

本目录是一份 **format 1** 的 DSH 插件索引，任何人都可以在 DSH 里添加它：

- 插件 → 更多 → 实验性插件 → 打开「自定义插件索引」
- 「发现」→ 添加索引源，填入下面的 URL

| 托管方式 | 索引 URL |
| --- | --- |
| jsDelivr（无需配置，随仓库更新） | `https://cdn.jsdelivr.net/gh/Guozifan7/dsh-a-stock-ticker@main/docs/market/index.json` |
| GitHub Pages（仓库 Settings → Pages，Source 选 `main` / `/docs`） | `https://Guozifan7.github.io/dsh-a-stock-ticker/market/index.json` |

## 维护

索引里的版本 **pin 了一个 commit**，所以每次发版（改 `version` 并提交）后要重新生成：

```powershell
node scripts/build-market-index.mjs
git add docs/market && git commit -m "chore: refresh market index" && git push
```

脚本会从 `.git` 直接读 HEAD（不调用 `git`，可在受限环境里跑），并把 `package.json` 的 `engines.dsh`、`locale/*.json` 的标题描述一起写进索引。

- `index.json` — 索引本体（格式由 `@deepseek-ai/dsh-plugin-market-index` 校验）
- `icons/dsh-a-stock-ticker.svg` — 相对图标，随索引一起发布

## 为什么用 Git 源而不是 npm 源

`source.type: "git"` 装的是 `git+<url>#<commit>`，不依赖 npm 发布；等仓库发布到 npm 后，可以把版本改成 `{ "type": "npm" }`，这样 DSH 内「插件中心」和 `dsh plugin add <包名>` 都能直接命中。
