# 项目交接文档（AI 上下文）

> 本文档面向 AI 助手/新开发者，包含项目全貌、关键实现机制、踩坑经验与最近的修复记录。
> 最后更新：2026-07-29

---

## 📍 当前进度快照（2026-07-29）

> 给接手的新会话：先看这里，了解最近做到哪、接下来做什么。

**本轮已完成**（待提交）：
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
    - **项目页**（`ProjectPanel.svelte`）：进度条 n/m、截止胶囊（逾期红底）、备注即点即编、状态徽章（暂停/完成/作废）、⋯ 管理菜单（改名/截止日期/移动到区域/完成/暂停/作废/删除，删除二次确认且任务回归收件箱）；新增 `onhold` 状态（`ProjectStatus`）
    - **区域页**（`AreaPanel.svelte`）：区域内项目列表（进度/截止，点击进项目）、备注、⋯ 菜单（改名/删除，级联解除归属不删数据）
    - **项目总览视图**（`ProjectOverview.svelte`，ViewType 新增 `projects`/`log`）：按状态分组（进行中/已暂停/已完成/已作废），dock 主导航新增「项目」入口
    - **标题分组（headings）**：项目页按标题分组渲染（组头可改名/删除，任务回未分组；"＋ 添加标题分组"内联创建）；**标题分组之间可直接拖拽任务改归属**（复用跨组拖拽机制，`moveTaskToGroup` 已泛化为按视图计算变更：upcoming→startDate、today→0点/18点、project→headingId）
    - **标签**：dock 新增标签节（色点+树形缩进）；`TagPicker` 支持即席创建（搜索词无精确同名→"创建标签「x」"行，调色板循环取色）与层级显示；**标签右键管理菜单**（重命名/12 色换色/移动到父标签防环/上移下移/删除且从所有任务摘除）
    - **创建表单化**：dock 与 FAB 的 prompt() 全部替换为内联表单（`EntityForm.svelte`，项目含区域下拉）
    - **侧边栏拖拽排序**：区域/项目/标签节内 HTML5 拖拽交换 order
    - **侧边栏结构重整**：全部图标化（主导航彩色视图图标、区块头图标、行级项目/区域/标签图标、+号换 iconThingsAdd）；分割线全删，改空行分组——收件箱 / 今天·计划·随时·某天 / 日志 / 区域 / 项目 / 标签；「项目」总览从主导航移入项目区块首行「全部项目」
    - **dock 实时同步**：index.ts 订阅 projects/areas/tags 三个 store，任何变更实时重渲染侧边栏；TaskList 也订阅全部 store（修复项目改名/状态切换标题不刷新）
    - 新文件：`ProjectAreaPicker/ProjectPanel/AreaPanel/ProjectOverview/EntityForm.svelte`、`utils/colors.ts`（TAG_PALETTE）
11. **跨组拖拽改日期**（`DragSort.svelte` + `TaskList.svelte`）：今天视图可在「今天/今晚」之间拖（→ 当天 0 点 / 18 点），计划视图可在日期分组之间拖（→ 目标日期，保留原时/分，日程行拖过去还是同一时刻）。机制：DragSort 加 `groupKey` prop + 容器绑定 + `drop` 事件（`withinSelf` 区分组内排序/跨组移动）+ 对外暴露 `containsPoint`/`computeInsertIndex`；指针越出本组容器时幽灵自由跟随。TaskList 按组 key 注册 DragSort 实例与分组块 DOM（`dragSortRefs`/`groupBlockRefs`，`bind:this={obj[group]}`），拖拽中 mousemove 追踪落点分组并高亮（`is-drop-target`），松手后 `moveTaskToGroup` 由分组 key 推算新日期，再按 handleReorder 的"原位写回"机制重排 order。限制：只能拖到**已有任务的分组**（空日期没有落点区域）；`{ @const }` 必须放在 `{#each}` 的直接子级，包装 div 要在它后面

**上一轮已完成**（已提交 `f096f74`/`59c8101` 并推送 main）：
1. 修复截止日期核心 bug：`dateDisplay`/`deadlineDisplay` 响应式依赖丢失（改为显式传参）；逾期胶囊红底红字；DeadlinePicker 时间回显
2. 工具栏：按钮排序 `⭐ ⚑ ☷ 🏷 ×`；提醒时间独立 🔔 胶囊；截止旗子改红色
3. 任务列表 Things 风格重构：标题加视图图标；收缩态显示所属项目/区域 + 右侧弱化辅助信息（红⚑截止/☑清单/📄备注/🏷标签）；去分割线改留白 + hover 圆角；今天视图拆"今天/🌙今晚"两组

