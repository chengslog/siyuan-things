# 项目交接文档（AI 上下文）

> 本文档面向 AI 助手/新开发者，包含项目全貌、关键实现机制、踩坑经验与最近的修复记录。
> 最后更新：2026-07-29

---

## 📍 当前进度快照（2026-07-29）

> 给接手的新会话：先看这里，了解最近做到哪、接下来做什么。

**本轮已完成**（已提交 `f096f74` 并推送 main）：
1. 修复截止日期核心 bug：`dateDisplay`/`deadlineDisplay` 响应式依赖丢失（改为显式传参）；逾期胶囊红底红字；DeadlinePicker 时间回显
2. 工具栏：按钮排序 `⭐ ⚑ ☷ 🏷 ×`；提醒时间独立 🔔 胶囊；截止旗子改红色
3. 任务列表 Things 风格重构：标题加视图图标；收缩态显示所属项目/区域 + 右侧弱化辅助信息（红⚑截止/☑清单/📄备注/🏷标签）；去分割线改留白 + hover 圆角；今天视图拆"今天/🌙今晚"两组

**建议的下一步**（按价值排序）：
- 「拖拽任务到其他 Project」：设计稿要求但尚未实现，需在侧边栏项目项上做放置目标
- 分组视图拖拽排序：今天/upcoming 多分组时索引为组内相对值，跨组排序不准（`handleReorder` 用 `sortedTasks` 全局索引，与 DragSort 组内索引不一致）
- 精确图标颜色：⭐/🌙 目前是 emoji，无法改成设计稿的黄/蓝；需换自定义 SVG
- 侧边栏数量偶尔不更新（待复现）

**暂缓/不做**：附件功能（项目无此能力）

**验证状态**：均已 build + 部署到本机思源，待在思源里实测确认

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
| Svelte | 3.x | UI 组件 |
| Vite | 5.x | 构建工具 |
| SCSS | - | 样式预处理 |
| siyuan (npm) | - | 插件 API 类型（Plugin/Tab/Model 等） |

**环境注意**：
- 用户 shell 是 Windows PowerShell v1，**不支持 `&&`，用 `;` 分隔命令**
- 构建：`npm run build`（会依次执行 build:app + build:kernel，并打包 package.zip）
- 部署：`xcopy /E /Y /I "dist\*" "D:\siyuan\data\plugins\siyuan-things\"`，然后重启思源或重新加载插件验证

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
│   ├── utils/                    # date.ts / calendar.ts / id.ts
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
- **本地状态驱动 UI，避免 store 更新导致重置**：
  - `localChecklist`：编辑模式的检查清单本地副本（onMount 从 `store.tasks.getSubTasks` 加载），`checklistItems = mode==='edit' ? localChecklist : checklist`
  - `title`/`notes` 展开时从 task 拷贝，失焦保存（`saveTitle`/`saveNotes` 只在值变化时写 store）
- **卡片互斥**：展开时 `window.dispatchEvent(new CustomEvent('card-expanded', { detail: { cardId } }))`；每张卡片 onMount 监听该事件，收到其他卡片的 cardId 时 `saveAndCollapse()`
- **点击外部折叠**：展开后延迟 10ms 挂 `document click` 监听 `handleOutsideClick`，折叠/销毁时移除
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

- 图标颜色用 **inline style（style="fill: ..."）**，不要用 fill 属性——否则会被思源主题样式覆盖导致颜色异常
- 侧边栏/标签页图标随视图切换需同步更新（`getViewIcon(view)` + `updateTabIcon`）

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

日期显示规则：今天→⭐；今晚(18:00)→🌙；明天→🗓 明天；具体日期→🗓 2026-07-25。设置了具体时间（提醒）时，日期/截止胶囊只显示日期部分，提醒单独展示为一个 🔔 HH:mm 琥珀色只读胶囊。截止日期统一 ⚑ 前缀且旗子为红色；逾期时整个截止胶囊红底红字（is-overdue）。

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

1. **右侧任务列表 Things 风格重构**：页面标题加视图图标（⭐等）；TaskCard 收缩态标题下显示所属项目/区域名 + 右侧弱化辅助信息（红⚑截止/☑清单数/📄备注/🏷标签）；任务间去分割线改留白、hover 浅灰圆角；checkbox 18px、标题 16px/500；今天视图拆分"今天 / 🌙今晚"两组（18:00 为今晚）。遗留：拖拽到其他项目未实现；多分组视图内拖拽排序索引为组内相对值（与 upcoming 行为一致）
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
| TaskItem.svelte 是死代码，可删除 | 待清理 |
| 侧边栏数量偶尔不更新 | 待复现修复 |
| 统一样式使用 CSS 变量（部分硬编码 #f3f4f6 等） | 中 |
| 项目/区域管理功能 | 中 |
| 标签管理功能 | 中 |

---

## 十、给 AI 的操作提示

- 修改 UI 主看 `TaskCard.svelte`（1180+ 行），模板区约在 500 行以后，样式在 836 行以后
- **不要**让编辑操作直接写 store 后指望动画生效——遵循 4.3 的"先动画后写 store"模式
- **不要**在 `addTab` 的 init/destroy 回调里把 `this` 当 Tab 用，取 `this.parent`
- 检查清单的"末尾自动补空项"逻辑在 `Checklist.svelte` 的响应式块中，回车新建项通过 `pendingFocusId` 聚焦
- SearchReplace 编辑 TaskCard 时注意函数完整性（曾因 original_text 截断损坏过 `saveAndCollapse`）
- 每次改完：build → xcopy 部署 → 提醒用户重启思源验证
