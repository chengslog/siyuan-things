import {
  Plugin,
  showMessage,
  Dialog,
  openTab,
  getFrontend,
} from "siyuan";

import "./index.scss";
import TaskList from "@/components/TaskList.svelte";
import { StoreManager } from "@/stores";
import { TaskStoreDB } from "@/stores/taskStoreDB";
import type { ViewType, PluginConfig } from "@/types";
import { DEFAULT_CONFIG } from "@/types";
import { SettingUtils } from "./libs/setting-utils";
import { ICON_SPRITE, getViewIconId } from "@/icons";
import { ReminderService } from "@/reminder";
import { TAG_PALETTE, nextTagColor } from "@/utils/colors";

const STORAGE_NAME = "things-config";
const TAB_TYPE = "things_tab";

export default class ThingsPlugin extends Plugin {
  private store: StoreManager;
  private reminderService: ReminderService;
  private settingUtils: SettingUtils;
  private dockElement: HTMLElement | null = null;
  private unsubTaskChange: (() => void) | null = null;
  private thingsApp: any = null; // 当前标签页的 Svelte 组件实例
  private thingsTab: any = null; // 当前标签页的 Tab 实例

  async onload() {
    console.log("[Things] Loading plugin...");

    this.store = new StoreManager(this);

    // 提醒通知服务：开始/截止时刻到点后消息+系统通知（每 30s 轮询，已提醒不重复）
    this.reminderService = new ReminderService(this, this.store);
    this.reminderService.start();

    this.addIcons(ICON_SPRITE);

    const pluginInstance = this;

    // 注册自定义标签页类型
    this.addTab({
      type: TAB_TYPE,
      init() {
        const view = this.data.view || "today";
        const viewId = this.data.viewId;
        console.log("[Things] Tab init:", view, viewId);

        const container = document.createElement("div");
        container.style.height = "100%";
        container.style.overflow = "hidden";
        this.element.appendChild(container);

        const app = new TaskList({
          target: container,
          props: {
            view: view,
            viewId: viewId,
            searchQuery: "",
            store: pluginInstance.store,
          },
        });

        (this.element as any).__thingsApp = app;
        pluginInstance.thingsApp = app;
        // this.parent 是实际的 Tab 实例（拥有 updateTitle, headElement 等方法）
        if ((this as any).parent) {
          pluginInstance.thingsTab = (this as any).parent;
          console.log("[Things] Tab captured via parent:", !!pluginInstance.thingsTab);
        }
      },
      destroy() {
        const app = (this.element as any).__thingsApp;
        if (app) {
          app.$destroy();
          (this.element as any).__thingsApp = null;
        }
        // 只有当前标签页被销毁时才清空引用
        const tab = (this as any).parent;
        if (pluginInstance.thingsTab === tab) {
          pluginInstance.thingsApp = null;
          pluginInstance.thingsTab = null;
        }
      },
    });

    // 注册左侧面板
    this.addDock({
      config: {
        position: "LeftTop",
        size: { width: 180, height: 0 },
        icon: "iconThings",
        title: "Things",
        hotkey: "⌥⌘T",
      },
      data: {},
      type: "things_nav",
      init: (dock) => {
        console.log("[Things] Dock init");
        this.dockElement = dock.element;
        this.renderDock(dock.element);
      },
      destroy() {
        this.dockElement = null;
      }
    });

    // 注册命令
    this.addCommand({
      langKey: "quickAddTask",
      hotkey: "⇧⌘N",
      callback: () => {
        this.quickAddTask();
      },
    });

    this.eventBus.on("click-blockicon", this.blockIconEvent.bind(this));

    // 面板级导航（如项目删除后跳回收件箱）：组件 dispatch window 事件，外壳执行切换
    window.addEventListener("things-navigate", ((e: CustomEvent) => {
      const detail = e.detail || {};
      if (detail.view) {
        this.openThingsTab(detail.view, detail.viewId);
        if (this.dockElement) this.setActive(this.dockElement, detail.view);
      }
    }) as EventListener);

    // 项目/区域变更 → 侧边栏实时刷新（改名、删除、完成、暂停都同步）
    const refreshDock = () => {
      if (this.dockElement) {
        this.renderProjects(this.dockElement);
        this.renderAreas(this.dockElement);
        this.renderTags(this.dockElement);
        this.updateCounts(this.dockElement);
      }
    };
    this.store.projects.on(refreshDock);
    this.store.areas.on(refreshDock);
    this.store.tags.on(refreshDock);

    this.settingUtils = new SettingUtils({
      plugin: this,
      name: STORAGE_NAME,
    });

    // 添加设置项
    this.settingUtils.addItem({
      key: "defaultView",
      value: "today",
      type: "select",
      title: "启动时默认显示",
      description: "每次打开思源时默认显示的视图；选「不打开」则不干预思源的启动逻辑（自动恢复上次打开的文档）",
      options: {
        none: "不打开（跟随思源默认）",
        inbox: "收件箱",
        today: "今天",
        upcoming: "计划",
        anytime: "随时",
        someday: "某天",
        log: "日志",
      },
    });

    // 监听任务变化，自动更新侧边栏计数
    this.unsubTaskChange = this.store.tasks.on(() => {
      if (this.dockElement) {
        this.updateCounts(this.dockElement);
      }
    });

    console.log("[Things] Plugin loaded");
  }