**建议的下一步**（按价值排序）：
- 「拖拽任务到其他 Project」：设计稿要求但尚未实现，需在侧边栏项目项上做放置目标
- 计划视图「只有 deadline 无 startDate」的任务不显示：`groupTasks` 中 `if (!task.startDate) continue` 直接丢弃（新发现，本轮未修）
- 侧边栏数量偶尔不更新（待复现）

**暂缓/不做**：附件功能（项目无此能力）

**验证状态**：已 build + 部署到本机思源（`C:\siyuan\data\plugins\siyuan-things\`），待在思源里实测：①今天视图两组内分别拖拽排序 ②计划视图多日期分组内排序 ③单分组视图（收件箱/随时等）排序回归正常 ④图标换 SVG 后的视觉：日期胶囊（⭐黄/🌙蓝/⚑红）、工具栏按钮、页面标题、空状态、Picker 选项

---

## 一、项目概述

**项目名称**：siyuan-things
**项目类型**：思源笔记（SiYuan）插件
**功能定位**：类似 Things 3 应用的任务管理工具
**开发语言**：TypeScript + Svelte 3
**Git 仓库**：https://github.com/chengslog/siyuan-things
**部署路径**：`D:\siyuan\data\plugins\siyuan-things\`

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
- 构建：`npm run build`（会依次执行 build:app + build:kernel，并打包 package.zip）
- 部署：思源工作空间路径**因机器而异**——如 `D:\siyuan\data\plugins\siyuan-things\` 或 `C:\siyuan\data\plugins\siyuan-things\`，先确认本机工作空间位置；`xcopy /E /Y /I "dist\*" "<工作空间>\data\plugins\siyuan-things\"`，然后重启思源或重新加载插件验证
- 本机（2026-07-29 接手环境）无 pnpm，用 `npm install` 即可

---

## 三、项目结构

```
siyuan_Things_plugin/
├── src/
│   ├── components/
│   │   ├── TaskCard.svelte       # ★ 核心：统一任务卡片（mode='create'|'edit'），~1180 行
│   │   ├── TaskList.svelte       # 任务列表视图（含拖拽排序、slideOut 滑出过渡）
│   │   ├── TaskItem.svelte       # ⚠️ 死代码，无任何引用，实际渲染用 TaskCard
│   │   ├── Sidebar.svelte        # 侧边栏导航
│   │   ├── DatePicker.svelte     # 日期选择器（今天/今晚/日历/某天/提醒/清除）
│   │   ├── DeadlinePicker.svelte # 截止日期选择器（今天/明天/下周/日历/提醒/清除）
│   │   ├── TagPicker.svelte      # 标签选择器（搜索+多选）
│   │   ├── Checklist.svelte      # 检查清单（增删改、回车新建、拖拽排序）
│   │   ├── TimePicker.svelte     # 时分选择器
│   │   └── DragSort.svelte       # 拖拽排序组件
│   ├── stores/
│   │   ├── base.ts               # 基础存储类（思源 storage 持久化）
│   │   ├── taskStore.ts          # 任务存储（toggleTask/updateTask/getSubTasks 等）
│   │   ├── projectStore.ts / areaStore.ts / tagStore.ts
│   │   └── index.ts              # StoreManager 聚合
│   ├── icons/                    # ★ 图标素材目录
│   │   ├── sprite.ts             # 全部 <symbol> 定义（多色视图图标 + Lucide 单色图标）
│   │   ├── Icon.svelte           # 通用图标组件 <Icon name size color klass/>
│   │   └── index.ts              # VIEW_ICON_MAP 唯一映射表 + ICON_COLORS 品牌色
│   ├── utils/                    # date.ts / calendar.ts / display.ts（日期展示）/ id.ts
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
| 今天 | startDate <= 今天 23:59:59 |
| 即将到来 | startDate > 今天 |
| 随时 | 无日期，有项目/区域/标签 |
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
cd d:\project\siyuan_Things_plugin
npm run build
xcopy /E /Y /I "dist\*" "D:\siyuan\data\plugins\siyuan-things\"
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
| 死代码可删除：TaskItem.svelte、App.svelte、TaskCreate.svelte、TaskDetail.svelte、Sidebar.svelte（dock 由 index.ts renderDock 手绘，Sidebar 组件未使用）均无任何引用 | 待清理 |
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
