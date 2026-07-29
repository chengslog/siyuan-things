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
import { TAG_PALETTE, nextTagColor } from "@/utils/colors";

const STORAGE_NAME = "things-config";
const TAB_TYPE = "things_tab";

export default class ThingsPlugin extends Plugin {
  private store: StoreManager;
  private settingUtils: SettingUtils;
  private dockElement: HTMLElement | null = null;
  private unsubTaskChange: (() => void) | null = null;
  private thingsApp: any = null; // 当前标签页的 Svelte 组件实例
  private thingsTab: any = null; // 当前标签页的 Tab 实例

  async onload() {
    console.log("[Things] Loading plugin...");

    this.store = new StoreManager(this);

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
      description: "每次打开思源时默认显示的视图",
      options: {
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

    // 区域
    html += `
      <div class="things-nav__section">
        <div class="things-nav__header">
          <span class="things-nav__header-label">
            <svg class="things-nav__icon things-nav__icon--sm"><use xlink:href="#iconThingsArea"></use></svg>区域
          </span>
          <span class="things-nav__add" data-add="area" title="新建区域">
            <svg><use xlink:href="#iconThingsAdd"></use></svg>
          </span>
        </div>
        <div id="things-areas"></div>
      </div>
    `;

    // 项目（首行为"全部项目"总览入口）
    html += `
      <div class="things-nav__section">
        <div class="things-nav__header">
          <span class="things-nav__header-label">
            <svg class="things-nav__icon things-nav__icon--sm"><use xlink:href="#iconThingsProject"></use></svg>项目
          </span>
          <span class="things-nav__add" data-add="project" title="新建项目">
            <svg><use xlink:href="#iconThingsAdd"></use></svg>
          </span>
        </div>
        <div id="things-projects"></div>
      </div>
    `;

    // 标签
    html += `
      <div class="things-nav__section">
        <div class="things-nav__header">
          <span class="things-nav__header-label">
            <svg class="things-nav__icon things-nav__icon--sm"><use xlink:href="#iconThingsTag"></use></svg>标签
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

    // 添加项目/区域/标签
    element.querySelectorAll('.things-nav__add').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const type = (el as HTMLElement).dataset.add;
        if (type === 'project') {
          this.addProject(element);
        } else if (type === 'area') {
          this.addArea(element);
        } else if (type === 'tag') {
          this.addTag(element);
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
    // 首行："全部项目"总览入口
    let html = `
      <div class="things-nav__item things-nav__item--sub things-nav__item--all" data-view="projects">
        <svg class="things-nav__icon things-nav__icon--sm"><use xlink:href="#iconThingsProject"></use></svg>
        <span class="things-nav__label">全部项目</span>
      </div>
    `;

    for (const p of projects) {
      html += `
        <div class="things-nav__item things-nav__item--sub" data-view="project" data-id="${p.id}">
          <svg class="things-nav__icon things-nav__icon--sm"><use xlink:href="#iconThingsProject"></use></svg>
          <span class="things-nav__label">${p.name}</span>
        </div>
      `;
    }

    container.innerHTML = html;

    container.querySelectorAll('.things-nav__item').forEach(el => {
      el.addEventListener('click', () => {
        const view = (el as HTMLElement).dataset.view as ViewType;
        const id = (el as HTMLElement).dataset.id;
        this.openThingsTab(view, id);
        this.setActive(element, view, id);
      });
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
        <div class="things-nav__item things-nav__item--sub" data-view="area" data-id="${a.id}">
          <svg class="things-nav__icon things-nav__icon--sm"><use xlink:href="#iconThingsArea"></use></svg>
          <span class="things-nav__label">${a.name}</span>
        </div>
      `;
    }

    if (areas.length === 0) {
      html = '<div class="things-nav__empty">暂无</div>';
    }

    container.innerHTML = html;

    container.querySelectorAll('.things-nav__item').forEach(el => {
      el.addEventListener('click', () => {
        const view = (el as HTMLElement).dataset.view as ViewType;
        const id = (el as HTMLElement).dataset.id;
        this.openThingsTab(view, id);
        this.setActive(element, view, id);
      });
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
        // 有色标签显示色点，无色标签显示标签图标
        const marker = t.color
          ? `<span class="things-nav__tag-dot" style="background: ${t.color}"></span>`
          : `<svg class="things-nav__icon things-nav__icon--sm" style="fill:currentColor"><use xlink:href="#iconThingsTag"></use></svg>`;
        html += `
          <div class="things-nav__item things-nav__item--sub" data-view="tag" data-id="${t.id}"
               style="padding-left: ${12 + depth * 16}px" title="右键管理">
            ${marker}
            <span class="things-nav__label">${t.name}</span>
          </div>
        `;
        const children = this.store.tags.getChildTags(t.id).sort((a, b) => a.order - b.order);
        if (children.length) renderLevel(children, depth + 1);
      }
    };
    renderLevel(roots, 0);

    if (roots.length === 0) {
      html = '<div class="things-nav__empty">暂无（右键可管理）</div>';
    }

    container.innerHTML = html;

    container.querySelectorAll('.things-nav__item').forEach(el => {
      el.addEventListener('click', () => {
        const id = (el as HTMLElement).dataset.id;
        this.openThingsTab('tag' as ViewType, id);
        this.setActive(element, 'tag' as ViewType, id);
      });
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const id = (el as HTMLElement).dataset.id;
        if (id) this.showTagContextMenu(element, id, e.clientX, e.clientY);
      });
    });
    this.bindSectionDragSort(container, 'tag');
  }

  /**
   * 侧边栏分节拖拽排序（仅限同节内：区域/项目/标签各自排序，交换 order 值）
   */
  private bindSectionDragSort(container: Element, kind: 'area' | 'project' | 'tag') {
    container.querySelectorAll('.things-nav__item').forEach(el => {
      const node = el as HTMLElement;
      node.draggable = true;
      node.addEventListener('dragstart', (e) => {
        e.dataTransfer!.setData('text/things-kind', kind);
        e.dataTransfer!.setData('text/things-id', node.dataset.id || '');
        e.dataTransfer!.effectAllowed = 'move';
        node.classList.add('is-dragging-src');
      });
      node.addEventListener('dragend', () => node.classList.remove('is-dragging-src'));
      node.addEventListener('dragover', (e) => e.preventDefault());
      node.addEventListener('drop', (e) => {
        e.preventDefault();
        const srcKind = e.dataTransfer!.getData('text/things-kind');
        const srcId = e.dataTransfer!.getData('text/things-id');
        const targetId = node.dataset.id;
        if (srcKind === kind && srcId && targetId && srcId !== targetId) {
          this.swapEntityOrder(kind, srcId, targetId);
        }
      });
    });
  }

  private async swapEntityOrder(kind: 'area' | 'project' | 'tag', aId: string, bId: string) {
    if (kind === 'area') {
      const a = this.store.areas.get(aId);
      const b = this.store.areas.get(bId);
      if (!a || !b) return;
      const [ao, bo] = a.order === b.order ? [a.order, a.order + 1] : [b.order, a.order];
      await this.store.areas.updateArea(a.id, { order: ao });
      await this.store.areas.updateArea(b.id, { order: bo });
    } else if (kind === 'project') {
      const a = this.store.projects.get(aId);
      const b = this.store.projects.get(bId);
      if (!a || !b) return;
      const [ao, bo] = a.order === b.order ? [a.order, a.order + 1] : [b.order, a.order];
      await this.store.projects.updateProject(a.id, { order: ao });
      await this.store.projects.updateProject(b.id, { order: bo });
    } else {
      const a = this.store.tags.get(aId);
      const b = this.store.tags.get(bId);
      if (!a || !b) return;
      const [ao, bo] = a.order === b.order ? [a.order, a.order + 1] : [b.order, a.order];
      await this.store.tags.updateTag(a.id, { order: ao });
      await this.store.tags.updateTag(b.id, { order: bo });
    }
  }

  /**
   * 添加标签（内联表单，颜色按调色板自动循环）
   */
  private addTag(element: HTMLElement) {
    const container = element.querySelector('#things-tags');
    if (!container || container.parentElement!.querySelector('.things-nav__form')) return;

    const form = document.createElement('div');
    form.className = 'things-nav__form';
    form.innerHTML = `
      <input type="text" class="things-nav__form-input" placeholder="标签名称" />
      <div class="things-nav__form-actions">
        <button class="things-nav__form-ok">创建</button>
        <button class="things-nav__form-cancel">取消</button>
      </div>
    `;
    container.parentElement!.insertBefore(form, container);

    const input = form.querySelector('input')!;
    input.focus();
    const close = () => form.remove();
    const submit = async () => {
      const name = input.value.trim();
      if (!name) { input.focus(); return; }
      await this.store.tags.createTag({ name, color: nextTagColor(this.store.tags.count) });
      close();
      showMessage(`标签已创建: ${name}`);
    };
    form.querySelector('.things-nav__form-ok')!.addEventListener('click', submit);
    form.querySelector('.things-nav__form-cancel')!.addEventListener('click', close);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
      if (e.key === 'Escape') close();
    });
  }

  /**
   * 标签右键管理菜单：重命名 / 换色 / 上移下移 / 删除
   */
  private closeTagContextMenu() {
    document.getElementById('things-ctx-menu')?.remove();
  }

  private showTagContextMenu(element: HTMLElement, tagId: string, x: number, y: number) {
    this.closeTagContextMenu();
    const menu = document.createElement('div');
    menu.className = 'things-ctx-menu';
    menu.id = 'things-ctx-menu';
    menu.style.left = `${Math.min(x, window.innerWidth - 190)}px`;
    menu.style.top = `${Math.min(y, window.innerHeight - 230)}px`;
    // "移动到"候选：除自身与自己的后代外（防环）的全部标签，DFS 顺序带路径名
    const excluded = this.getDescendantTagIds(tagId);
    excluded.add(tagId);
    const candidates: { id: string; label: string }[] = [];
    const buildCandidates = (parentId: string | undefined, prefix: string) => {
      const list = (parentId
        ? this.store.tags.getChildTags(parentId)
        : this.store.tags.getRootTags()
      ).sort((a, b) => a.order - b.order);
      for (const t of list) {
        if (excluded.has(t.id)) continue;
        candidates.push({ id: t.id, label: prefix + t.name });
        buildCandidates(t.id, prefix + t.name + ' / ');
      }
    };
    buildCandidates(undefined, '');

    menu.innerHTML = `
      <div class="things-ctx-item" data-act="rename">重命名</div>
      <div class="things-ctx-item things-ctx-item--palette">更换颜色
        <div class="things-ctx-palette">
          ${TAG_PALETTE.map(c => `<span class="things-ctx-swatch" data-color="${c}" style="background:${c}"></span>`).join('')}
        </div>
      </div>
      <div class="things-ctx-item things-ctx-item--palette">移动到
        <div class="things-ctx-sub">
          <div class="things-ctx-subitem" data-parent="">顶级标签</div>
          ${candidates.map(c => `<div class="things-ctx-subitem" data-parent="${c.id}">${c.label}</div>`).join('')}
        </div>
      </div>
      <div class="things-ctx-item" data-act="up">上移</div>
      <div class="things-ctx-item" data-act="down">下移</div>
      <div class="things-ctx-sep"></div>
      <div class="things-ctx-item is-danger" data-act="delete">删除标签</div>
    `;
    document.body.appendChild(menu);

    menu.addEventListener('click', (e) => {
      const swatch = (e.target as HTMLElement).closest('.things-ctx-swatch') as HTMLElement | null;
      if (swatch) {
        this.store.tags.updateTag(tagId, { color: swatch.dataset.color });
        this.closeTagContextMenu();
        return;
      }
      const subitem = (e.target as HTMLElement).closest('.things-ctx-subitem') as HTMLElement | null;
      if (subitem) {
        const parentId = subitem.dataset.parent || undefined;
        this.store.tags.updateTag(tagId, { parentId });
        this.closeTagContextMenu();
        return;
      }
      const item = (e.target as HTMLElement).closest('.things-ctx-item') as HTMLElement | null;
      if (!item) return;
      const act = item.dataset.act;
      if (act === 'rename') {
        this.closeTagContextMenu();
        this.renameTagInline(element, tagId);
      } else if (act === 'up' || act === 'down') {
        this.moveTag(tagId, act === 'up' ? -1 : 1);
        this.closeTagContextMenu();
      } else if (act === 'delete') {
        if (item.dataset.confirm) {
          this.deleteTag(tagId);
          this.closeTagContextMenu();
        } else {
          item.dataset.confirm = '1';
          item.textContent = '确认删除？（任务将取消该标签）';
        }
      }
    });

    const onDocClick = (ev: MouseEvent) => {
      if (!menu.contains(ev.target as HTMLElement)) {
        this.closeTagContextMenu();
        document.removeEventListener('click', onDocClick);
      }
    };
    setTimeout(() => document.addEventListener('click', onDocClick), 0);
  }

  private getDescendantTagIds(tagId: string): Set<string> {
    const set = new Set<string>();
    const walk = (id: string) => {
      for (const c of this.store.tags.getChildTags(id)) {
        set.add(c.id);
        walk(c.id);
      }
    };
    walk(tagId);
    return set;
  }

  private renameTagInline(element: HTMLElement, tagId: string) {
    const tag = this.store.tags.get(tagId);
    const container = element.querySelector('#things-tags');
    if (!tag || !container || container.parentElement!.querySelector('.things-nav__form')) return;

    const form = document.createElement('div');
    form.className = 'things-nav__form';
    form.innerHTML = `
      <input type="text" class="things-nav__form-input" />
      <div class="things-nav__form-actions">
        <button class="things-nav__form-ok">保存</button>
        <button class="things-nav__form-cancel">取消</button>
      </div>
    `;
    container.parentElement!.insertBefore(form, container);

    const input = form.querySelector('input')!;
    input.value = tag.name; // 赋值而非拼进 HTML，避免引号注入
    input.focus();
    input.select();
    const close = () => form.remove();
    const submit = async () => {
      const name = input.value.trim();
      if (name && name !== tag.name) {
        await this.store.tags.updateTag(tagId, { name });
      }
      close();
    };
    form.querySelector('.things-nav__form-ok')!.addEventListener('click', submit);
    form.querySelector('.things-nav__form-cancel')!.addEventListener('click', close);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
      if (e.key === 'Escape') close();
    });
  }

  private async moveTag(tagId: string, dir: -1 | 1) {
    const tags = this.store.tags.getRootTags().sort((a, b) => a.order - b.order);
    const idx = tags.findIndex(t => t.id === tagId);
    const target = idx + dir;
    if (idx < 0 || target < 0 || target >= tags.length) return;
    const a = tags[idx];
    const b = tags[target];
    await this.store.tags.updateTag(a.id, { order: b.order });
    await this.store.tags.updateTag(b.id, { order: a.order });
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
   * 添加项目（内联表单：名称 + 所属区域，替代 prompt）
   */
  private addProject(element: HTMLElement) {
    const container = element.querySelector('#things-projects');
    if (!container || container.parentElement!.querySelector('.things-nav__form')) return;

    const areas = this.store.areas.getAll().sort((a, b) => a.order - b.order);
    const options = ['<option value="">无区域</option>']
      .concat(areas.map(a => `<option value="${a.id}">${a.name}</option>`))
      .join('');

    const form = document.createElement('div');
    form.className = 'things-nav__form';
    form.innerHTML = `
      <input type="text" class="things-nav__form-input" placeholder="项目名称" />
      <select class="things-nav__form-select">${options}</select>
      <div class="things-nav__form-actions">
        <button class="things-nav__form-ok">创建</button>
        <button class="things-nav__form-cancel">取消</button>
      </div>
    `;
    container.parentElement!.insertBefore(form, container);

    const input = form.querySelector('input')!;
    const select = form.querySelector('select')!;
    input.focus();
    const close = () => form.remove();
    const submit = async () => {
      const name = input.value.trim();
      if (!name) { input.focus(); return; }
      await this.store.projects.createProject({ name, areaId: select.value || undefined });
      close();
      showMessage(`项目已创建: ${name}`);
    };
    form.querySelector('.things-nav__form-ok')!.addEventListener('click', submit);
    form.querySelector('.things-nav__form-cancel')!.addEventListener('click', close);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
      if (e.key === 'Escape') close();
    });
  }

  /**
   * 添加区域（内联表单，替代 prompt）
   */
  private addArea(element: HTMLElement) {
    const container = element.querySelector('#things-areas');
    if (!container || container.parentElement!.querySelector('.things-nav__form')) return;

    const form = document.createElement('div');
    form.className = 'things-nav__form';
    form.innerHTML = `
      <input type="text" class="things-nav__form-input" placeholder="区域名称" />
      <div class="things-nav__form-actions">
        <button class="things-nav__form-ok">创建</button>
        <button class="things-nav__form-cancel">取消</button>
      </div>
    `;
    container.parentElement!.insertBefore(form, container);

    const input = form.querySelector('input')!;
    input.focus();
    const close = () => form.remove();
    const submit = async () => {
      const name = input.value.trim();
      if (!name) { input.focus(); return; }
      await this.store.areas.createArea({ name });
      close();
      showMessage(`区域已创建: ${name}`);
    };
    form.querySelector('.things-nav__form-ok')!.addEventListener('click', submit);
    form.querySelector('.things-nav__form-cancel')!.addEventListener('click', close);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
      if (e.key === 'Escape') close();
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
