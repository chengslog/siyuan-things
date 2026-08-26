# 项目交接文档（AI 上下文）

> 本文档面向 AI 助手/新开发者，包含项目全貌、关键实现机制、踩坑经验与最近的修复记录。
> 最后更新：2026-08-25

---

## 📍 当前进度快照（2026-08-27：0.2.15）

- **AI 多轮任务状态**：每轮草稿保留在对应对话内；当前轮待添加任务默认展开，历史待添加任务自动收起且可手动展开，任何已添加任务固定收起并显示目标位置。
- **复制与反馈**：AI 消息复制按钮位于气泡下方并在悬停时出现；普通任务可复制完整 Markdown，两处复制成功均切换为绿色勾选反馈。
- **快捷澄清与标签**：创建/查询含糊时展示快捷选择按钮；AI 创建 Bug/反馈任务会匹配已有标签，删除标签则集中清理活动、归档和回收任务引用。
- **列表交互**：项目/区域/标签拖入 AI 不再要求命中星光把手；已完成任务在相关列表中先收起再以 FLIP 动画沉底。

- **版本与反馈入口**：侧边栏底部使用紧凑的 `Things v版本号` 左对齐按钮，点击打开内置更新日志；Bug 反馈位于设置页末尾“支持与反馈”区块。设置末尾的普通操作与危险操作采用统一尺寸和留白。
- **今天语义搜索**：搜索“今天”会合并当前 Today 视图任务和本地当天完成的日志任务，既不会漏掉未完成任务，也可继续按“已完成”等关键词筛选当天完成记录。

- **侧边栏 → AI 拖拽上下文**：主导航整行可拖；项目/区域/标签为避免与原有行排序冲突，整行保留排序，悬停后出现独立星光把手用于拖入 AI。数据通过 `application/x-siyuan-things-context` 传递，输入区显示带来源图标的小胶囊。
- **确定性创建约束**：`aiComposerContexts` 在发送前快照，既注入 AI 路由上下文，也由 `applyComposerContexts` 在模型输出后本地覆盖。项目/区域互斥，标签可叠加；收件箱、今天、计划、随时、某天、日志分别落实为对应任务字段，日志任务写入 `status: done` 和完成时间。
- **发送生命周期**：点击发送即清空输入文字和上下文胶囊；上下文不会拼进用户可见消息。新会话和重置 AI 会话也会清空上下文。
- **设置与启动**：默认不指定启动页面，默认启用 AI 并复用思源 AI 设置；支持隐藏 AI 和一键清空数据并恢复默认设置；设置页提供 GitHub Bug 反馈入口。
- **同步恢复**：监听思源 `sync-start`、`sync-end`、`sync-fail`，同步结束重新加载数据，并在同步前 Dock 打开时按重试序列恢复侧边栏。
- **界面与主题**：侧边栏、任务列表和 AI 面板使用统一卡片底板、间距与悬浮层次；中右分隔线仅在交互时短暂显示。AI 输入区、消息/结果卡片和任务卡片全面改用思源主题变量，降低暗色模式反差。
- **Dock 布局恢复**：用户从关闭状态点击 Things Dock 展开侧边栏时，通过 `things-reset-layout` 通知当前 App；展开动画期间由 `ResizeObserver` 连续维持任务列表/AI 为 55:45，稳定后保存最终宽度，避免分段跳动。区域备注与项目列表之间补齐 10px 间距。
- **任务搜索**：侧边栏“快速查找”是标准导航项，进入 `search` 视图后仅在任务列表区显示输入框与结果。搜索索引覆盖标题、备注、检查项、项目/区域/标题分组/标签、状态、重复和日期，并将今天、计划等侧边栏视图语义加入索引；结果复用完整任务卡片且禁用排序拖拽。
- **图标更新**：`iconThingsSearch` 统一为 24px 圆角线性图标；`iconThingsInbox` 使用青绿底框与暖杏橙三横线，所有视图入口、标题、空状态及 AI 上下文共用雪碧图唯一来源。
- **测试与构建**：发布前统一运行 `pnpm test` 与 `pnpm run build`。
- **本机部署位置**：`C:\Users\Administrator\SiYuan\data\plugins\siyuan-things`。

---

## 📍 历史进度快照（2026-08-20：0.2.9）

- **AI 界面**：右侧 AI 面板已统一为单层标题、对齐的对话/结果/输入区域和悬浮输入卡片；处理过程采用“已处理 N 秒 + 当前阶段”的思考模型样式，成功与失败提示均位于同一状态区域。
- **任务结果卡**：查询结果与 AI 新建结果统一状态文字和字号，使用“未完成 / 已完成 / 待添加 / 已添加”弱化标签；收缩卡片保留边界辨识，只有展开态使用悬浮阴影。
- **查询作用域**：修复全新会话查询“计划”“随时”返回 0、历史会话范围污染及范围名称被误作关键词的问题；支持计划与随时联合查询，并按任务 ID 去重。
- **模型异常**：错误信息显示在处理状态下方；未配置模型时不再臆测 `gpt-4o-mini`，而是提示选择或配置可用模型。
- **文档与发布**：中英文 README、更新日志、集市发布清单和交接文档已同步；本版本准备通过 `v0.2.9` 标签生成 `package.zip` 并首次提交思源插件集市。
- **测试与构建**：统一使用 `pnpm test` 与 `pnpm run build`。
- **本机部署位置**：当前工作空间为 `C:\siyuan`，插件目录为 `C:\siyuan\data\plugins\siyuan-things`。

---

## 📍 历史进度快照（2026-08-20：0.2.1）

- **启动稳定性**：`src/index.ts` 将默认页签恢复收敛为单一路径，并用 `openingThingsTab` 复用正在创建的页签；设置默认启动视图时会说明需启用思源“启动时关闭所有页签”，插件可通过官方设置接口协助开启。
- **重复任务**：任务支持每天、工作日、每周、每月、每年。完成重复任务后生成下一次实例，继承备注、项目/区域/标题分组、标签和检查项；日期计算集中在 `src/utils/recurrence.ts`。
- **AI 重复能力**：AI 路由与草稿均支持 `repeatRule`，可创建、查询、修改或清除重复规则；查询“重复任务”按是否配置重复规则过滤，而“重复内容”仍走疑似重复分析。
- **测试**：`pnpm test` 使用 Node test runner，当前覆盖重复规则标准化、工作日跨周、月末与闰年边界。
- **清理与主题**：删除未引用的旧任务组件及 `taskStoreDB.ts`，主要 AI 界面和任务卡片中性色改用思源主题变量，改善深色主题。
- **当时部署位置**：历史记录曾使用 `C:\Users\Administrator\SiYuan\data\plugins\siyuan-things`；当前路径见上方 0.2.9 快照。

---

## 📍 当前进度快照（2026-08-18：AI 任务整理功能）

> 给接手的新会话：先看这里，了解最近做到哪、接下来做什么。

**本轮完成**（2026-08-17~18，AI 智能任务整理功能——设计文档 `pasted-text-20260818-194351` 为准）：

### 1. AI 服务层
- **`src/services/aiParser.ts`**：SSE 流式调用 AI（原生 `fetch` + `ReadableStream` 逐行解析 `data:`），真实解析 DeepSeek 推理模型的 **`reasoning_content`**（思考内容）与 `content`（回答），流式失败自动回退非流式。`THINKING_LEVELS` 三档思考强度 = temperature + max_tokens + 提示词指令组合（简洁 0.3/1024、平衡 0.7/2048、深入 1.0/4096，DeepSeek 系列追加 `reasoning_effort`）。SYSTEM_PROMPT 日期动态注入（曾硬编码 2026-08-17）。AI 配置来源：插件设置 `aiMode`（siyuan=复用思源 `window.siyuan.config.ai.providers` 的 apiKey/baseURL/模型列表 / custom=自定义端点）
- **`src/stores/aiChat.ts`**：AI 会话共享 store（`aiRounds`/`aiInputText`/`aiSelectedModel`/`aiThinkingLevel`/`aiIsSending`）+ `sendAiMessage`（流式更新轮次）/`adoptAiTask`（写任务 store，检查项转子任务）/`parsedToTaskData`/`parsedToPrefill`。**面板与浮窗共用同一份会话**——面板收起再开浮窗内容不丢（设计文档 §18）

### 2. 组件层
- **`AIChatCore.svelte`**（卡片流核心，面板与浮窗共用）：引导区（示例 prompt）→ 用户输入卡片 → AI 思考卡片（真实流式推理文本 + 状态徽章 思考中/整理中/✓完成）→ 结果卡片（复用 `TaskCard mode="create"` + 「采纳」按钮 → ✓已添加 + Toast）；底部输入栏（textarea ≤100px + 模型下拉 + 思考强度下拉 + 发送，Enter 发送）；支持连续对话追加卡片流
- **`AIPanel.svelte`**：右侧常驻面板（宽屏形态），卡片式（圆角 14/边框/浅阴影），内容 max 620px 居中，**margin 归零由 App 卡片容器统一管理**（曾双重 margin 导致与任务卡高度不一致）
- **`AICreator.svelte`**：全局浮窗（三段式 header/卡片流/输入栏）。**遮罩是 `position:absolute` 局部遮罩**（覆盖 Things 标签页区域、任务列表之上），非 `fixed` 全局遮罩——思源 dock 不受影响
- **`TaskCard.svelte`** 新增：`noAutoSave`（AI 预览禁失焦/回车自动创建）、`prefilledData`（AI 预填 title/checklist/startDate/deadline/tags/priority）、**优先级 UI**（工具栏右侧旗帜入口 + 左侧彩色胶囊 高红/中黄/低灰 + 下拉选择，创建/编辑均持久化）
- **`App.svelte` 复活为外壳**（不再是死代码）：标签页挂 App，App 内渲染 TaskList + AI 面板 + 浮窗

