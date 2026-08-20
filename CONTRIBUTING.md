# 参与贡献

感谢你愿意改进 SiYuan Things。

## 开始之前

- 提交缺陷时，请提供思源版本、插件版本、复现步骤和必要截图。
- 请删除截图与日志中的 API Key、私人任务内容和其他敏感信息。
- 较大的功能变更建议先创建 Issue 讨论交互与数据兼容方案。

## 本地验证

```bash
npm install
npm test
npm run build
```

提交前请确认 `npm test` 和 `npm run build` 均成功。不要提交 `dist/`、`package.zip`、工作空间数据或个人 AI 配置。

## 提交与发布

- 保持改动聚焦，避免混入无关格式化。
- 插件版本遵循 SemVer。
- 发布标签使用 `v<plugin.json version>`，例如 `v0.2.3`。
- GitHub Actions 会验证版本、运行测试、构建并上传 `package.zip`。

