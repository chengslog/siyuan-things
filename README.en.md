# SiYuan Things

[简体中文](./README.md)

![SiYuan Things overview](./asset/overview.jpg)

A Things-inspired GTD task manager for SiYuan Note. It provides Inbox, Today, Upcoming, Anytime, Someday, Log, projects, areas, headings, tags, checklists, dates, deadlines, reminders, and an AI task assistant.

## Feature overview

| Capability | Description |
| --- | --- |
| **GTD workflow** | Manage the task lifecycle with Inbox, Today, Upcoming, Anytime, Someday, and Log. |
| **Projects and organization** | Organize work with projects, areas, reorderable and collapsible headings, and tags; filter an area's active and completed tasks with project chips. |
| **Dates and reminders** | Set start dates and times, deadlines, reminders, and Someday tasks. |
| **Recurring tasks** | Repeat daily, on weekdays, weekly, monthly, or yearly; completing a task creates its next occurrence. |
| **Task details** | Add notes (Markdown rendering with image preview) and checklists, and copy a task's complete data as Markdown with one click. |
| **Quick Find** | Search titles, notes, checklists, assignments, tags, statuses, and dates directly in the task list. |
| **AI task assistant** | Create, search, summarize, update, and delete tasks through a continuous conversation. |
| **Theme and layout** | Follows SiYuan's light and dark themes with consistent cards across the sidebar, task list, and AI panel. |
| **Tab–sidebar following** | Optionally activate and locate the matching sidebar when a document or Things tab is clicked. |
| **Direct GitHub updates** | Optionally bypass the Marketplace download channel, check stable releases from the official Things repository, verify the archive, and hand it to SiYuan for installation. |
| **Safer operations** | Preview destructive operations such as deletion before confirmation. |
| **Workspace data** | Store data through SiYuan's plugin APIs so it can follow workspace sync settings. |

## AI task assistant

Use natural language such as:

> Schedule a product review for 9:00 tomorrow morning and break down the preparation tasks.

> What tasks are in Upcoming?

> Find possible duplicate tasks and suggest which ones to keep.

The AI assistant supports follow-up conversations, so you can refine the current draft or operate on tasks found in the previous response. Generated tasks stay with their conversation round: pending tasks in the current round open by default, older rounds collapse automatically, and added tasks show their project, area, or Inbox destination. Ambiguous create-or-search requests also provide one-click choices. AI is optional and requires an OpenAI-compatible service.

You can also drag Inbox, Today, Upcoming, Anytime, Someday, Logbook, or a specific project, area, or tag from the sidebar into the AI composer. You do not need to grab a precise handle: dropping in the composer adds a temporary constraint chip, while dragging within the sidebar continues to reorder items. Projects and areas replace each other, multiple tags can be combined, and the chips clear after sending.

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
- In an area, use the project chips below the title to filter the whole task page. In project and tag details, clicking `+` opens the new-task card near the current reading position. Project headings can be reordered and collapsed, while Completed stays fixed at the bottom.
- Set projects, areas, tags, dates, deadlines, reminders, recurrence, notes, and checklists on task cards, or copy a complete task as Markdown.
- Use natural language in the AI panel to create, find, update, or delete tasks. Deletions require confirmation.
- Click `Things Task Manager` in SiYuan's plugin menu to open settings directly. The optional **Follow tabs in sidebar** setting can restore SiYuan's native independent tab/sidebar behavior; open the task manager itself from the Things Dock on the left.
- If the Marketplace download channel is temporarily unavailable, enable **Update automatically from GitHub** or click the refresh icon beside that setting. Startup checks ask before installing; manual updates close Settings and use a dedicated card for download, verification, installation, reload progress, cancellation, and retry instead of silently replacing the plugin.

## Local development

```bash
pnpm install
pnpm test
pnpm run build
```

Copy the contents of `dist/` to `<SiYuan workspace>/data/plugins/siyuan-things/`, then restart SiYuan or reload the plugin.

When developing in a workspace with sync enabled, add `plugins/siyuan-things/**/*` to `<SiYuan workspace>/data/.siyuan/syncignore` so repeated build deployments do not enter sync or trigger plugin reloads. Do not exclude `storage/petal/siyuan-things`; task and settings data should continue to follow the workspace sync configuration.

Releases follow the project's [versioning policy](./docs/versioning.md): during the `0.x` phase, fixes increment the patch version while any new feature increments the minor version.

## AI configuration and privacy

The plugin can reuse the AI provider configured in SiYuan (the model picker is grouped by provider and follows the model currently selected in SiYuan's AI settings), or use a custom OpenAI-compatible endpoint, API key, and model name from the plugin settings. The **Enable AI** switch expands or collapses the provider and custom endpoint configuration as one section.

Task context required to answer a query is sent to the selected AI provider. The plugin does not include an AI account or proxy service. Review the privacy and retention policy of your selected provider before enabling AI features.

- When AI is disabled, the plugin does not proactively send task content to an AI provider.
- When AI is enabled, your message and the task titles, dates, assignments, tags, notes, and checklists needed for the request may be sent to the selected provider.
- API keys are stored in this workspace's plugin settings data. Protect them through your OS and workspace access controls.
- The plugin contains no author-operated analytics, advertising, or proxy service.

## Data and sync

Tasks and plugin settings are stored in the SiYuan workspace through the plugin data APIs. Whether these files sync to another device depends on the workspace synchronization configuration. Deleting a tag also removes that tag reference from active, logged, and recoverable tasks. Avoid editing the same task concurrently on multiple devices before synchronization completes.

## Compatibility and feedback

- Requires SiYuan Note 3.7.0 or later.
- Development and validation currently focus on Windows desktop. Compatibility reports for other declared platforms are welcome.
- The current Things version appears at the bottom of the sidebar; click it to open the changelog grouped by date and separated into features and bug fixes.
- The plugin settings page provides a dedicated Support and Feedback section.
- Report problems through [GitHub Issues](https://github.com/chengslog/siyuan-things/issues) with the SiYuan version, plugin version, reproduction steps, and safe screenshots. Never include API keys or private task content.

## Support the project

If this plugin is useful to you, you can support its continued development. Donations are entirely optional and do not affect access to any feature.

<img src="./asset/sponsor.jpg" alt="WeChat donation QR code" width="280" />

## License

[MIT](./LICENSE)