### 3. 布局状态机（App.svelte，严格按设计文档）
- **断点信号源**：`ResizeObserver` 监听**标签页容器自身宽度**（`thingsWidth`）——思源左/右 dock 开合只挤占容器、不触发 window resize，不能用 window.innerWidth 判断。启动时 4 次重测兜底（立即/rAF/100ms/500ms + 父元素逐级回退 + window 兜底）
- **三态**：`full`（TaskList + AI 面板两列）/ `button`（面板退出，右下角 ✧＋ FAB）/ `secondary`（任务列表隐藏，侧边栏为一级）
- **动态阈值**：任务列表最小宽 = **页面宽 2/5**、AI 面板最小宽 = **页面宽 1/5**（随窗口缩放动态）；FULL 条件 = 容器 ≥ 2/5 + 1/5 + 分隔条。**挤占优先级**：网格里 TaskList 是 1fr 先吸收收缩 → 到 2/5 后由面板宽度钳制保证不再缩 → 面板缩到 1/5 → FULL 条件破，面板消失变按钮
- **分隔条 2**（TaskList↔AI 面板）：6px 可拖，钳制 [1/5 页面宽, 容器-2/5-分隔条]，松手持久化 `aiPanelWidth` 到设置，双击未做（可选）
- **二级页面**：容器 < 页面 2/5 时任务列表隐藏（占位提示"请在左侧停靠栏选择视图"），点侧边栏导航（things-navigate）展示任务列表 + 顶部「← 收起」返回条
- ~~侧边栏扩宽覆盖任务区~~ **已取消**（2026-08-19）：该功能通过修改思源 `uiLayout.left` + `setSize()` + `saveLayout()` 程序化改 dock 宽度，导致思源整体卡死；已整体移除（`expandDockToCoverTasks`/`restoreDockWidth` 方法、`things-secondary-enter/leave` 事件、`dockWidthSaved` 字段、onunload 兜底恢复）。二级模式只保留任务列表的收起/展示 UI，不再触碰思源 dock 布局

### 4. 其他
- index.ts：dock 面板保持 renderDock 原样；监听 `things-open-ai`（弹浮窗）
- 设置项：`aiMode`（复用思源/自定义）+ `aiApiEndpoint`/`aiApiKey`/`aiModel`（自定义模式展开显示）；`openSetting` 手绘对话框已支持多配置项渲染
- 图标：`iconThingsSparkles`/`iconThingsSend` 已入 sprite

**本轮踩坑（血泪）**：
1. **`$: x: Type = ...` 响应式声明带类型注解会被编译成标签语句** → 运行时报 `ReferenceError: AIState is not defined`，整个标签页白屏。响应式声明一律不写类型注解（三元自动推断）
2. **Svelte 响应式语句按声明顺序执行**：响应式 `$: if` 里引用后面才声明的响应式变量（availableModels）→ 首次求值 undefined 崩溃。声明顺序必须"被依赖者在前"
3. **子组件渲染崩溃会摧毁整个组件树**：AIChatCore 抛错 → App 连带 TaskList 全消失（"任务列表都不显示了"）。组件级错误无边界隔离，排错时先看 Console 第一个红错
4. **思源 dock tab type = 插件名 + 注册类型**：`addDock({ type: "things_nav" })` 实际注册为 `siyuan-thingsthings_nav`，匹配配置时用 `this.name + "things_nav"`
5. **forwardProxy 会触发思源全局 requesting 进度条** → AI 调用一律原生 fetch
6. **思源没有暴露 AI 对话 API 给插件**（曾试 `/api/ai/chat`/`chatCompletion` 报错）：复用思源配置 = 读 `window.siyuan.config.ai.providers` 拿 apiKey/baseURL 后自己 fetch 供应商端点

**建议的下一步**：
- 验证/打磨：dock 扩宽在思源最大宽度限制下的表现、深色主题适配（AI 卡片硬编码 #f6f7f9/#e4e8ec）
- COMPACT 残留：TaskList 的 `aiMode` 还保留 header/compact 分支代码（当前 App 不再传），可清理
- 分隔条双击恢复默认宽度（设计文档未要求，可选）

---

## 📍 历史进度快照（2026-08-07 及更早）

> 给接手的新会话：先看这里，了解最近做到哪、接下来做什么。

**本轮已完成**（2026-08-07，任务卡片编辑交互大改 + 多项 bug 修复）：
1. **编辑交互模式重构**：编辑任务时只更新本地状态，失去焦点时才统一写 store 并执行迁移动画。修改日期/标签/归属后卡片保持展开，不会立即折叠或迁移
2. **卡片显示实时更新**：修复日期/标签/项目选择后卡片显示不实时更新的问题。响应式变量（`resolvedStartDate`/`tags`/`assignment` 等）改用本地状态而非 `task.xxx`
3. **新建卡片选日期后消失修复**：关闭选择器后焦点返回标题输入框，避免 `handleBlur` 误触发 cancel
4. **编辑后归属丢失修复**：`onMount` 和 `handleCardClick` 中初始化 `projectId`/`areaId`，防止失去焦点时误清除归属
5. **标签显示修复**：使用本地状态 `selectedTags` 而非 `task.tags`，添加标签后立即显示
6. **项目视图已完成任务沉底**：`sortByAnytimeRules` 添加已完成任务沉底排序
7. **侧边栏拖动排序修复**：`renderProjects`/`renderAreas` 添加 `.sort((a, b) => a.order - b.order)`，修复拖动后顺序不变的问题
8. **视图迁移逻辑优化**：`willChangeCauseMove` 正确处理项目/区域/标签视图（按归属分类，不会因日期变化而迁出）

**踩坑经验**：
- **本地状态 vs store 数据**：编辑模式下，所有显示相关的响应式变量都应使用本地状态（`startDate`/`deadline`/`selectedTags`/`projectId`/`areaId`），而非 `task.xxx`。否则编辑时 UI 不会实时更新
- **焦点管理**：选择器关闭后，如果焦点落在选择器内的元素上，元素消失会导致焦点丢失到 `document.body`，触发 `handleBlur`。需要在关闭选择器后主动把焦点返回标题输入框
- **初始化完整性**：`onMount` 和展开卡片时必须初始化所有本地状态字段，包括 `projectId`/`areaId`。遗漏会导致失去焦点时误判为"变更"

**上一轮已完成**（2026-08-06 下午，任务列表显示和排序优化）：
1. **随时视图排序优化**：今天白天(⭐️) → 今晚(🌙) → 其他日期(升序) → 无日期(保留order支持拖拽)
2. **标签/项目/区域视图对齐随时视图**：采用相同的排序规则和显示方式，提取 `sortByAnytimeRules()` 共用函数
3. **日期/图标列显示**：今天白天任务显示 ⭐️、今晚任务显示 🌙、其他日期显示 "x/x" 格式、无日期不显示
4. **任务卡片三列布局**：勾选框 | 日期/图标 | 标题，垂直居中对齐
5. **标题截断省略号**：长标题显示 `...`，避让右侧辅助图标（aux 容器 `flex-shrink: 0`）
6. **勾选框对齐第一行**：Header 改为 `align-items: flex-start`，勾选框/日期列/aux 都加 `margin-top: 3-4px` 对齐第一行文字基线
7. **标签显示优化**：彩色圆点 + 标签名格式（`🔴 标签名`），替换原来的纯图标
8. **大标题布局调整**：标题和描述分居分割线上下（`.task-list__header-top` + `.task-list__description`）

**本轮细节踩坑**：
- **日期列宽度权衡**：固定 `min-width` 可让标题对齐，但无日期时留空白太多；最终 `min-width: 20px` 折中（图标14px+少量间隙）
- **margin-top 多次微调**：勾选框/日期列/aux 的 margin-top 从 2px → 3px → 4px 反复调整，最终 3-4px 与文字基线视觉对齐
- **Header gap 调整**：从 8px → 4px → 6px → 10px，最终 10px 让用户感觉"不松不紧"
- **flex display 干扰 text-overflow**：标题原本 `display: flex` 导致省略号失效，改为 `flex: 1` 后正常
- **align-self: center 导致错位**：aux 容器原有 `align-self: center` 覆盖了 header 的 flex-start，删除后统一用 margin-top 对齐

**本轮已完成**（2026-08-06，视图逻辑对齐 Things 3 + 关键 bug 修复）：
1. **视图过滤逻辑对齐 Things 3**：
   - **今天**：新增截止日期=今天的任务（即使没有开始日期）；保留重复规则命中今天（预留接口）
   - **即将到来**：排除截止日期=今天的任务（避免与今天视图重叠）
   - **随时**：从原来的"无日期+有项目/区域/标签"改为"所有现在能做的活跃任务"——包括无日期任务、只有截止日期的任务、日期是今天的任务（排除某天/即将到来/子任务）
   - **某天**：保持不变（someday=true）