  async onLayoutReady() {
    await this.store.loadAll();
    await this.settingUtils.load();
    console.log("[Things] Data loaded, tasks:", this.store.tasks.count);

    if (this.dockElement) {
      this.updateCounts(this.dockElement);

      // 获取默认视图设置
      const defaultView = this.settingUtils.get("defaultView") || "today";

      // 选了"不打开" → 不干预思源启动逻辑（不打开 Things 标签页）
      if (defaultView === "none") {
        console.log("[Things] defaultView=none，跳过启动时打开");
        return;
      }

      // 应用默认视图的函数
      const applyDefaultView = () => {
        if (this.thingsApp && this.thingsTab) {
          this.thingsApp.$set({ view: defaultView, viewId: undefined, searchQuery: "" });
          this.updateTabTitle(this.getViewTitle(defaultView as ViewType));
          this.updateTabIcon(this.getViewIcon(defaultView as ViewType));
          this.setActive(this.dockElement!, defaultView as ViewType);
        }
      };

      // 等待思源完成标签页恢复
      setTimeout(() => {
        console.log("[Things] onLayoutReady: thingsApp=", !!this.thingsApp, "thingsTab=", !!this.thingsTab, "defaultView=", defaultView);
        if (this.thingsApp && this.thingsTab) {
          applyDefaultView();
        } else {
          this.openThingsTab(defaultView as ViewType);
          this.setActive(this.dockElement!, defaultView as ViewType);
        }
      }, 300);

      // 延迟二次更新，确保思源渲染完成后标题不被覆盖
      setTimeout(() => {
        applyDefaultView();
      }, 1500);
    }
  }

  async onunload() {
    console.log("[Things] Plugin unloaded");

    // 停止提醒服务
    this.reminderService?.stop();

    // 取消 store 监听
    if (this.unsubTaskChange) {
      this.unsubTaskChange();
      this.unsubTaskChange = null;
    }

    // 关闭所有 Things 相关的标签页
    const tabs = document.querySelectorAll(`[data-type="${TAB_TYPE}"]`);
    tabs.forEach(tab => {
      const closeBtn = tab.querySelector('.item__close');
      if (closeBtn) {
        (closeBtn as HTMLElement).click();
      }
    });
  }

  /**
   * 渲染停靠栏
   */
  private renderDock(element: HTMLElement) {
    // 主导航按语义分组（组间以空行分隔，不用分割线）：
    // 收件箱 | 今天、计划、随时、某天 | 日志
    const navGroups: { view: ViewType; icon: string; label: string }[][] = [
      [{ view: "inbox" as ViewType, icon: "iconThingsInbox", label: "收件箱" }],
      [
        { view: "today" as ViewType, icon: "iconThingsToday", label: "今天" },
        { view: "upcoming" as ViewType, icon: "iconThingsCalendar", label: "计划" },
        { view: "anytime" as ViewType, icon: "iconThingsAnytime", label: "随时" },
        { view: "someday" as ViewType, icon: "iconThingsSomeday", label: "某天" },
      ],
      [{ view: "log" as ViewType, icon: "iconThingsLog", label: "日志" }],
    ];

    let html = `<div class="things-nav">`;

    // 搜索框
    html += `
      <div class="things-nav__search">
        <input type="text" class="things-nav__search-input" placeholder="快速查找" />
      </div>
    `;

    // 主要导航（分组渲染）
    for (const group of navGroups) {
      html += `<div class="things-nav__group">`;
      for (const item of group) {
        html += `
          <div class="things-nav__item" data-view="${item.view}">
            <svg class="things-nav__icon"><use xlink:href="#${item.icon}"></use></svg>
            <span class="things-nav__label">${item.label}</span>
            <span class="things-nav__count" data-count="${item.view}"></span>
          </div>
        `;
      }
      html += `</div>`;
    }

    // 项目（整行可点 = 全部项目总览）
    html += `
      <div class="things-nav__section">
        <div class="things-nav__header" data-view="projects" title="查看全部项目">
          <span class="things-nav__header-label">
            <svg class="things-nav__icon"><use xlink:href="#iconThingsProject"></use></svg>项目
          </span>
          <span class="things-nav__add" data-add="project" title="新建项目">
            <svg><use xlink:href="#iconThingsAdd"></use></svg>
          </span>
        </div>
        <div id="things-projects"></div>
      </div>
    `;

    // 区域（整行可点 = 全部区域总览）
    html += `
      <div class="things-nav__section">
        <div class="things-nav__header" data-view="areas" title="查看全部区域">
          <span class="things-nav__header-label">
            <svg class="things-nav__icon"><use xlink:href="#iconThingsArea"></use></svg>区域
          </span>
          <span class="things-nav__add" data-add="area" title="新建区域">
            <svg><use xlink:href="#iconThingsAdd"></use></svg>
          </span>
        </div>
        <div id="things-areas"></div>
      </div>
    `;

    // 标签（整行可点 = 全部标签总览）
    html += `
      <div class="things-nav__section">
        <div class="things-nav__header" data-view="tags" title="查看全部标签">
          <span class="things-nav__header-label">
            <svg class="things-nav__icon"><use xlink:href="#iconThingsTagColor"></use></svg>标签
          </span>
          <span class="things-nav__add" data-add="tag" title="新建标签">
            <svg><use xlink:href="#iconThingsAdd"></use></svg>
          </span>
        </div>
        <div id="things-tags"></div>
      </div>
    `;

    html += `</div>`;
    element.innerHTML = html;

    this.bindEvents(element);
    this.renderProjects(element);
    this.renderAreas(element);
    this.renderTags(element);
    this.updateCounts(element);

    // 默认选中"今天"
    this.setActive(element, "today");
  }

