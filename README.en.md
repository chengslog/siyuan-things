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
| **Native databases** | Fresh installations create a Things data center automatically; existing users can preview, back up, and migrate their data. |
| **Mobile task management** | Dedicated navigation and task pages, touch sorting, and bottom sheets for task properties, with layouts for long titles, notes, and checklists. |

## AI task assistant

Use natural language such as:

> Schedule a product review for 9:00 tomorrow morning and break down the preparation tasks.

> What tasks are in Upcoming?

> Find possible duplicate tasks and suggest which ones to keep.

The AI assistant supports follow-up conversations, so you can refine the current draft or operate on tasks found in the previous response. Generated tasks stay with their conversation round: pending tasks in the current round open by default, older rounds collapse automatically, and added tasks show their project, area, or Inbox destination. Ambiguous create-or-search requests also provide one-click choices. AI is optional and requires an OpenAI-compatible service.

You can also drag Inbox, Today, Upcoming, Anytime, Someday, Logbook, or a specific project, area, or tag from the sidebar into the AI composer. You do not need to grab a precise handle: dropping in the composer adds a temporary constraint chip, while dragging within the sidebar continues to reorder items. Projects and areas replace each other, multiple tags can be combined, and the chips clear after sending.

## Requirements

- SiYuan Note 3.8.8 or later.
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
- Use natural language in the AI panel to create, find, update, or delete tasks. Minimize the panel to an AI button when you need more room for the task list, then click it again to restore the current conversation. Deletions require confirmation.
- Click `Things Task Manager` in SiYuan's plugin menu to open settings directly. The optional **Follow tabs in sidebar** setting can restore SiYuan's native independent tab/sidebar behavior; open the task manager itself from the Things Dock on the left.
- If the Marketplace download channel is temporarily unavailable, enable **Update automatically from GitHub** or click the refresh icon beside that setting. Startup checks ask before installing; manual updates close Settings and use a dedicated card for download, verification, installation, reload progress, cancellation, and retry. After a successful update, **Reopen Things** closes the stale tab, loads the new instance, and restores the sidebar instead of silently replacing the plugin.

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

Fresh installations automatically create a Things notebook, data center, and seven native database tables. Tasks, projects, areas, tags, headings, and recovery history live in these tables. Notes use each record's rich text field, with images in the same row's **Notes images** asset column. Internal columns are hidden initially. Restarting reuses the same databases, and interrupted initialization can resume.

Find the databases under **Things → Things 数据中心** in the document tree, or use **Open data center** in the maintenance section of Things Settings. Mobile and desktop use the same storage implementation. Installing `package.zip` updates the plugin only; existing database documents and their binding information must sync through the same SiYuan workspace.

Tasks share one table with native Inbox, Today, Upcoming, Anytime, Someday, and Logbook views. Relative date filters change with the current day. Editing through Things or the native database updates the same business records.

Existing data stays on its current source until you migrate it. In Things Settings, use **Check migration data**, review the counts and warnings, and then choose **Back up and migrate**. The plugin saves an original backup, creates the databases, and verifies every imported field before switching sources. Original files remain available. The backup is at `data/storage/petal/siyuan-things/things-storage-original-v1.json` in the workspace. After migration, use the latest native records; switching directly to old files would discard later changes.

Settings, AI configuration, reminder history, and recovery journals remain in the plugin data directory. Sync follows the workspace configuration. Edit Things on one device at a time and finish synchronization before switching devices. Native edits are read on startup, window focus, and periodic refresh; refresh is delayed during card editing, and conflicting drafts are retained.

**Cross-device limitation in v0.7.0:** If the mobile plugin starts in legacy storage before receiving the database binding, completing sync does not automatically change its data source. Fully restart SiYuan or reload Things after synchronization, then check the storage status in settings. **Reload data** alone does not detect this source change in this release. That button can retry a temporary failure when initially loading an existing database.

Existing native databases whose notes still use separate documents can use **Move notes into the database** in Things settings. The upgrade saves `things-notes-original-v1.json`, verifies text and images, and then switches the note source. Original note documents remain as migration backups. An interrupted upgrade can resume; business writes are paused until it completes.

Completing a recurring task in a native table creates its next occurrence and checklist tree without replaying it on restart. Imported completed history is not replayed. While the plugin is closed, transient intermediate changes are not observed; the last observed state is processed when it runs again. Rich notes support common text formatting, lists, quotes, code, and math; images use the row's asset column and appear in the plugin preview. Rich cell contents do not have independent document block identities, so references to old note documents still point to the retained backups. Unsupported structures are rejected before saving. Tag deletion updates current and archived references while native recovery snapshots retain their historical content.

## Compatibility and feedback

- Requires SiYuan Note 3.8.8 or later.
- Development and validation currently focus on Windows desktop. Compatibility reports for other declared platforms are welcome.
- Mobile layouts have been checked at phone and iPad browser sizes. On-device iPhone/iPad keyboard and back-gesture behavior has not yet been verified.
- The current Things version appears at the bottom of the sidebar; click it to open the changelog grouped by date and separated into features and bug fixes.
- The plugin settings page provides a dedicated Support and Feedback section.
- Report problems through [GitHub Issues](https://github.com/chengslog/siyuan-things/issues) with the SiYuan version, plugin version, reproduction steps, and safe screenshots. Never include API keys or private task content.

## License

[MIT](./LICENSE)