2. **视图说明文字**：每个视图标题下方新增灰色说明文字，解释该视图的收纳逻辑（如"所有现在能做的活跃任务，包括今天的任务"），帮助用户理解任务归属
3. **随时视图今天任务标记**：在随时视图中，日期是今天的任务标题前显示黄色五角星（iconThingsStarFilled，#FFB900），与 Things 3 一致
4. **关键 bug 修复：某天视图创建任务掉进收件箱**：`taskStore.ts` 的 `createTask` 函数缺少 `someday: partial.someday` 字段赋值，导致某天视图创建的任务 someday 为 undefined，被收件箱过滤条件命中。已添加该字段

**上一轮已完成**（2026-08-06，使用反馈修复 + UI 优化 9 项）：
1. **存储层回退到文件存储**（替代 IndexedDB）：IndexedDB 写入静默失败导致任务重启后丢失；`BaseStore.load()` 改回 loadData/saveData 文件存储（思源可同步，多端一致），首次加载自动合并 IDB 残留数据到文件后清除 IDB
2. **任务卡片备注交互优化**：空备注点击直接显示 textarea 进入编辑；有备注展示态（渲染 Markdown + ✎ 编辑按钮）↔ 编辑态（textarea + ✓ 完成按钮）双态切换；notes-wrap 加 `mousedown/mouseup|stopPropagation` 防点击备注区域触发卡片收起
3. **已完成任务自动沉底**：`sortTasks()`/`groupTasks()` 添加 status 主排序键，`done` 排最后（项目视图、计划视图、日志视图均生效）
4. **月视图日期格式统一**：`formatMonthDate()` 改为 "M月D日" 格式（与日志视图一致）；`__month-date` 宽度改为 56px 匹配 log-date
5. **编辑态隐藏日期列**：任务卡片展开后，日志视图的 `__log-date` 和计划视图的 `__month-date` 不再显示（`&& !expanded` 条件）
6. **标签页图标/标题修复**：VIEW_ICON_MAP 新增 `tag: "iconThingsTag"` 映射（原仅有 `tags`）；`getViewTitle()` 处理 tag 视图返回标签名；标签页标题显示彩色圆点（`tag.color`）代替图标
7. **项目面板优化**：截止日期从 `__meta` 行移到 `__row` 进度条右侧同一行显示；备注框样式统一为与任务卡片一致的 Markdown 渲染 + 编辑按钮 + 浅色线框包裹（`border: 1px solid #f0f0f0`）
8. **备注展开/收起功能**：任务卡片和项目备注都支持——展示态固定 `max-height: 104px`（约5行）超出截断；内容超过5行时右下角显示"展开"按钮，点击展开全部内容，按钮变为"收起"；**展开按钮和编辑按钮同在右上角**（`right: 30px` / `right: 4px`，hover 显示）；点击备注区域任意位置进入编辑
9. **标签 Tab 图标统一**：VIEW_ICON_MAP 的 `tags`/`tag` 从 `iconThingsTag`（线框 `currentColor`）改为 `iconThingsTagColor`（黄色 `#F59E0B` 彩色标签），与侧边栏一致；其他视图图标（今天黄星/计划红日历等）本身已是彩色不受影响

**上一轮完成**（2026-08-06 早，新需求 4 项）：
1. **计划月份组任务改日志样式**：月度组任务行首加固定宽度（56px）开始日期列「x月x日」（带时刻追加 HH:mm），与日志行首样式一致；月度组保留勾选框（scheduleMode 日程行模式仅限近 7 天日期组：`!group.startsWith("m-")`）；月度组不再显示内联日期徽章（showCollapsedDate 排除 upcoming）
2. **Markdown 渲染**：`src/utils/markdown.ts`（marked 18 + DOMPurify 消毒，gfm+breaks）。收缩态标题行内 Markdown 渲染（`renderInlineMd`）；备注**展示态渲染块级 Markdown**（点击转 textarea 编辑、blur 保存回展示态），编辑态 textarea autoGrow
3. **备注富文本图片**：`src/utils/upload.ts` 经思源 `/api/file/putFile` 上传到 `/data/assets/siyuan-things/`，返回 `assets/...` 引用；备注 textarea **粘贴/拖拽图片**自动上传并在光标处插入 `![](...)`；展示态 `<img>` 限宽 100%
   - ⚠️ 依赖：新增 npm 依赖 marked/dompurify（已入 package.json）
4. **存储层改 IndexedDB**（后被回退，见本轮第1项）

**更早一轮完成**（2026-08-04~05，使用反馈修复 8 项，见下方明细）

**⚠️ 注意事项（接手必读）**：
- **部署后必须重启思源或禁用再启用插件**——思源只在插件加载时读取插件 JS，只关开标签页不会生效；用户反馈"修了没效果"时先确认这点
- **思源没有公开的标签页聚焦 API**（Layout 类无 focusTab，已核对源码）；激活已有标签页用**模拟点击页签头**（`headElement.dispatchEvent(click)`），勿再尝试 focusTab
- **拖拽创建不要加"扫过侧边栏改道"类逻辑**——上一轮加的 lastNav 兜底导致"拖+到分组却建进未分组"，已删除；落列表一律在当前视图插入位新建，要切视图请悬停侧边栏 120ms 或直接松手在侧边栏
- **中文输入法回车陷阱**：输入法组词确认键也是 Enter（`e.isComposing` / keyCode 229），所有"回车提交"的输入框都必须先判组词，否则中文用户按回车选词会误提交
- **换行语义（用户明确要求）**：收缩态单行+省略号；换行只在编辑态（标题/检查项都是 autoGrow textarea）
- **回车语义**：标题=保存并收起（新建=创建、编辑=saveAndCollapse）；检查项=新建下一项；Shift+Enter 才是真换行
- **完成勾选**：置灰 3s 窗口内再点=取消勾选；退场动画是**高度塌缩+淡出**（不是左滑）
- **日志视图**：按「今天+月份倒序」分组、行首完成日期列；日志里拖拽排序无效（列表按 completedDate 排，非 order）
- **启动设置**：defaultView 可选「不打开（跟随思源默认）」，选 none 时 onLayoutReady 不打开 Things 标签页

**更早一轮完成**（2026-07-30 下午，已提交 `c8fdab2`）：
1. **日期选择器滚动化**（`DatePicker/DeadlinePicker.svelte` + `utils/calendar.ts`）：新增 `generateRollingCalendar(startTs)`——日历从**今天**起往后推一个月（按周对齐、首行起始日前的格子为占位），不再从"月份 1 号"起整月；标题显示区间（如 7月30日–8月29日）；‹ 不早于今天、› 往后翻。
2. **计划视图组头/骨架调整**（`TaskList.svelte`）：近 7 天组头首项"明天"、其余星期几（灰 14px、分隔线与文字左对齐）；月度组头去掉大数字（"M月"+细线整体左对齐）；月度骨架起点改为"近 7 天窗口后一天（第 8 天）"所在月，跨月/到月底都不留空白或重叠组。
3. **悬浮 + 按钮重做**（`TaskList.svelte`）：删掉计划视图标签筛选行；去掉 + 的项目/区域创建（仍在侧边栏悬浮卡片）。**按钮本体跟随光标拖动**（非幽灵、抬起放大、松手弹性回弹原位）；**悬停侧边栏视图 ~120ms 实时打开对应页**（禁止拖到标签）；拖到列表显示**发光插入指示线**（行间隙吸附、空分组跟随光标）。
4. **插入式新建**（`TaskList.svelte`）：拖 + 到列表某处松手 → 创建卡片**嵌在该位置**（`createTarget`/`activeCreateSlot`，校验分组存在，否则回退顶部渲染）；创建后新任务**重排到插入位置**（视图内重写 order）。点击 + / 拖侧边栏切视图 → 顶部新建。
5. **新建继承落点上下文**（`TaskCard.svelte` 新增 `presetStartDate`）：拖到**今晚**→今天 18:00、**日期组**→当天、**月度组**→月初（或窗口后一天）；项目/区域视图预置归属；**某天视图自动 someday**；创建卡片直接显示继承到的日期胶囊。
6. **收缩态微调**（`TaskCard.svelte`）：所属项目/区域与标题同行（项目=文件夹图标、区域=层叠图标，单色随文字灰）；标签只显示 🏷 图标（悬停提示标签名，去掉标签胶囊）；展开详情去掉清单上方的标签行。
7. **修复任务卡片误展开**（`TaskCard.svelte`）：`pointerDownHere` 判定按下是否发生在卡片自身，避免拖 + 松手时把落点任务误当点击展开（此前会同时弹新建卡 + 展开旧任务，出现"两个卡片"）。
   - ⚠️ 复用经验：Svelte `$:` 不穿透函数调用追踪依赖，`getXxxDisplay()` 无参只在初始化算一次，必须把响应式变量作为参数显式传入。