  /**
   * 绑定事件
   */
  private bindEvents(element: HTMLElement) {
    // 主要导航点击
    element.querySelectorAll('.things-nav__item').forEach(el => {
      el.addEventListener('click', () => {
        const view = (el as HTMLElement).dataset.view as ViewType;
        console.log("[Things] Click:", view);
        this.openThingsTab(view);
        this.setActive(element, view);
      });
    });

    // 区块头整行可点 = 全部项目/全部区域/全部标签 总览（＋ 按钮自身 stopPropagation，不触发导航）
    element.querySelectorAll('.things-nav__header[data-view]').forEach(el => {
      el.addEventListener('click', () => {
        const view = (el as HTMLElement).dataset.view as ViewType;
        if (view) {
          this.openThingsTab(view);
          this.setActive(element, view);
        }
      });
    });

    // 添加项目/区域/标签：弹出悬浮创建卡片
    element.querySelectorAll('.things-nav__add').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const type = (el as HTMLElement).dataset.add as 'project' | 'area' | 'tag';
        if (type) {
          this.showCreateCard(element, type, el as HTMLElement);
        }
      });
    });

    // 搜索框 - 点击后在编辑区域打开搜索
    const searchBox = element.querySelector('.things-nav__search') as HTMLElement;
    if (searchBox) {
      searchBox.addEventListener('click', () => {
        this.openSearchDialog();
      });
    }
  }

  /**
   * 渲染项目列表
   */
  private renderProjects(element: HTMLElement) {
    const container = element.querySelector('#things-projects');
    if (!container) return;

    const projects = this.store.projects.getActiveProjects();
    let html = '';

    for (const p of projects) {
      html += `
        <div class="things-nav__item things-nav__item--sub things-nav-row" data-view="project" data-id="${p.id}" title="单击打开 · 悬停 ✎ 改名 · 按住拖动排序">
          <svg class="things-nav__icon things-nav__icon--sm"><use xlink:href="#iconThingsFolder"></use></svg>
          <span class="things-nav__label things-nav-row__name">${p.name}</span>
          <span class="things-nav-row__edit" title="重命名项目"><svg><use xlink:href="#iconThingsPencil"></use></svg></span>
          <span class="things-nav-row__del" title="删除项目">×</span>
        </div>
      `;
    }

    if (projects.length === 0) {
      html = '<div class="things-nav__empty">暂无</div>';
    }

    container.innerHTML = html;

    container.querySelectorAll('.things-nav-row').forEach(el => {
      const node = el as HTMLElement;
      const id = node.dataset.id!;

      // 单击 → 打开项目页（零延迟；改名走悬停 ✎ 按钮，不再用双击）
      node.addEventListener('click', (e) => {
        if (node.dataset.justDragged) { delete node.dataset.justDragged; return; }
        const target = e.target as HTMLElement;
        if (target.closest('.things-nav-row__edit') || target.closest('.things-nav-row__del') || target.closest('.things-nav-row__input')) return;
        this.openThingsTab('project' as ViewType, id);
        this.setActive(element, 'project' as ViewType, id);
      });

      // ✎ 按钮 → 内联改名
      node.querySelector('.things-nav-row__edit')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.startRowRename(element, node, id, 'project');
      });

      this.bindRowDelete(node, id, 'project');
    });
    this.bindSectionDragSort(container, 'project');
  }

  /**
   * 渲染区域列表
   */
  private renderAreas(element: HTMLElement) {
    const container = element.querySelector('#things-areas');
    if (!container) return;

    const areas = this.store.areas.getAll();
    let html = '';

    for (const a of areas) {
      html += `
        <div class="things-nav__item things-nav__item--sub things-nav-row" data-view="area" data-id="${a.id}" title="单击打开 · 悬停 ✎ 改名 · 按住拖动排序">
          <svg class="things-nav__icon things-nav__icon--sm"><use xlink:href="#iconThingsLayers"></use></svg>
          <span class="things-nav__label things-nav-row__name">${a.name}</span>
          <span class="things-nav-row__edit" title="重命名区域"><svg><use xlink:href="#iconThingsPencil"></use></svg></span>
          <span class="things-nav-row__del" title="删除区域">×</span>
        </div>
      `;
    }

    if (areas.length === 0) {
      html = '<div class="things-nav__empty">暂无</div>';
    }

    container.innerHTML = html;

    container.querySelectorAll('.things-nav-row').forEach(el => {
      const node = el as HTMLElement;
      const id = node.dataset.id!;

      // 单击 → 打开区域页（零延迟；改名走悬停 ✎ 按钮，不再用双击）
      node.addEventListener('click', (e) => {
        if (node.dataset.justDragged) { delete node.dataset.justDragged; return; }
        const target = e.target as HTMLElement;
        if (target.closest('.things-nav-row__edit') || target.closest('.things-nav-row__del') || target.closest('.things-nav-row__input')) return;
        this.openThingsTab('area' as ViewType, id);
        this.setActive(element, 'area' as ViewType, id);
      });

      // ✎ 按钮 → 内联改名
      node.querySelector('.things-nav-row__edit')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.startRowRename(element, node, id, 'area');
      });

      this.bindRowDelete(node, id, 'area');
    });
    this.bindSectionDragSort(container, 'area');
  }

  /**
   * 渲染标签列表（树形：子标签缩进；点击进入标签视图，右键打开管理菜单）
   */
  private renderTags(element: HTMLElement) {
    const container = element.querySelector('#things-tags');
    if (!container) return;

    const roots = this.store.tags.getRootTags().sort((a, b) => a.order - b.order);
    let html = '';

    const renderLevel = (tags: any[], depth: number) => {
      for (const t of tags) {
        // 色点 = 换色开关（占 16px 图标位保持对齐）；无色标签显示虚线空点
        const dot = t.color
          ? `<span class="things-tag-row__dot" title="更换颜色"><span style="background: ${t.color}"></span></span>`
          : `<span class="things-tag-row__dot things-tag-row__dot--empty" title="设置颜色"><span></span></span>`;
        html += `
          <div class="things-nav__item things-nav__item--sub things-tag-row things-nav-row${depth === 0 ? ' things-tag-row--root' : ''}" data-view="tag" data-id="${t.id}"
               style="padding-left: ${12 + depth * 16}px" title="单击打开 · 悬停 ✎ 改名 · 按住拖动排序">
            ${dot}
            <span class="things-nav__label things-nav-row__name">${t.name}</span>
            <span class="things-nav-row__edit" title="重命名标签"><svg><use xlink:href="#iconThingsPencil"></use></svg></span>
            <span class="things-nav-row__del" title="删除标签">×</span>
          </div>
        `;
        const children = this.store.tags.getChildTags(t.id).sort((a, b) => a.order - b.order);
        if (children.length) renderLevel(children, depth + 1);
      }
    };
    renderLevel(roots, 0);

    if (roots.length === 0) {
      html = '<div class="things-nav__empty">暂无</div>';
    }

    container.innerHTML = html;

    container.querySelectorAll('.things-tag-row').forEach(el => {
      const row = el as HTMLElement;
      const id = row.dataset.id!;

      // 单击 → 打开标签视图（零延迟；改名走悬停 ✎ 按钮，不再用双击）
      row.addEventListener('click', (e) => {
        if (row.dataset.justDragged) { delete row.dataset.justDragged; return; }
        const target = e.target as HTMLElement;
        if (target.closest('.things-tag-row__dot') || target.closest('.things-nav-row__edit') || target.closest('.things-nav-row__del') || target.closest('.things-nav-row__input')) return;
        this.openThingsTab('tag' as ViewType, id);
        this.setActive(element, 'tag' as ViewType, id);
      });

      // ✎ 按钮 → 内联改名
      row.querySelector('.things-nav-row__edit')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.startRowRename(element, row, id, 'tag');
      });

      // 点色点 → 调色板
      row.querySelector('.things-tag-row__dot')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.showTagPalette(row, id);
      });

      this.bindRowDelete(row, id, 'tag');
    });
    this.bindSectionDragSort(container, 'tag');
  }

  /**
   * 侧边栏分节拖拽排序（同节内）。自定义鼠标拖拽：
   * 5px 阈值区分点击/拖动 → 幽灵卡片跟随 + 邻居挤占动画 + 插入指引线 → 松手按新序列重写 order。
   */
  private bindSectionDragSort(container: Element, kind: 'area' | 'project' | 'tag') {
    // 标签只允许顶层行参与排序（嵌套子标签不介入，避免打乱层级）
    const rowSel = kind === 'tag' ? '.things-tag-row--root' : '.things-nav__item';
    container.querySelectorAll(rowSel).forEach(el => {
      const node = el as HTMLElement;
      node.addEventListener('mousedown', (e) => {
        const ev = e as MouseEvent;
        if (ev.button !== 0) return;
        const target = ev.target as HTMLElement;
        // 交互元素上不启动拖拽（加号、标签色点、改名/删除按钮、改名输入框）
        if (target.closest('.things-nav__add') || target.closest('.things-tag-row__dot') ||
            target.closest('.things-nav-row__edit') || target.closest('.things-nav-row__del') ||
            target.closest('.things-nav-row__input')) return;
        ev.preventDefault(); // 阻止文本选中
        this.startSectionDrag(ev, node, container as HTMLElement, kind, rowSel);
      });
    });
  }

  private startSectionDrag(startEv: MouseEvent, node: HTMLElement, container: HTMLElement, kind: 'area' | 'project' | 'tag', rowSel: string) {
    const startY = startEv.clientY;
    const rect = node.getBoundingClientRect();
    const offsetY = startY - rect.top;
    const itemH = rect.height;
    let dragging = false;
    let ghost: HTMLElement | null = null;
    let indicator: HTMLElement | null = null;
    let insertIdx = -1;

    const rows = () => Array.from(container.querySelectorAll(rowSel)) as HTMLElement[];
    const others0 = rows().filter(r => r !== node);
    // 起始中心位置用于落点判定（不受挤占位移影响，避免反馈抖动）
    const centers0 = others0.map(r => {
      const rc = r.getBoundingClientRect();
      return rc.top + rc.height / 2;
    });

    const layout = (pointerY: number) => {
      // 目标插入索引（相对"去除源"的列表）；源的最终全局位置即 idx
      let idx = others0.length;
      for (let i = 0; i < centers0.length; i++) {
        if (pointerY < centers0[i]) { idx = i; break; }
      }
      if (idx === insertIdx) return;
      insertIdx = idx;

      // 挤占动画：原位置与目标位置之间的邻居平移一个槽位，空槽"流"向落点
      const all = rows();
      const origFull = all.indexOf(node);
      const targetFull = idx;
      all.forEach((r, full) => {
        if (r === node) return;
        let shift = 0;
        if (targetFull > origFull && full > origFull && full <= targetFull) shift = -itemH; // 向下拖：中间的上去
        else if (targetFull < origFull && full >= targetFull && full < origFull) shift = itemH; // 向上拖：中间的下来
        r.style.transform = shift ? `translateY(${shift}px)` : '';
      });

      // 指引线落在挤占后布局的目标槽位边界
      if (indicator) {
        const others = rows().filter(r => r !== node);
        const cRect = container.getBoundingClientRect();
        let y: number;
        if (others.length === 0) {
          y = cRect.top;
        } else if (idx <= 0) {
          y = others[0].getBoundingClientRect().top - 4;
        } else if (idx >= others.length) {
          y = others[others.length - 1].getBoundingClientRect().bottom + 4;
        } else {
          y = (others[idx - 1].getBoundingClientRect().bottom + others[idx].getBoundingClientRect().top) / 2;
        }
        indicator.style.top = `${y - cRect.top}px`;
      }
    };

    const onMove = (ev: MouseEvent) => {
      if (!dragging) {
        if (Math.abs(ev.clientY - startY) < 5) return; // 阈值：区分点击与拖动
        dragging = true;
        ghost = node.cloneNode(true) as HTMLElement;
        ghost.classList.add('things-drag-ghost');
        ghost.style.left = `${rect.left}px`;
        ghost.style.width = `${rect.width}px`;
        document.body.appendChild(ghost);
        node.style.visibility = 'hidden';
        indicator = document.createElement('div');
        indicator.className = 'things-drag-indicator';
        container.appendChild(indicator);
        layout(startEv.clientY); // 初始态：指引线落在源槽位
      }
      ghost!.style.top = `${ev.clientY - offsetY}px`;
      layout(ev.clientY);
    };

    const onUp = async () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      if (!dragging) return;
      node.dataset.justDragged = '1'; // 抑制本次拖拽后的 click（避免误触导航）

      // 按新序列重写 order
      const others = rows().filter(r => r !== node);
      const newIds: string[] = [];
      others.forEach((r, i) => {
        if (i === insertIdx) newIds.push(node.dataset.id!);
        newIds.push(r.dataset.id!);
      });
      if (insertIdx >= others.length) newIds.push(node.dataset.id!);

      // 清理视觉状态
      ghost?.remove();
      indicator?.remove();
      node.style.visibility = '';
      rows().forEach(r => { r.style.transform = ''; });

      await this.reorderSection(kind, newIds);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  private async reorderSection(kind: 'area' | 'project' | 'tag', ids: string[]) {
    for (let i = 0; i < ids.length; i++) {
      if (kind === 'area') await this.store.areas.updateArea(ids[i], { order: i });
      else if (kind === 'project') await this.store.projects.updateProject(ids[i], { order: i });
      else await this.store.tags.updateTag(ids[i], { order: i });
    }
  }

  /**
   * 悬浮创建卡片（项目/区域/标签统一逻辑）：
   * 弹在侧边栏右缘外，输入框/下拉框等宽；无取消按钮——点卡片外任意处即取消，Enter 创建。
   */
  private closeCreateCard() {
    document.getElementById('things-create-card')?.remove();
  }

  private showCreateCard(element: HTMLElement, kind: 'project' | 'area' | 'tag', anchor: HTMLElement) {
    this.closeCreateCard();

    const meta = {
      project: { title: '新建项目', placeholder: '项目名称' },
      area: { title: '新建区域', placeholder: '区域名称' },
      tag: { title: '新建标签', placeholder: '标签名称' },
    }[kind];

    let fieldsHtml = `<input type="text" class="things-create-card__field" placeholder="${meta.placeholder}" />`;
    if (kind === 'project') {
      const areas = this.store.areas.getAll().sort((a, b) => a.order - b.order);
      const options = ['<option value="">无区域</option>']
        .concat(areas.map(a => `<option value="${a.id}">${a.name}</option>`))
        .join('');
      fieldsHtml += `<select class="things-create-card__field">${options}</select>`;
    }

    const card = document.createElement('div');
    card.className = 'things-create-card';
    card.id = 'things-create-card';
    card.innerHTML = `
      <div class="things-create-card__title">${meta.title}</div>
      ${fieldsHtml}
      <button class="things-create-card__ok">创建</button>
    `;
    document.body.appendChild(card);

    // 定位：侧边栏右缘外 10px，纵向贴近加号按钮，超出视口时收回
    const dockRect = element.getBoundingClientRect();
    const anchorRect = anchor.getBoundingClientRect();
    const cardH = card.offsetHeight;
    let top = anchorRect.top - 4;
    if (top + cardH > window.innerHeight - 8) top = window.innerHeight - cardH - 8;
    card.style.left = `${dockRect.right + 10}px`;
    card.style.top = `${Math.max(8, top)}px`;

    const input = card.querySelector('input')!;
    const select = card.querySelector('select') as HTMLSelectElement | null;
    input.focus();

    const close = () => {
      card.remove();
      document.removeEventListener('mousedown', onOutside);
    };
    const onOutside = (e: MouseEvent) => {
      if (!card.contains(e.target as HTMLElement)) close();
    };
    const submit = async () => {
      const name = input.value.trim();
      if (!name) { input.focus(); return; }
      if (kind === 'project') {
        await this.store.projects.createProject({ name, areaId: select?.value || undefined });
        showMessage(`项目已创建: ${name}`);
      } else if (kind === 'area') {
        await this.store.areas.createArea({ name });
        showMessage(`区域已创建: ${name}`);
      } else {
        await this.store.tags.createTag({ name, color: nextTagColor(this.store.tags.count) });
        showMessage(`标签已创建: ${name}`);
      }
      close();
    };

    card.querySelector('.things-create-card__ok')!.addEventListener('click', submit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
      if (e.key === 'Escape') close();
    });
    // 延迟挂外部监听，避免本次加号点击立即关掉卡片
    setTimeout(() => document.addEventListener('mousedown', onOutside), 0);
  }

  /**
   * 标签直接操作：点色点弹调色板 / 双击名称内联改名 / 按住拖动排序 / × 删除
   */
  private closeTagPalette() {
    document.getElementById('things-palette-pop')?.remove();
  }

  private showTagPalette(row: HTMLElement, tagId: string) {
    this.closeTagPalette();
    const pop = document.createElement('div');
    pop.className = 'things-palette-pop';
    pop.id = 'things-palette-pop';
    pop.innerHTML =
      TAG_PALETTE.map(c => `<span class="things-palette-pop__swatch" data-color="${c}" style="background:${c}" title="${c}"></span>`).join('') +
      `<span class="things-palette-pop__swatch things-palette-pop__none" data-color="" title="无颜色"></span>`;
    document.body.appendChild(pop);

    // 定位：行右侧，纵向居中于该行，超出视口时收回
    const rect = row.getBoundingClientRect();
    const popH = pop.offsetHeight;
    let top = rect.top + rect.height / 2 - popH / 2;
    top = Math.max(8, Math.min(top, window.innerHeight - popH - 8));
    pop.style.left = `${rect.right + 10}px`;
    pop.style.top = `${top}px`;

    pop.addEventListener('click', (e) => {
      const swatch = (e.target as HTMLElement).closest('.things-palette-pop__swatch') as HTMLElement | null;
      if (!swatch) return;
      this.store.tags.updateTag(tagId, { color: swatch.dataset.color || undefined });
      this.closeTagPalette();
    });
    const onOutside = (e: MouseEvent) => {
      if (!pop.contains(e.target as HTMLElement)) {
        this.closeTagPalette();
        document.removeEventListener('mousedown', onOutside);
      }
    };
    setTimeout(() => document.addEventListener('mousedown', onOutside), 0);
  }

  // 双击名称 → 原地变输入框（Enter/失焦保存，Esc 取消）。区域/项目/标签行通用
  private startRowRename(element: HTMLElement, row: HTMLElement, id: string, kind: 'area' | 'project' | 'tag') {
    const label = row.querySelector('.things-nav-row__name');
    const current = kind === 'area' ? this.store.areas.get(id)?.name
      : kind === 'project' ? this.store.projects.get(id)?.name
      : this.store.tags.get(id)?.name;
    if (!label || !current) return;

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'things-nav-row__input';
    input.value = current; // 属性赋值，避免引号注入
    label.replaceWith(input);
    input.focus();
    input.select();

    let done = false;
    const finish = async (save: boolean) => {
      if (done) return;
      done = true;
      const name = input.value.trim();
      if (save && name && name !== current) {
        if (kind === 'area') await this.store.areas.updateArea(id, { name });
        else if (kind === 'project') await this.store.projects.updateProject(id, { name });
        else await this.store.tags.updateTag(id, { name });
        // store 事件会触发对应节重渲染
      } else {
        if (kind === 'area') this.renderAreas(element);
        else if (kind === 'project') this.renderProjects(element);
        else this.renderTags(element);
      }
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') finish(true);
      if (e.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));
  }

  // 行尾 × 删除：首次点击变"确认"，2.5 秒自动撤防；再点才真删。区域/项目/标签行通用
  private bindRowDelete(row: HTMLElement, id: string, kind: 'area' | 'project' | 'tag') {
    row.querySelector('.things-nav-row__del')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const btn = e.currentTarget as HTMLElement;
      if (btn.dataset.confirm) {
        if (kind === 'area') this.deleteAreaFromSidebar(id);
        else if (kind === 'project') this.deleteProjectFromSidebar(id);
        else this.deleteTag(id);
      } else {
        btn.dataset.confirm = '1';
        btn.textContent = '确认';
        btn.classList.add('is-arming');
        setTimeout(() => {
          if (btn.isConnected) {
            delete btn.dataset.confirm;
            btn.textContent = '×';
            btn.classList.remove('is-arming');
          }
        }, 2500);
      }
    });
  }

  private async deleteAreaFromSidebar(id: string) {
    // 级联：区域内项目、直挂区域的任务解除归属（数据保留）
    for (const p of this.store.projects.getAreaProjects(id)) {
      await this.store.projects.updateProject(p.id, { areaId: undefined });
    }
    for (const t of this.store.tasks.getAll()) {
      if (t.areaId === id) {
        await this.store.tasks.updateTask(t.id, { areaId: undefined });
      }
    }
    await this.store.areas.delete(id);
    showMessage('区域已删除');
  }

  private async deleteProjectFromSidebar(id: string) {
    // 项目内任务清除 projectId（回归收件箱）
    for (const t of this.store.tasks.getProjectTasks(id)) {
      await this.store.tasks.updateTask(t.id, { projectId: undefined });
    }
    await this.store.projects.delete(id);
    showMessage('项目已删除');
  }

  private async deleteTag(tagId: string) {
    // 先把该标签从所有任务上摘掉，再删除
    for (const t of this.store.tasks.getAll()) {
      if (t.tags.includes(tagId)) {
        await this.store.tasks.updateTask(t.id, { tags: t.tags.filter(id => id !== tagId) });
      }
    }
    await this.store.tags.delete(tagId);
    showMessage('标签已删除');
    // 若当前停留在该标签视图，导航离开
    if (this.dockElement) {
      this.renderTags(this.dockElement);
    }
  }

  /**
   * 设置选中状态
   */
  private setActive(element: HTMLElement, view: ViewType, id?: string) {
    element.querySelectorAll('.things-nav__item').forEach(el => {
      el.classList.remove('is-active');
      const elView = (el as HTMLElement).dataset.view;
      const elId = (el as HTMLElement).dataset.id;
      if (elView === view && (!id || elId === id)) {
        el.classList.add('is-active');
      }
    });
    // 总览视图（项目/区域/标签）时高亮对应区块头
    element.querySelectorAll('.things-nav__header[data-view]').forEach(el => {
      el.classList.toggle('is-active', (el as HTMLElement).dataset.view === view);
    });
  }

  /**
   * 更新计数
   */
  private updateCounts(element: HTMLElement) {
    const counts: Record<string, number> = {
      inbox: this.store.tasks.getInboxTasks().length,
      today: this.store.tasks.getTodayTasks().length,
      upcoming: this.store.tasks.getUpcomingTasks().length,
      anytime: this.store.tasks.getAnytimeTasks().length,
      someday: this.store.tasks.getSomedayTasks().length,
    };

    element.querySelectorAll('[data-count]').forEach(el => {
      const view = (el as HTMLElement).dataset.count;
      const count = counts[view] || 0;
      el.textContent = count > 0 ? String(count) : '';
    });
  }

  /**
   * 打开标签页（复用已有标签，不重复创建）
   */
  private async openThingsTab(view: ViewType, viewId?: string, searchQuery?: string) {
    console.log("[Things] Opening tab:", view, viewId);

    const title = this.getViewTitle(view, viewId);

    // 如果已有标签页，直接更新内容
    if (this.thingsApp && this.thingsTab) {
      this.thingsApp.$set({
        view: view,
        viewId: viewId || undefined,
        searchQuery: searchQuery || "",
      });
      this.updateTabTitle(title);
      this.updateTabIcon(this.getViewIcon(view));
      // 把标签页切到前台：复用路径只更新内容、不会聚焦标签页，
      // 停留在文档页时点侧边栏会"没反应"。思源 Layout 没有公开的 focusTab，
      // 模拟点击页签头元素（等效于用户直接点该标签页），跨版本可靠
      try {
        const head = this.thingsTab.headElement as HTMLElement;
        if (head && !head.classList.contains("item--focus")) {
          head.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
        }
      } catch {
        /* 静默降级 */
      }
      return;
    }

    // 否则创建新标签页
    const tab = await openTab({
      app: this.app,
      custom: {
        icon: this.getViewIcon(view),
        title: title,
        data: {
          view: view,
          viewId: viewId || null,
          searchQuery: searchQuery || null,
        },
        id: this.name + TAB_TYPE,
      },
    });
    this.thingsTab = tab;
  }

  /**
   * 更新标签页标题（直接操作 DOM，确保对恢复的标签页也生效）
   */
  private updateTabTitle(title: string) {
    if (!this.thingsTab) return;
    // 设置内部属性
    this.thingsTab.title = title;
    if (typeof this.thingsTab.updateTitle === 'function') {
      this.thingsTab.updateTitle(title);
    }
    // 直接更新 headElement 中的标题文本
    const headEl = this.thingsTab.headElement;
    console.log("[Things] updateTabTitle:", title, "headEl:", !!headEl);
    if (headEl) {
      const textEl = headEl.querySelector('.item__text')
        || headEl.querySelector('[class*="text"]')
        || headEl.querySelector('span');
      if (textEl) {
        textEl.textContent = title;
      }
    }
  }

  /**
   * 更新标签页图标（直接操作 DOM）
   */
  private updateTabIcon(iconName: string) {
    if (!this.thingsTab) return;
    this.thingsTab.icon = iconName;
    if (typeof this.thingsTab.setDocIcon === 'function') {
      this.thingsTab.setDocIcon(iconName);
    }
    const headEl = this.thingsTab.headElement;
    if (headEl) {
      const useEl = headEl.querySelector('use');
      if (useEl) {
        useEl.setAttribute('xlink:href', `#${iconName}`);
      }
    }
  }

  /**
   * 获取视图对应的图标名（映射表唯一来源：src/icons/index.ts）
   */
  private getViewIcon(view: ViewType): string {
    return getViewIconId(view);
  }

  /**
   * 获取视图标题
   */
  private getViewTitle(view: ViewType, viewId?: string): string {
    const titles: Record<string, string> = {
      inbox: "收件箱",
      today: "今天",
      upcoming: "计划",
      anytime: "随时",
      someday: "某天",
      log: "日志",
      search: "搜索",
    };

    if (view === "project" && viewId) {
      const p = this.store.projects.get(viewId);
      return p?.name || "项目";
    }
    if (view === "area" && viewId) {
      const a = this.store.areas.get(viewId);
      return a?.name || "区域";
    }
    if (view === "tag" && viewId) {
      const t = this.store.tags.get(viewId);
      return t?.name || "标签";
    }

    return titles[view] || "Things";
  }

  /**
   * 打开搜索对话框
   */
  private openSearchDialog() {
    // 检查是否已经打开
    const existingOverlay = document.querySelector('.things-search-overlay');
    if (existingOverlay) {
      (existingOverlay as HTMLElement).querySelector('input')?.focus();
      return;
    }

    // 获取编辑区域的位置
    const editorArea = document.querySelector('.layout__center') || document.body;
    const editorRect = editorArea.getBoundingClientRect();

    // 创建遮罩层，覆盖整个编辑区域
    const overlay = document.createElement('div');
    overlay.className = 'things-search-overlay';
    overlay.style.cssText = `
      position: fixed;
      top: ${editorRect.top}px;
      left: ${editorRect.left}px;
      width: ${editorRect.width}px;
      height: ${editorRect.height}px;
      z-index: 300;
      display: flex;
      justify-content: center;
      align-items: flex-start;
      padding-top: 60px;
      background: rgba(0, 0, 0, 0.3);
    `;

    const dialog = document.createElement('div');
    dialog.style.cssText = `
      width: 500px;
      max-width: 80%;
      background: var(--b3-theme-surface);
      border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
      overflow: hidden;
    `;

    dialog.innerHTML = `
      <div style="padding: 16px;">
        <div style="display: flex; align-items: center; gap: 8px; background: var(--b3-theme-background); border: 1px solid var(--b3-border-color); border-radius: 8px; padding: 10px 14px;">
          <svg style="width: 18px; height: 18px; color: var(--b3-theme-on-surface-light); flex-shrink: 0;"><use xlink:href="#iconThingsSearch"></use></svg>
          <input type="text" style="flex: 1; border: none; background: transparent; font-size: 15px; outline: none;" id="things-search-input" placeholder="搜索任务..." />
        </div>
        <div id="things-search-results" style="margin-top: 12px; max-height: 400px; overflow-y: auto;"></div>
      </div>
    `;

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    const input = dialog.querySelector("#things-search-input") as HTMLInputElement;
    const results = dialog.querySelector("#things-search-results") as HTMLElement;

    setTimeout(() => input?.focus(), 100);

    // 点击遮罩关闭
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        document.body.removeChild(overlay);
      }
    });

    // ESC 关闭
    overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        document.body.removeChild(overlay);
      }
    });

    let debounceTimer: any;
    input.addEventListener("input", () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const query = input.value.trim();
        if (query) {
          const tasks = this.store.tasks.search(query);
          this.renderSearchResults(results, tasks);
        } else {
          results.innerHTML = "";
        }
      }, 200);
    });
  }

  /**
   * 渲染搜索结果
   */
  private renderSearchResults(container: HTMLElement, tasks: any[]) {
    if (tasks.length === 0) {
      container.innerHTML = '<div style="text-align: center; color: var(--b3-theme-on-surface-light); padding: 20px;">未找到匹配任务</div>';
      return;
    }

    let html = '';
    for (const task of tasks) {
      const statusIcon = task.status === 'done'
        ? '<svg style="width: 14px; height: 14px; color: var(--b3-theme-success, #3fb950); flex-shrink: 0;"><use xlink:href="#iconThingsCheck"></use></svg>'
        : '<svg style="width: 14px; height: 14px; color: var(--b3-theme-on-surface-light); flex-shrink: 0;"><use xlink:href="#iconThingsCircle"></use></svg>';
      html += `
        <div class="things-search-result" data-id="${task.id}" style="display: flex; align-items: center; gap: 8px; padding: 8px; cursor: pointer; border-radius: 4px;">
          <span>${statusIcon}</span>
          <span style="flex: 1;">${task.title}</span>
        </div>
      `;
    }
    container.innerHTML = html;

    // 绑定点击事件
    container.querySelectorAll('.things-search-result').forEach(el => {
      el.addEventListener('click', () => {
        const taskId = (el as HTMLElement).dataset.id;
        const task = this.store.tasks.get(taskId);
        if (task) {
          // 打开任务详情
          console.log("[Things] Open task:", task);
        }
      });
    });
  }

  /**
   * 快速添加任务
   */
  private quickAddTask() {
    const dialog = new Dialog({
      title: "快速添加任务",
      content: `
        <div style="padding: 16px;">
          <input type="text" class="b3-text-field fn__block" id="things-quick-title" placeholder="输入任务标题..." autofocus />
          <div style="margin-top: 12px; text-align: right;">
            <button class="b3-button b3-button--text" id="things-quick-cancel">取消</button>
            <button class="b3-button b3-button--text" id="things-quick-add">添加</button>
          </div>
        </div>
      `,
      width: "400px",
    });

    const input = dialog.element.querySelector("#things-quick-title") as HTMLInputElement;
    const addBtn = dialog.element.querySelector("#things-quick-add") as HTMLButtonElement;
    const cancelBtn = dialog.element.querySelector("#things-quick-cancel") as HTMLButtonElement;

    setTimeout(() => input?.focus(), 100);

    const handleAdd = async () => {
      const title = input.value.trim();
      if (title) {
        await this.store.tasks.createTask({ title });
        showMessage(`任务已添加: ${title}`);
        dialog.destroy();
        if (this.dockElement) {
          this.updateCounts(this.dockElement);
        }
      }
    };

    addBtn.addEventListener("click", handleAdd);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") handleAdd();
      if (e.key === "Escape") dialog.destroy();
    });
    cancelBtn.addEventListener("click", () => dialog.destroy());
  }

  /**
   * 块右键菜单
   */
  private blockIconEvent({ detail }: any) {
    detail.menu.addItem({
      id: "things_create_task",
      iconHTML: "",
      label: "创建任务",
      click: async () => {
        const blocks = detail.blockElements;
        if (blocks.length === 0) return;

        const firstBlock = blocks[0];
        const title = firstBlock.textContent?.trim() || "新任务";
        const blockId = firstBlock.dataset.nodeId;

        await this.store.tasks.createTask({
          title: title.substring(0, 100),
          blockId,
        });

        showMessage(`任务已创建`);
        if (this.dockElement) {
          this.updateCounts(this.dockElement);
        }
      },
    });
  }

  /**
   * 打开设置
   */
  openSetting(): void {
    const dialog = new Dialog({
      title: "Things 设置",
      content: '<div id="things-settings" style="padding: 16px;"></div>',
      width: "500px",
    });

    const settingsEl = dialog.element.querySelector("#things-settings");
    if (settingsEl) {
      // 添加设置项
      const key = "defaultView";
      const el = this.settingUtils.getElement(key);
      if (el) {
        // 更新元素值为当前设置值
        const item = this.settingUtils.settings.get(key);
        if (item && item.setEleVal) {
          item.setEleVal(el, item.value);
        }

        const wrapper = document.createElement("div");
        wrapper.style.marginBottom = "16px";

        // 添加标签
        const label = document.createElement("label");
        label.style.display = "block";
        label.style.marginBottom = "4px";
        label.style.fontWeight = "500";
        label.textContent = "启动时默认显示";
        wrapper.appendChild(label);

        // 添加描述
        const desc = document.createElement("div");
        desc.style.fontSize = "12px";
        desc.style.color = "#666";
        desc.style.marginBottom = "8px";
        desc.textContent = "每次打开思源时默认显示的视图";
        wrapper.appendChild(desc);

        // 添加变化事件监听
        el.addEventListener('change', async () => {
          const value = (el as HTMLSelectElement).value;
          await this.settingUtils.setAndSave(key, value);
          console.log(`[Things] Setting ${key} saved:`, value);
        });

        wrapper.appendChild(el);
        settingsEl.appendChild(wrapper);
      }
    }
  }
}
