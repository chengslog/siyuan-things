# 思源插件集市发布清单

发布前先根据[版本管理规则](./versioning.zh-CN.md)确定版本号。

## 首次上架前

- [ ] 将 GitHub 仓库设为公开，默认分支保持为 `main`。
- [ ] 准备清晰且不含隐私信息的 `preview.png`（官方建议 1024×768、低于 200 KB）。
- [ ] 确认 `plugin.json`、`package.json` 和 Git 标签版本一致。
- [ ] 执行 `pnpm test` 和 `pnpm run build`。
- [ ] 检查 `package.zip` 至少包含 `index.js`、`index.css`、`kernel.js`、`plugin.json`、`icon.png`、`preview.png`、README 和 i18n 文件。

## 发布版本

```bash
VERSION=$(node -p "require('./plugin.json').version")
git tag "v${VERSION}"
git push origin main "v${VERSION}"
```

推送 `v*` 标签后，GitHub Actions 会验证标签与插件版本、运行测试、构建，并将 `package.zip` 上传到对应 GitHub Release。确认该 Release 标记为 Latest。

## 首次提交集市

1. Fork `siyuan-note/bazaar` 并同步其最新 `main`。
2. 在根目录 `plugins.txt` 中增加一行：`chengslog/siyuan-things`。
3. 每个 PR 只新增一个插件条目，并向上游 `main` 创建 PR。
4. 根据 PR Check 的结果修复当前 PR，不要为同一个插件重复创建 PR。

后续更新只需提高版本并发布新的 Latest Release，无需再次修改 `plugins.txt`，也无需重复提交 Bazaar PR。