**本轮明细**（2026-08-04~05，使用反馈修复 8 项）：
1. **点 dock 侧边栏后 Things 标签页不前置**：openThingsTab 复用路径只 `$set` 更新内容不聚焦标签页，停留在文档页时点侧边栏"没反应"。思源 Layout **没有公开的 focusTab**（已核对思源源码 layout/index.ts），改为**模拟点击页签头元素**（`headElement.dispatchEvent(click)`，等效用户点击该标签页，未聚焦时才触发），跨版本可靠
2. **长文本换行**（仅编辑态）：标题输入框与检查项均改**自动增高 textarea**（`autoGrow` action：input/重渲染后重测 scrollHeight；标题回车=保存收起、检查项回车=新建项，均不产生换行，Shift+Enter 可换行）。**收缩态保持单行+省略号**（用户明确要求编辑态才换行）
3. **标题分组新建回未分组**：根因是上一轮加的 FAB `lastNav` 兜底——拖 + 时指针扫过侧边栏任意行，落列表即被强行改道到扫过的视图并顶部新建（丢失分组上下文）→ 已删除 lastNav 改道逻辑（落列表一律在当前视图插入位新建）；createTask 本身带 headingId、插入卡 presetHeadingId 接线均验证无误
4. **置灰可取消勾选**：pendingDone 期间（3s 窗口）再点 checkbox = 取消（清 timer 还原）；**完成动画改收缩淡出**（slideOut 从 translateX 左滑改为高度塌缩+淡出，列表自动收拢）
5. **启动默认视图可选**：设置新增 `none`「不打开（跟随思源默认）」选项；选 none 时 onLayoutReady 跳过打开 Things（思源自己恢复上次文档）
6. **编辑卡片回车=保存并收起**：handleKeydown 不再只管 create 模式——编辑模式 Enter 调 saveAndCollapse（与新建一致），Esc 也收起；中文输入法组词回车（isComposing/keyCode 229）不触发
7. **日志按月倒序分组**：groupTasks 新增 log 分支——「今天」组置顶（当日完成），其后按月份倒序（`m-YYYY-M` key，组内 completedDate 倒序）；组头复用计划视图月度样式（「M月」+细线）；groupHeader 加 log-today 分支
8. **日志行首完成日期列**：日志视图每条任务行首加固定宽度（56px）完成日期列——今天完成显示「今天」，其余「M月D日」（`formatLogDate`），各行复选框对齐；同时日志视图不再叠加开始日期徽章（showCollapsedDate 排除 log）

**上一轮已完成**（2026-07-29，已提交 `91341e2`/`f5638c7`）：
1. 修复分组视图拖拽排序 bug（`TaskList.svelte`）：每个分组各有一个 DragSort 实例，其 `fromIndex/toIndex` 是**组内相对索引**，而旧 `handleReorder` 直接当全局索引用，多分组视图（今天/今晚、计划按日期分组）会移错任务并打乱全表 order。修法：先在组内数组上应用移动，再将分组新顺序**原位映射回** `sortedTasks`（组外任务槽位不动），最后统一重写 order。单分组视图退化为原逻辑，行为不变。
   - ⚠️ 刻意不用"按分组合拢后整体重排"的方案：`getUpcomingTasks()` 包含「只有 deadline 无 startDate」的任务，而 `groupTasks` 会跳过无 startDate 的任务，合拢重排会把这些任务的 order 弄乱。
2. 图标体系统一（新建 `src/icons/` 素材目录）：此前三套并存——index.ts 内联雪碧图（侧边栏/标签页）、83 处 emoji（胶囊/工具栏/标题/空状态）、散落文字符号。现状：
   - **所有 symbol id 已加 `iconThings*` 命名空间**（修复与思源内置 litheness 图标的 8 处撞车，见 §4.5）
   - `src/icons/sprite.ts`：全部 `<symbol>` 定义（从 index.ts 迁出 + 新增 13 个 Lucide 几何单色图标：star/moon/flag/tag/bell/checklist/note/subtask/calendarLine/x，含 filled 变体；「某天」统一用多色视图图标 iconThingsSomeday，与侧边栏一致）。多色视图图标中 iconThingsInbox / iconThingsCalendar 重新调色（原配色大片纯白+近黑点阵）：收件箱改蓝色托盘（#CDE6FF/#9FCDFF/#5FB2FF，保留 #2A5082 描边），计划改红调日历（身体 #FFE9E6、点阵 #5C6B84，红头保留），其余视图图标逐字节保留原样
   - `src/icons/Icon.svelte`：`<Icon name="iconThingsX" size color klass/>` 通用组件
   - `src/icons/index.ts`：`VIEW_ICON_MAP` 视图→图标**唯一映射表**（index.ts 与 TaskList 共用，页面标题与侧边栏视觉归一）+ `ICON_COLORS`（今天=#FFB900 黄 / 今晚=#5A7FE0 蓝，设计稿颜色，emoji 时代无法实现）
   - `src/utils/display.ts`：合并 TaskCard / DatePicker 的 3 份重复 dateDisplay 逻辑，返回 `{ icon: symbolId, text, color? }`
   - 活代码 emoji 已清零（仅 4 个死代码组件内还有，随死代码清理一并消失）
3. 检查清单「没回车就自动加行」修复（`Checklist.svelte`）：原响应式块在末项一有内容时就追加空行，用户打字中途凭空多一行。现改为回车才建行，响应式块仅保证清单至少一行；顺带把 3 处 `Date.now()` 行 id 换成带序号的生成器防同毫秒碰撞
4. 两个交互修复（`TaskCard.svelte`）：①**同名重复任务 + 检查项"丢失"**——根因是 `handleCreate` 无防重入：回车触发后是一串异步写库，期间失焦/再次回车会并发第二次创建，产出同名重复任务，检查项全挂在第一个上，用户打开第二个就以为没了；已加 `isCreating` 守卫（历史遗留的重复任务需手动删除空的那个）。②**工具栏弹窗不消失**——`handleCardClick` 的输入区早退分支挡在"关弹窗"逻辑之前，打开日期选择器后点卡片内空白/输入区弹窗不关；现改为弹窗打开时卡片内任何点击（弹窗自身除外）先关弹窗
5. 切换视图列表"往上弹一下"修复（`TaskList.svelte`）：侧边栏切换走 `$set` 组件不重建，旧视图任务带着 `out:slideOut`（300ms）退场，退场期间仍占布局高度，动画结束移除后滚动被钳制→弹跳。修法：检测 `view/viewId/searchQuery` 变化时置 `suppressOutro` 使 slideOut 持续 0（响应式先于 DOM 更新执行、outro 在 DOM 更新中创建，时序安全），并把 `.task-list__items` 滚动回顶部。任务完成/编辑迁出的滑出动画不受影响
6. 日期胶囊两处调整（`utils/display.ts` + `TaskCard.svelte`）：①今天视图内任务（日期已到，含逾期）的日期胶囊一律显示 ⭐ 今天，不再显示当初设置的那个日期；`getStartDateDisplay` 增加 `view` 参数，TaskCard 显式传入 `currentView` 保持响应式依赖。②明天/具体日期胶囊的图标从线条日历换成多色"计划"日历（`iconThingsCalendar`，与侧边栏计划视图同款）
7. TimePicker「确定」按钮 hover 消失修复：`__btn:hover` 的浅色背景与 `--primary:hover` 特异性相同且声明在前，hover 时主按钮变白底白字整个隐形；`--primary:hover` 内显式重置背景修复（写 SCSS 时注意：修饰符的 hover 必须自己重写背景，通用 hover 不会自动让位）
8. **计划视图按设计稿重做**（`TaskList.svelte` + `TaskCard.svelte`）：
   - 分组改按 startDate 时序（修复原来跟着 order 字段乱序的 bug），分组 key 用当天 0 点时间戳，`dayHeader()` 计算文案
   - 日期分组头重做：34px 大数字 + 18px 描述（今天/明天/N天后/周几）+ 右侧延伸细线；组间距 48px
   - 日程行：组内带时刻（时/分非零）的任务排在前面，TaskCard 传 `scheduleMode` → 收缩态左侧显示蓝色 HH:mm 时间列替代 checkbox、隐藏副标题/辅助信息；点击展开恢复正常卡片（checkbox 回来可勾选）
   - 筛选标签行：[全部] + 前 5 个标签 chip + "···" 下拉（其余标签，带色点），按标签单选筛选 upcoming 任务；与标题一起固定不滚动（滚动方案 A）
   - 标题留白全局加大（顶 80px、左右 72px）；计划视图分隔线挪到筛选行下方（`has-border` 条件类）
   - 收缩态辅助区标签从纯图标升级为 [标签名] 浅灰边胶囊（多个显示 +N）
   - ⚠️ Svelte 模板表达式里不能写 TS 类型标注（`(t: any)` 会 ParseError）
