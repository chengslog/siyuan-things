# SiYuan Things

[简体中文](./README.md)

![SiYuan Things overview](./asset/overview.jpg)

A Things-inspired GTD task manager for SiYuan Note. It provides Inbox, Today, Upcoming, Anytime, Someday, Log, projects, areas, headings, tags, checklists, dates, deadlines, reminders, and an AI task assistant.

## Features

- Organize tasks with GTD-style views, projects, areas, headings, and tags.
- Schedule start dates and times, deadlines, reminders, and Someday tasks.
- Repeat tasks daily, on weekdays, weekly, monthly, or yearly; the next occurrence is created after completion.
- Add notes and checklists while keeping checklist items out of top-level task lists.
- Create, search, summarize, update, and delete tasks through a conversational AI assistant.
- Continue a conversation to refine drafts or operate on previously found tasks.
- Detect possible duplicate tasks and preview destructive operations before confirmation.
- Store plugin data through SiYuan's plugin data APIs so it can follow the workspace sync configuration.

## Requirements

- SiYuan Note 3.7.0 or later.
- An OpenAI-compatible AI service is optional and only required for AI features.

## Installation

### Marketplace

After the plugin is listed, search for `Things` under **Marketplace → Plugins** in SiYuan.

### Manual installation

Download `package.zip` from GitHub Releases, extract it to `<SiYuan workspace>/data/plugins/siyuan-things/`, then restart SiYuan or reload the plugin.

## Basic usage

- Open Things from the SiYuan dock.
- Use Inbox, Today, Upcoming, Anytime, Someday, and Log to manage the task lifecycle.
- Set projects, areas, tags, dates, deadlines, reminders, recurrence, notes, and checklists on task cards.
- Use natural language in the AI panel to create, find, update, or delete tasks. Deletions require confirmation.

## Local development

```bash
npm install
npm test
npm run build
```

Copy the contents of `dist/` to `<SiYuan workspace>/data/plugins/siyuan-things/`, then restart SiYuan or reload the plugin.

## AI configuration and privacy

The plugin can reuse the AI provider configured in SiYuan, or use a custom OpenAI-compatible endpoint, API key, and model name from the plugin settings.

Task context required to answer a query is sent to the selected AI provider. The plugin does not include an AI account or proxy service. Review the privacy and retention policy of your selected provider before enabling AI features.

- When AI is disabled, the plugin does not proactively send task content to an AI provider.
- When AI is enabled, your message and the task titles, dates, assignments, tags, notes, and checklists needed for the request may be sent to the selected provider.
- API keys are stored in this workspace's plugin settings data. Protect them through your OS and workspace access controls.
- The plugin contains no author-operated analytics, advertising, or proxy service.

## Data and sync

Tasks and plugin settings are stored in the SiYuan workspace through the plugin data APIs. Whether these files sync to another device depends on the workspace synchronization configuration. Avoid editing the same task concurrently on multiple devices before synchronization completes.

## Compatibility and feedback

- Requires SiYuan Note 3.7.0 or later.
- Development and validation currently focus on Windows desktop. Compatibility reports for other declared platforms are welcome.
- Report problems through [GitHub Issues](https://github.com/chengslog/siyuan-things/issues) with the SiYuan version, plugin version, reproduction steps, and safe screenshots. Never include API keys or private task content.

## Support the project

If this plugin is useful to you, you can support its continued development. Donations are entirely optional and do not affect access to any feature.

<img src="./asset/sponsor.jpg" alt="WeChat donation QR code" width="280" />

## License

[MIT](./LICENSE)
