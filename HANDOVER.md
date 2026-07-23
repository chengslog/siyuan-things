# 项目交接文档

## 一、项目概述

**项目名称**：siyuan-things
**项目类型**：思源笔记插件
**功能定位**：类似 Things 应用的任务管理工具
**开发语言**：TypeScript + Svelte
**作者**：ccriss

---

## 二、技术栈

| 技术 | 版本 | 用途 |
|------|------|------|
| TypeScript | - | 类型安全 |
| Svelte | 3.x | UI 组件 |
| Vite | 5.x | 构建工具 |
| SCSS | - | 样式预处理 |
| Node.js | - | 运行环境 |

---

## 三、项目结构

```
siyuan_Things_plugin/
├── src/
│   ├── components/          # 组件
│   │   ├── TaskCard.svelte  # 统一任务卡片（新建/编辑）
│   │   ├── TaskList.svelte  # 任务列表视图
│   │   ├── Sidebar.svelte   # 侧边栏导航
│   │   ├── DatePicker.svelte    # 日期选择器
│   │   ├── DeadlinePicker.svelte # 截止日期选择器
│   │   ├── TagPicker.svelte     # 标签选择器
│   │   ├── Checklist.svelte     # 检查清单
│   │   ├── TimePicker.svelte    # 时间选择器
│   │   └── DragSort.svelte      # 拖拽排序组件
│   ├── stores/              # 数据存储
│   │   ├── base.ts          # 基础存储类
│   │   ├── taskStore.ts     # 任务存储
│   │   ├── projectStore.ts  # 项目存储
│   │   ├── areaStore.ts     # 区域存储
│   │   ├── tagStore.ts      # 标签存储
│   │   └── index.ts         # StoreManager
│   ├── utils/               # 工具函数
│   │   ├── date.ts          # 日期工具
│   │   ├── calendar.ts      # 日历工具
│   │   └── id.ts            # ID 生成
│   ├── types.ts             # 类型定义
│   ├── index.ts             # 插件入口
│   └── index.scss           # 全局样式
├── i18n/                    # 国际化
├── public/                  # 静态资源
├── dist/                    # 构建输出
└── package.json
```

---

## 四、核心功能

### 4.1 侧边栏导航

| 功能 | 说明 |
|------|------|
| 收件箱 | 无日期、无项目、无标签的任务 |
| 今天 | startDate <= 今天 |
| 即将到来 | startDate > 今天 |
| 随时 | 无日期，有项目/标签 |
| 某天 | someday = true |
| 日志 | 已完成的任务 |

### 4.2 任务卡片功能

| 功能 | 说明 |
|------|------|
| 标题 | 编辑、完成状态切换 |
| 备注 | 多行文本编辑 |
| 日期选择 | 今天、今晚、日历、某天、提醒 |
| 标签选择 | 多选、搜索 |
| 截止日期 | 今天、明天、下周、日历、提醒 |
| 检查清单 | 添加、删除、完成、拖拽排序 |
| 拖拽排序 | 任务列表拖拽排序 |

### 4.3 交互动画

| 动画 | 说明 |
|------|------|
| 展开/折叠 | 平滑过渡 |
| 视图迁移 | 置灰 300ms → 向左滑出 300ms |
| 完成延迟 | 3 秒后移入日志 |

---

## 五、数据模型

```typescript
interface Task {
  id: string;
  title: string;
  notes: string;
  status: 'todo' | 'done' | 'canceled';
  startDate?: number;      // 开始日期
  deadline?: number;        // 截止日期
  someday?: boolean;        // 某天任务
  projectId?: string;
  areaId?: string;
  parentId?: string;
  tags: string[];
  order: number;
  created: number;
  updated: number;
  completedDate?: number;
}
```

---

## 六、构建部署

```bash
# 安装依赖
npm install

# 开发构建
npm run build

# 部署到思源
cp -r dist/* D:/siyuan/data/plugins/siyuan-things/
```

---

## 七、插件设置

| 设置项 | 说明 |
|--------|------|
| 启动时默认显示 | 收件箱、今天、计划、随时、某天、日志 |

---

## 八、已知问题

| 问题 | 状态 |
|------|------|
| 编辑任务时日期选择器事件不触发 | ❌ 待修复 |
| 侧边栏数量偶尔不更新 | ❌ 待修复 |

---

## 九、待办事项

| 任务 | 优先级 |
|------|--------|
| 修复编辑模式日期选择器 | 高 |
| 统一样式使用 CSS 变量 | 中 |
| 添加项目/区域管理功能 | 中 |
| 添加标签管理功能 | 中 |
| 优化性能 | 低 |

---

## 十、Git 仓库

**地址**：https://github.com/chengslog/siyuan-things