9. **分组骨架固定化**（`TaskList.svelte`）：今天视图「今天/今晚」两组**始终显示**（空组也保留组头）；计划视图固定骨架 = 明天起 7 个日期分组 + 其后 5 个月度分组（月度起点 = 第 7 天所在月，保证无缝衔接不漏天），无论有无任务都显示，任务就近归属（7 天内按天、更远按月，超 5 个月窗口的不显示）。月度组头 = `M/1` + 月份名（`groupHeader()` 按 `m-YYYY-M` key 解析）；日期组头分割线改对齐数字**上沿**（`align-self: flex-start`，今天视图组头内单独覆写为居中）。组内排序改回按 `order` 字段（之前按 startDate 排会吞掉手动排序结果）；空状态提示只在非固定骨架视图显示。副作用红利：空日期/空月份也成了合法拖放落点（拖任务到空日期 = 改期到那天，月度落点 = 该月 1 日，均保留原时刻）
10. **项目/区域/标签三大功能按 Things 3 对齐**（三期，`index.ts` + 6 个新组件）：
    - **指派**（`ProjectAreaPicker.svelte`）：任务卡工具栏新增项目/区域选择器（搜索+区域分组+无选项），已设显示胶囊可清除；项目/区域视图里新建任务自动预置归属
    - **项目页**（`ProjectPanel.svelte`）：进度条 n/m、截止胶囊（逾期红底）、备注即点即编、状态徽章（暂停/完成/作废）、⋯ 管理菜单（截止日期/移动到区域/完成/暂停/作废）。**改名/删除已移交侧边栏项目行，菜单不再重复**；截止日期与区域选择用**独立浮动弹层**（`showPanel` + `__pop`，与菜单共用卡片外观、同级绝对定位）——此前内联在菜单里展开会把菜单卡片撑得忽大忽小。新增 `onhold` 状态（`ProjectStatus`）
    - **区域页**（`AreaPanel.svelte`）：区域内项目列表（进度/截止，点击进项目）、备注。**⋯ 菜单已整体移除**（改名/删除两项都与侧边栏区域行重复）
    - **项目总览视图**（`ProjectOverview.svelte`，ViewType 新增 `projects`/`log`）：按状态分组（进行中/已暂停/已完成/已作废），dock 主导航新增「项目」入口
    - **标题分组（headings）**：项目页按标题分组渲染（组头可改名/删除，任务回未分组；"＋ 添加标题分组"内联创建）；**标题分组之间可直接拖拽任务改归属**（复用跨组拖拽机制，`moveTaskToGroup` 已泛化为按视图计算变更：upcoming→startDate、today→0点/18点、project→headingId）
    - **标签**：dock 新增标签节（色点+树形缩进）；`TagPicker` 支持即席创建（搜索词无精确同名→"创建标签「x」"行，调色板循环取色）与层级显示；**标签行直接操作**（无右键菜单）：单击**零延迟**打开标签视图、悬停出现 **✎ 改名按钮**（`iconThingsPencil`，点击内联改名，Enter/失焦保存、Esc 取消——原"双击改名+单击延迟250ms"已废，双击让单击发卡是卡顿元凶）、**点色点**弹 12 色调色板（含"无颜色"选项，无色标签显示虚线空点）、**按住拖动**排序、悬停出现 **× 删除**（✎/× 都用 `visibility` 切换而非 `display`——占位常驻，避免悬停时布局跳动抖动；首点变"确认"，2.5s 自动撤防，删除时从所有任务摘除）
    - **区域/项目子项侧边栏直接操作**：与标签行同一套 `.things-nav-row` 模式——单击**零延迟**打开对应页、悬停出现 **✎ 改名 / × 删除**（区域删除级联解绑其项目/任务，项目删除清任务的 projectId）。通用方法 `startRowRename`/`bindRowDelete`/`deleteAreaFromSidebar`/`deleteProjectFromSidebar`；行尾提示统一为 `title="单击打开 · 悬停 ✎ 改名 · 按住拖动排序"`。重功能（截止日期/状态切换/移动区域）保留在项目页 ⋯ 菜单；区域无额外重功能，其面板已无菜单
    - **创建表单化**：dock 与 FAB 的 prompt() 全部替换为内联表单（`EntityForm.svelte`，项目含区域下拉）
    - **侧边栏拖拽排序**（自定义鼠标引擎 `startSectionDrag`，替代 HTML5 原生拖拽）：5px 阈值区分点击/拖动、幽灵卡片跟随、邻居挤占动画（translateY + 200ms 过渡，空槽"流"向落点）、主题色插入指引线（带圆点、top 150ms 平滑移动）；松手按新序列重写 order；`justDragged` 标记抑制拖后误触点击；标签仅顶层行可拖（`things-tag-row--root`，不打乱嵌套层级）。任务列表的 `DragSort` 也补上了同款指引线（`updateIndicator`）。指引线样式 `.things-drag-indicator` 两处共用
    - **侧边栏结构重整**：全部图标化（主导航彩色视图图标、区块头图标、行级项目/区域/标签图标、+号换 iconThingsAdd）；分割线全删，改空行分组——收件箱 / 今天·计划·随时·某天 / 日志 / **项目 / 区域 / 标签**；**区块头整行即总览入口**（点「项目」=全部项目、点「区域」=全部区域、点「标签」=全部标签，对应 ViewType `projects`/`areas`/`tags` + `ProjectOverview`/`AreaOverview`/`TagOverview` 三个组件，进入总览时区块头高亮；标签头用彩色 `iconThingsTagColor`；子项用黑白小图标 `iconThingsFolder`/`iconThingsLayers`，14px 占位与 16px 严格等宽）；新建走**悬浮创建卡片**（`showCreateCard`：弹在侧边栏右缘外、输入框/下拉框等宽、无取消按钮——点卡外即取消、Enter 创建，项目/区域/标签同一套逻辑）；**整列严格对齐**（导航项/区块头/表单统一 margin 0 8px，图标 x=20px、文字 x=44px；标签色点占 16px 槽位；嵌套子标签按 depth×16px 递增缩进）
    - **dock 实时同步**：index.ts 订阅 projects/areas/tags 三个 store，任何变更实时重渲染侧边栏；TaskList 也订阅全部 store（修复项目改名/状态切换标题不刷新）
    - 新文件：`ProjectAreaPicker/ProjectPanel/AreaPanel/ProjectOverview/EntityForm.svelte`、`utils/colors.ts`（TAG_PALETTE）
11. **跨组拖拽改日期**（`DragSort.svelte` + `TaskList.svelte`）：今天视图可在「今天/今晚」之间拖（→ 当天 0 点 / 18 点），计划视图可在日期分组之间拖（→ 目标日期，保留原时/分，日程行拖过去还是同一时刻）。机制：DragSort 加 `groupKey` prop + 容器绑定 + `drop` 事件（`withinSelf` 区分组内排序/跨组移动）+ 对外暴露 `containsPoint`/`computeInsertIndex`；指针越出本组容器时幽灵自由跟随。TaskList 按组 key 注册 DragSort 实例与分组块 DOM（`dragSortRefs`/`groupBlockRefs`，`bind:this={obj[group]}`），拖拽中 mousemove 追踪落点分组并高亮（`is-drop-target`），**同时在目标组内撑开避让槽位并绘制插入指引线**（`showGapAt`——把落点之后的任务下移一个"被拖任务高度"的槽位、200ms 过渡，指引线落在槽位中央；源组指引线由 DragSort 在指针离组时自行隐藏，回组恢复；同一个 `indicatorEl` 两条路径共享；指针离开目标组用 `clearGap` 收拢）；松手后 `moveTaskToGroup` 由分组 key 推算新日期，再按 handleReorder 的"原位写回"机制重排 order。空分组（固定骨架的空日期/今晚空组）也可作为落点（`DragSort` 的 `.drag-sort` 有 `min-height: 48px` 保底落点区，否则空组高度为 0、只有组头一条线能命中）。`{ @const }` 必须放在 `{#each}` 的直接子级，包装 div 要在它后面
12. **某天视图"建完就没"修复 + 任务拖入侧边栏视图**：①某天视图新建兜底——`handleCreate` 里 `currentView === "someday" && !startDate` 时强制 `someday = true`（此前胶囊显示某天但提交的 someday 可能为 false，任务悄悄落进收件箱）。②新功能：任务卡片可直接拖到侧边栏视图转换归属（`moveTaskToView`：某天=someday、今天=当天0点、收件箱=清空日期/项目/区域、随时=清日期、日志=标记完成、项目/区域=设归属），拖拽中悬停侧边栏高亮（`trackNavHover`，复用 FAB 的 is-drop-hover），松手后 `showMessage` 提示去向。DragSort 的 drop 事件新增 clientX（`elementFromPoint` 判定侧边栏落点需要）
13. **项目/区域面板三修**：①备注框（= 项目/区域 Notes，对应 Things 3 的 Project Notes）从子项下方移到**列表上方**（区域页原来压在项目列表之后）；②备注/标题分组改名输入框**点外面即收起**——此前只靠 `on:blur`，而任务卡片 `handleMouseDown` 的 `preventDefault` 会吞掉失焦事件，点任务卡/空白都可能不触发 blur；统一改为编辑态挂 document mousedown 监听（点输入框自身除外）。标题分组的"+ 添加"输入框同样处理；③项目视图「未分组」组**始终显示**（原来仅有标题且非空时才出现，导致"加第一个标题后任务才突然出现在未分组"的错觉）
14. **项目视图两修**：①清空未分组任务后标题分组整体消失——空状态条件 `sortedTasks.length === 0` 没排除 project 视图，整个分组块（含全部标题组）被空状态替换；已把 project 加入排除名单（项目页永远保留标题分组+未分组骨架）。②标题分组分割线长短不一——× 删除按钮占布局空间把线截短，叠加标题名长度差异后各线参差不齐；× 改为**绝对定位浮于标题行尾**（`visibility` 悬停出现、底色盖线），分割线一律延伸到右边缘
15. **三修 + 添加标题分组移位**：①项目标题分组下新建任务掉进未分组——根因是创建卡 taskData **根本没带 headingId**；TaskCard 新增 `presetHeadingId` prop，项目视图插入式新建按落点分组继承（"none" 组传 undefined），taskData/reset 补齐 headingId。②拖 + 扫过"某天"落到列表却建进收件箱——120ms 悬停切换没触发时卡片开在旧视图；FAB 新增 `lastNav`（拖拽中最后扫过的侧边栏视图，离开后保留），落到列表且 lastNav 视图 ≠ 当前视图 → 先切过去再顶部新建。③"添加标题分组"从列表底部独立按钮移入**项目页 ⋯ 菜单**（`dispatch("addheading")` → TaskList.startAddHeading 内联输入）；独立按钮已删，内联输入机制保留。④侧边栏收纳逻辑梳理：主导航六视图 = 时间/状态过滤器（收件箱=无归属无日期、今天=startDate≤今天且非someday、计划=startDate>今天、随时=有项目/区域/标签且无日期、某天=someday、日志=已完成）；**项目/区域 = 分类**（任务可同属一个项目或区域，经任务卡工具栏 📁 选择器指派，或拖任务到侧边栏项目/区域行）；标签 = 多对多标记。任务"在哪个视图"完全由字段推导，移动任务=改字段
16. **创建落点确定性 + 提醒功能完善**：①拖 + 建进错误视图的根治——创建卡显式携带目标视图（`presetView`/`presetViewId`，openCreate 第二参），TaskCard 建库时以 preset 为准而非渲染态 currentView（切视图与挂载有时序差），某天/今天/项目/区域落点全部确定性落库。②添加标题分组输入框**回车无响应**——中文输入法组词确认键也是 Enter（`isComposing`/keyCode 229），被误当提交且空草稿下直接关掉输入框；已加组词判定；改名/新建两个 commit 先清状态再写库，blur 重复触发为空操作（防重复建组）。③**提醒区分**：截止提醒胶囊改红色系（#fee2e2/#dc2626，title=截止提醒），开始提醒保持琥珀色（title=开始提醒）。④**提醒通知实现**（此前只有设置没有通知）：新增 `src/reminder.ts` ReminderService——30s 轮询，开始/截止时刻分别判定（仅设置了具体时刻的），到点发思源消息+系统通知（Electron Notification，未授权静默），每个提醒点（taskId+时间戳）只通知一次且持久化（things-reminders.json，重启不重复）；onload 启动、onunload 停止
17. **随时/计划创建落点 + 提醒语义统一**：①拖 + 到随时建的任务进收件箱——随时视图过滤条件要求任务带项目/区域/标签，裸任务天然不满足；现改为：创建卡实时提示（anytime 且无分类时卡片内灰条提示），提交后 toast 明确告知"已归入收件箱"；计划视图无日期新建默认明天（否则同样掉收件箱）。②提醒铃铛语义统一为**琥珀铃=开始提醒、红色铃=截止提醒**：任务卡胶囊（上轮已改）+ 日期选择器"添加开始提醒"（琥珀铃）+ 截止选择器"添加截止提醒"（红色铃），选项文案同步更名；收缩态行尾"开始时间"徽章从蓝色改琥珀色（此前蓝色与语义体系冲突），截止徽章带时刻时显示 HH:mm。此前两个选择器的铃铛同灰、胶囊同色，无法区分

