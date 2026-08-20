# SiYuan Things

[简体中文](./README.zh-CN.md)

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

## Installation for development

```bash
npm install
npm test
npm run build
```

Copy the contents of `dist/` to `<SiYuan workspace>/data/plugins/siyuan-things/`, then restart SiYuan or reload the plugin.

## AI configuration and privacy

The plugin can reuse the AI provider configured in SiYuan, or use a custom OpenAI-compatible endpoint, API key, and model name from the plugin settings.

Task context required to answer a query is sent to the selected AI provider. The plugin does not include an AI account or proxy service. Review the privacy and retention policy of your selected provider before enabling AI features.

## Data and sync

Tasks and plugin settings are stored in the SiYuan workspace through the plugin data APIs. Whether these files sync to another device depends on the workspace synchronization configuration. Avoid editing the same task concurrently on multiple devices before synchronization completes.

## License

[MIT](./LICENSE)