**更早完成**（`f096f74`/`59c8101`）：
1. 修复截止日期核心 bug：`dateDisplay`/`deadlineDisplay` 响应式依赖丢失（改为显式传参）；逾期胶囊红底红字；DeadlinePicker 时间回显
2. 工具栏：按钮排序 `⭐ ⚑ ☷ 🏷 ×`；提醒时间独立 🔔 胶囊；截止旗子改红色
3. 任务列表 Things 风格重构：标题加视图图标；收缩态显示所属项目/区域 + 右侧弱化辅助信息（红⚑截止/☑清单/📄备注/🏷标签）；去分割线改留白 + hover 圆角；今天视图拆"今天/🌙今晚"两组

**建议的下一步**（按价值排序）：
- 「拖拽任务到其他 Project」：设计稿要求但尚未实现——把任务拖到侧边栏项目项改归属（FAB 的拖拽/落点机制可复用）
- 计划视图「只有 deadline 无 startDate」的任务不显示：`groupTasks` 中 `if (!task.startDate) continue` 直接丢弃（待修）
- 侧边栏数量偶尔不更新（待复现）
- 统一硬编码色值为 CSS 变量（#f3f4f6 / #9ca3af / #3b82f6 等），适配深色主题
- 死代码清理：TaskItem / App / TaskCreate / TaskDetail / Sidebar 五个无引用组件

**暂缓/不做**：附件功能（项目无此能力）

**验证状态**：已 build + 部署到本机思源插件目录。待实测：①日期/截止选择器滚动日历（从今天起、‹ 不早于今天）②计划视图近 7 天组头（明天/星期几）+ 月度骨架（跨月无空白/重叠）③+ 按钮拖拽：悬停侧边栏开页、列表发光插入指示线、松手弹性回弹 ④插入式新建：卡片开在落点、建完任务落在该位置、继承今晚/日期/月度/项目参数 ⑤收缩态项目/区域图标与标签图标显示

---

## 一、项目概述

**项目名称**：siyuan-things
**项目类型**：思源笔记（SiYuan）插件
**功能定位**：类似 Things 3 应用的任务管理工具
**开发语言**：TypeScript + Svelte 3
**Git 仓库**：https://github.com/chengslog/siyuan-things
**当前部署路径**：`C:\siyuan\data\plugins\siyuan-things\`

---

## 二、技术栈与环境

| 技术 | 版本 | 用途 |
|------|------|------|
| TypeScript | - | 类型安全 |
| Svelte | 4.x | UI 组件 |
| Vite | 5.x | 构建工具 |
| SCSS | - | 样式预处理 |
| siyuan (npm) | - | 插件 API 类型（Plugin/Tab/Model 等） |

**环境注意**：
- 用户 shell 是 Windows PowerShell v1，**不支持 `&&`，用 `;` 分隔命令**
- 测试与构建：`pnpm test`、`pnpm run build`（构建会依次执行 build:app + build:kernel，并打包 package.zip）
- 部署：思源工作空间路径**因机器而异**——如 `D:\siyuan\data\plugins\siyuan-things\` 或 `C:\siyuan\data\plugins\siyuan-things\`，先确认本机工作空间位置；`xcopy /E /Y /I "dist\*" "<工作空间>\data\plugins\siyuan-things\"`，然后重启思源或重新加载插件验证
- 依赖管理以仓库中的 `pnpm-lock.yaml` 为准，优先使用 pnpm；GitHub Release 工作流使用 npm 并由 `package-lock.json` 锁定依赖。

---

## 三、项目结构

```
siyuan_Things_plugin/
├── src/
│   ├── components/
│   │   ├── TaskCard.svelte       # ★ 核心：统一任务卡片（mode='create'|'edit'，含优先级 UI/noAutoSave/prefilledData）
│   │   ├── TaskList.svelte       # 任务列表视图（含拖拽排序、slideOut 滑出过渡）
│   │   ├── TaskItem.svelte       # ⚠️ 死代码，无任何引用，实际渲染用 TaskCard
│   │   ├── Sidebar.svelte        # 侧边栏导航
│   │   ├── DatePicker.svelte     # 日期选择器（今天/今晚/日历/某天/提醒/清除）
│   │   ├── DeadlinePicker.svelte # 截止日期选择器（今天/明天/下周/日历/提醒/清除）
│   │   ├── TagPicker.svelte      # 标签选择器（搜索+多选）
│   │   ├── Checklist.svelte      # 检查清单（增删改、回车新建、拖拽排序）
│   │   ├── TimePicker.svelte     # 时分选择器
│   │   └── DragSort.svelte       # 拖拽排序组件
│   ├── components/
│   │   ├── App.svelte            # ★ 外壳（已复活）：三态布局状态机 + 分隔条2 + 二级页面（不再是无引用死代码）
│   │   ├── AIChatCore.svelte     # AI 卡片流核心（面板/浮窗共用，真实流式思考）
│   │   ├── AIPanel.svelte        # 右侧常驻 AI 面板（宽屏形态）
│   │   ├── AICreator.svelte      # AI 全局浮窗（局部遮罩，任务列表之上）
│   │   ├── services/aiParser.ts  # AI 服务：SSE 流式 + reasoning_content + 思考强度
│   │   ├── stores/
│   │   ├── aiChat.ts             # AI 会话共享 store（面板/浮窗共用，跨形态不丢会话）
│   │   ├── base.ts               # 基础存储类（思源 storage 持久化）
│   │   ├── taskStore.ts          # 任务存储（toggleTask/updateTask/getSubTasks 等）
│   │   ├── projectStore.ts / areaStore.ts / tagStore.ts
│   │   └── index.ts              # StoreManager 聚合
│   ├── icons/                    # ★ 图标素材目录
│   │   ├── sprite.ts             # 全部 <symbol> 定义（多色视图图标 + Lucide 单色图标）
│   │   ├── Icon.svelte           # 通用图标组件 <Icon name size color klass/>
│   │   └── index.ts              # VIEW_ICON_MAP 唯一映射表 + ICON_COLORS 品牌色
│   ├── utils/                    # date/calendar/display（日期展示）/markdown（marked+DOMPurify）/upload（图片上传）/id
│   ├── types.ts                  # Task 等类型定义
│   ├── index.ts                  # ★ 插件入口（标签页管理、dock、设置）
│   └── index.scss                # 全局样式
├── dist/                         # 构建输出（部署此目录）
└── package.json
```

---

## 四、核心架构机制（必读）

### 4.1 标签页（Tab）管理 —— `src/index.ts`

这是本项目踩坑最多的部分，务必理解：

1. **`addTab` 的 `init()` 回调中 `this` 是 Model 对象，不是 Tab 实例！**
   - Model 只有 `element` / `data` / `parent`
   - `this.parent` 才是真正的 Tab 实例（拥有 `updateTitle()` / `headElement` / `title` / `icon`）
   - 依据：`node_modules/siyuan/types/layout/Model.d.ts` 中 `public parent: Tab`

2. **插件实例上缓存两个引用**（在 init 中捕获、destroy 中清理）：
   - `pluginInstance.thingsApp`：Svelte TaskList 应用实例（用 `$set` 切换视图）
   - `pluginInstance.thingsTab`：Tab 实例（用于更新标题/图标）
   - Svelte app 挂在 `(this.element as any).__thingsApp` 上供 destroy 取用

3. **标签页复用**：点击侧边栏时若 `thingsApp` 存在则 `$set({ view, viewId: undefined, searchQuery: "" })` + 更新标题图标，不新建标签页；不存在才 `openTab`。

4. **标题更新必须防御性 + DOM 兜底**（`updateTabTitle`/`updateTabIcon`）：
   ```typescript
   if (typeof this.thingsTab.updateTitle === 'function') this.thingsTab.updateTitle(title);
   // DOM 兜底：headElement.querySelector('.item__text') 直接改 textContent
   ```
   原因：会话恢复的 Tab 上 `updateTitle` 可能不存在（曾报 `updateTitle is not a function`）。

5. **启动默认视图**：`onLayoutReady` 中用**双重延时**：
   - 300ms：若已有恢复的标签页则 `applyDefaultView()`，否则 `openThingsTab(defaultView)`
   - 1500ms：再次 `applyDefaultView()`——因为思源标签页头部渲染晚于 300ms，会覆盖第一次的标题修改

### 4.2 TaskCard.svelte —— 统一任务卡片

- `mode='create'`（新建，默认展开）| `mode='edit'`（列表项，点击展开）
- `scheduleMode`（计划视图日程行）：收缩态左侧渲染蓝色 HH:mm 时间列替代 checkbox，隐藏副标题/辅助信息；展开后恢复正常形态（checkbox 回来）。由 TaskList 按 `hasTimeOfDay(task.startDate)` 传入
- **本地状态驱动 UI，避免 store 更新导致重置**：
  - `localChecklist`：编辑模式的检查清单本地副本（onMount 从 `store.tasks.getSubTasks` 加载），`checklistItems = mode==='edit' ? localChecklist : checklist`
  - `title`/`notes` 展开时从 task 拷贝，失焦保存（`saveTitle`/`saveNotes` 只在值变化时写 store）
- **卡片互斥**：展开时 `window.dispatchEvent(new CustomEvent('card-expanded', { detail: { cardId } }))`；每张卡片 onMount 监听该事件，收到其他卡片的 cardId 时 `saveAndCollapse()`
- **点击外部折叠**：展开后延迟 10ms 挂 `document click` 监听 `handleOutsideClick`，折叠/销毁时移除
- **卡片内点击 + 弹窗**：`handleCardClick` 开头先处理弹窗——有弹窗打开时，卡片内除弹窗自身外的任何点击一律先关弹窗并 return（不触发展开/折叠）；之后才是输入区早退、折叠切换
- **`handleCreate` 必须防重入**（`isCreating` 守卫）：创建是异步的而重置在最后，回车+失焦/连按回车会并发创建出同名重复任务，检查项错挂导致"丢失"
- **展开详情过渡**：详情 div 加 `transition:fade={{ duration: 150 }}`（svelte/transition）

### 4.3 动画实现原理（核心经验）

**问题根因**：`toggleTask`/`updateTask` 一写 store，视图立即重新过滤，`{#each}` 中组件瞬间销毁，动画来不及播放。**解法：先播动画/延迟，再写 store。**

1. **完成任务延迟 3 秒**（TaskCard `handleToggle`）：
   - 本地状态 `pendingDone=true` 立即打勾+置灰（checkbox/title 类绑定 `|| pendingDone`）
   - `setTimeout(3000)` 后才 `toggleTask` 写 store
   - `onDestroy` 守卫：若延迟未结束组件就被销毁（切视图），立即补写 `toggleTask`，防止勾选丢失
2. **视图迁移动画**（置灰 300ms → 左滑出 300ms）：
   - `willChangeCauseMove(changes)`：合并 changes 预判目标视图（someday→某天 / startDate<=今天→今天 / >今天→即将到来 / 有项目/标签→随时 / 否则收件箱），与 currentView 比较
   - 会迁移时：`isMovingOut=true`（CSS 仅置灰：opacity 0.5 + 灰底 + pointer-events none，**不含 transform**）→ 等 300ms → 写 store
   - 滑出由 **TaskList 的 `out:slideOut`** 负责（自定义 transition：`opacity + translateX(-100%)`，cubicOut，300ms）
   - 所有编辑 handler（handleDateChange/handleDeadlineChange/handleTagChange/clearStartDate/clearTags/clearDeadline）统一走 `applyChangeWithAnimation(changes)`

### 4.4 视图过滤规则

| 视图 | 条件 |
|------|------|
| 收件箱 | 无日期、无项目/区域、无标签、非 someday |
| 今天 | (startDate <= 今天 23:59:59) 或 (deadline = 今天) 或 (重复规则命中今天)，且非 someday |
| 即将到来 | (startDate > 今天) 或 (deadline > 今天 且无 startDate)，且非 someday |
| 随时 | 所有现在能做的活跃任务：(无日期) 或 (只有 deadline) 或 (startDate <= 今天)，排除 someday/子任务 |
| 某天 | someday = true |
| 日志 | status = 'done' |

### 4.5 SVG 图标规范

- **图标素材目录 `src/icons/`**：所有图标定义在 `sprite.ts`，启动时 `addIcons(ICON_SPRITE)` 一次性挂载；Svelte 模板中用 `<Icon name="iconThingsX" size={16} color="#..."/>`，TS 拼接 HTML 时用裸 `<svg><use xlink:href="#iconThingsX"/></svg>`
- **symbol id 必须用 `iconThings*` 命名空间，且不可再改名**。血泪教训：思源内核内置 236 个 litheness 单色图标（`stroke="currentColor"`），早期用的 `iconInbox`/`iconCalendar`/`iconSearch`/`iconCheck`/`iconAdd`/`iconTag`/`iconStar`/`iconCloud` 与内置 id 撞车——`<use>` 解析文档中**第一个**同 id 元素，内核图标先于插件加载，导致收件箱/计划长期显示为内置黑白图标，插件自己的彩色版本从未生效。新增图标一律 `iconThingsXxx`；恢复的标签页缓存旧图标名的问题由启动时 `applyDefaultView` 的双重延时（300ms+1500ms）重写 href 自愈
- 多色视图图标：颜色必须写在各 path 的 **inline style（style="fill: ..."）**，不要用 fill 属性——否则会被思源主题样式覆盖导致颜色异常
- 单色动作图标（Lucide 几何）：viewBox 24，path 上 inline style 写死 `fill:none;stroke:currentColor`，颜色由使用处 CSS `color` 或 Icon 的 `color` prop 控制
- 视图 → 图标只认 `VIEW_ICON_MAP`（`src/icons/index.ts`）这一张表，侧边栏/标签页/dock/页面标题/空状态共用；侧边栏/标签页图标随视图切换需同步更新（`getViewIcon(view)` + `updateTabIcon`）
- 日期/截止/提醒胶囊的图标+文案统一由 `utils/display.ts` 的 `getStartDateDisplay/getDeadlineDisplay/getReminderDisplay` 提供，不要各组件再写一份

---

## 五、数据模型

```typescript
interface Task {
  id: string;
  title: string;
  notes: string;
  status: 'todo' | 'done' | 'canceled';
  startDate?: number;      // 开始日期（时间戳；今晚=当天18:00）
  deadline?: number;       // 截止日期
  someday?: boolean;       // 某天任务
  projectId?: string;
  areaId?: string;
  parentId?: string;       // 子任务（检查清单项以子任务形式存储）
  tags: string[];          // tag id 数组
  order: number;
  created: number;
  updated: number;
  completedDate?: number;
}
```

日期显示规则（`utils/display.ts`）：今天→⭐（黄）；今晚(18:00)→🌙（蓝）；明天→计划日历+"明天"；具体日期→计划日历+完整日期（日历用多色视图图标 `iconThingsCalendar`，与侧边栏"计划"同款，不用线条日历）。**今天视图特判**：视图内任务都是"日期已到"的（含逾期），日期胶囊一律显示 ⭐ 今天，不再显示设置的那个日期。设置了具体时间（提醒）时，日期/截止胶囊只显示日期部分，提醒单独展示为一个 🔔 HH:mm 琥珀色只读胶囊。截止日期统一 ⚑ 前缀且旗子为红色；逾期时整个截止胶囊红底红字（is-overdue）。

---

## 六、工具栏布局（TaskCard 展开态底部）

- **左侧（已设置项，胶囊）**：日期(⭐/🌙/🗓+文字) → [日期提醒 🔔 HH:mm] → 标签(🏷+名) → 截止(⚑红色+文字) → [截止提醒 🔔 HH:mm]。日期/截止胶囊带 × 清除按钮、点击打开对应选择器；提醒胶囊为只读展示（仅设置了具体时间时出现）
- **右侧（未设置项，图标按钮）顺序固定为：⭐ ⚑ ☷ 🏷 ×**
  - ⭐/⚑/🏷 仅在对应项未设置时显示；☷（添加子任务）和 ×（删除）始终显示
  - 打开一个选择器时关掉其他两个

---

## 七、构建部署流程

```powershell
cd C:\projects\siyuan-things
pnpm test
pnpm run build
xcopy /E /Y /I "dist\*" "C:\siyuan\data\plugins\siyuan-things\"
# 然后重启思源验证
```

---

## 八、最近完成的修复（按时间倒序）

1. **分组视图拖拽排序修复**（2026-07-29，待提交）：DragSort 报告组内相对索引，`handleReorder` 改为先在组内应用移动、再原位映射回 `sortedTasks` 后统一重写 order（详见进度快照）
2. **图标体系统一 + 撞车修复**（2026-07-29，待提交）：新建 `src/icons/` 素材目录（sprite.ts + Icon.svelte + VIEW_ICON_MAP）；雪碧图从 index.ts 迁出；新增 14 个 Lucide 单色图标替换 83 处 emoji；合并 3 份重复 dateDisplay 到 utils/display.ts；**全部 symbol id 改 `iconThings*` 命名空间**——此前 iconInbox/iconCalendar 等 8 个 id 与思源内置 litheness 图标撞车，收件箱/计划一直渲染的是内核黑白图标（详见 §4.5）；顺带重调色：蓝色收件箱托盘、红调计划日历
3. **右侧任务列表 Things 风格重构**：页面标题加视图图标（⭐等）；TaskCard 收缩态标题下显示所属项目/区域名 + 右侧弱化辅助信息（红⚑截止/☑清单数/📄备注/🏷标签）；任务间去分割线改留白、hover 浅灰圆角；checkbox 18px、标题 16px/500；今天视图拆分"今天 / 🌙今晚"两组（18:00 为今晚）。遗留：拖拽到其他项目未实现；多分组视图内拖拽排序索引为组内相对值（与 upcoming 行为一致）
2. **12 节功能清单核对修复**（已推送 `2830bae`）：
   - 卡片互斥：补上 `card-expanded` 事件监听（之前只派发无人监听）
   - 添加子任务：编辑模式 `addSubTask` 改为追加到 `localChecklist`（之前只写 store，UI 不可见）
   - 展开详情加 fade 150ms 过渡
   - 工具栏右侧按钮顺序调整为 ⭐🏷⚑☷×
2. **动画修复**：完成延迟 3 秒（pendingDone 本地态）+ 视图迁移置灰→滑出（willChangeCauseMove + TaskList out:slideOut）
3. **标签页标题/默认视图**：this.parent 捕获 Tab、防御性 updateTitle、DOM 兜底、300ms+1500ms 双重延时
4. **标签页复用**：thingsApp/thingsTab 缓存 + $set 切换而非新建

---

## 九、已知问题 / 待办

| 事项 | 状态/优先级 |
|------|------|
| 死代码可删除：TaskItem.svelte、TaskCreate.svelte、TaskDetail.svelte、Sidebar.svelte（dock 由 index.ts renderDock 手绘；**App.svelte 已复活为外壳，勿删**） | 待清理 |
| AI 卡片硬编码浅色值（#f6f7f9/#e4e8ec 等）未适配深色主题 | 待处理 |
| TaskList 的 aiMode 仍保留 header/compact 分支（App 已不再传入） | 可清理 |
| 计划视图「只有 deadline 无 startDate」的任务被 `groupTasks` 丢弃、不显示 | 待修复 |
| 侧边栏数量偶尔不更新 | 待复现修复 |
| 统一样式使用 CSS 变量（部分硬编码 #f3f4f6 等） | 中 |
| ~~项目/区域管理功能~~ | ✅ 已完成（ProjectPanel/AreaPanel/总览视图/创建表单/拖拽排序） |
| ~~标签管理功能~~ | ✅ 已完成（即席创建/改名/换色/嵌套/排序/删除） |

---

## 十、给 AI 的操作提示

- 修改 UI 主看 `TaskCard.svelte`（1180+ 行），模板区约在 500 行以后，样式在 836 行以后
- **不要**让编辑操作直接写 store 后指望动画生效——遵循 4.3 的"先动画后写 store"模式
- **不要**在 `addTab` 的 init/destroy 回调里把 `this` 当 Tab 用，取 `this.parent`
- 检查清单（`Checklist.svelte`）：**新行只由回车创建**（`handleKeydown` + `pendingFocusId` 聚焦）；响应式块只保证"清单至少有一行输入行"。⚠️ 曾有"末项非空就自动追加空行"的逻辑，导致用户一打字就凭空多一行，已废除，不要加回来
- SearchReplace 编辑 TaskCard 时注意函数完整性（曾因 original_text 截断损坏过 `saveAndCollapse`）
- 每次改完：build → xcopy 部署 → 提醒用户重启思源验证

---

## 十一、2026-08-20 AI 任务助手与交互改造

### 11.1 AI 会话与稳定性

- AI 发送改为原生 `fetch` + SSE 流式读取，并对响应式 store 更新和自动滚动做节流，修复点击发送导致思源整体卡死。
- AI 面板和浮窗共用 `src/stores/aiChat.ts` 会话状态；关闭浮窗保留会话，只有点击“新会话”才清空。
- 支持连续追问、草稿修改、已入库任务修改，草稿通过 `clientId` 稳定匹配，避免修改时重复创建任务。
- 思考过程只展示最新一轮，处理阶段使用完整动态进度；自动滚动保证连续修改后可见最新结果。
- 新会话引导改为“创建 / 查询 / 分析整理”三类示例。

### 11.2 AI 创建与任务卡

- AI 结果复用 `TaskCard.svelte` 的完整功能，支持标题、备注、检查项、开始日期/时间、截止日期/时间、某天、项目、区域、项目标题分组和标签。
- AI 卡片不使用勾选框，改为 AI 标识；点击卡片外部自动收缩，点击卡片展开，与普通任务卡交互一致。
- AI 生成后不自动入库，需用户显式添加。已添加项使用收缩任务卡 + 删除线 + “已添加”状态，不提供误导性取消入库。
- 手动创建的“根据当前页面自动设置日期/归属”与 AI 创建上下文已隔离；AI 日期只由 AI 结果决定。
- 检查项以子任务存储，主列表统一过滤 `parentId`，重新打开任务时可恢复检查项。

### 11.3 统一 AI Agent 查询、修改和删除

- `src/services/aiParser.ts` 新增第一阶段 AI 意图路由：`create/search/update/delete/confirm/cancel/clarify/answer`。AI 负责理解用户意图，本地执行器只执行受限、结构化操作。
- 查询使用结构化视图作用域，覆盖：所有任务、收件箱、今天、计划、随时、某天、日志、项目/区域/标签总览、具体项目/区域/标签及项目标题分组。
- AI 获得当前页面上下文、最近 8 轮对话和上次结构化查询作用域。“这里”使用当前页面，“查看全部/继续”继承上次作用域。
- 视图最终由本地按 `TaskList.svelte` 同源规则取数；“有几个/查看全部”的数量和列表不由模型自由生成，避免少报、多报和 20 条限制。
- 查询结果整行可点击跳转并高亮真实任务；去掉了行尾“跳转”文字和重复数量说明。只有重复识别、原因、差异、总结、建议等查询保留 AI 文字分析。
- 重复任务查询结合标题语义、备注、日期、项目、区域和检查项，给出重复分组、差异和保留建议。
- 真实任务修改/删除先生成预览，必须明确确认才执行；包含字段白名单、稳定 ID、更新时间并发检查和操作 ID 幂等保护。
- AI 删除父任务会同时处理检查项，并将快照按批次写入 `tasks-trash.json`；`TaskStore.restoreLastTrashedBatch()` 已预留恢复能力，目前尚无可视化回收站入口。

### 11.4 任务卡弹层与布局

- AI 浮窗增加高度，去除面板/对话区不必要的宽度上限，窗口放大时内容可继续扩展。
- `src/utils/popup.ts` 的 `smartPosition` 将日期、截止日期、标签、项目/区域菜单移到 `document.body` 顶层渲染，避免被任务列表和 AI 滚动容器的 `overflow` 裁剪。
- 弹层使用视口坐标，支持上下自动翻转、左右边界限制、滚动/窗口缩放跟随和点击外部关闭。

### 11.5 构建与部署

- 当前思源工作空间位置：`C:\siyuan`。
- 插件部署目录：`C:\siyuan\data\plugins\siyuan-things`。
- 发布前执行 `pnpm test` 与 `pnpm run build`；构建产物和 `package.zip` 均由 Vite 构建流程生成。

### 11.6 后续建议

- AI 创建已能对简短说明做结构化整理，但提示词尚未明确“默认轻度润色、不改变原意、不凭空补充”的边界，建议下一轮加固。
- `src/stores/aiChat.ts` 仍保留 `legacySendAiMessage` 旧流程，已无 UI 调用，稳定后可删除并缩减死代码。
- 回收记录已落盘但暂无 UI；如需完整可恢复体验，应增加回收站列表、恢复指定批次和清理策略。
