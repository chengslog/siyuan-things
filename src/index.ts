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

const STORAGE_NAME = "things-config";
const TAB_TYPE = "things_tab";

export default class ThingsPlugin extends Plugin {
  private store: StoreManager;
  private settingUtils: SettingUtils;
  private dockElement: HTMLElement | null = null;

  async onload() {
    console.log("[Things] Loading plugin...");

    this.store = new StoreManager(this);

    this.addIcons(`
      <symbol id="iconThings" viewBox="0 0 32 32">
        <path d="M16 2C8.268 2 2 8.268 2 16s6.268 14 14 14 14-6.268 14-14S23.732 2 16 2zm0 2c6.627 0 12 5.373 12 12s-5.373 12-12 12S4 22.627 4 16 9.373 4 16 4zm-2 6l-4 4 1.41 1.41L14 12.83l6.59 6.59L22 18l-8-8z"/>
      </symbol>
      <symbol id="iconInbox" viewBox="0 0 32 32">
        <path d="M26 4H6a2 2 0 00-2 2v18a2 2 0 002 2h20a2 2 0 002-2V6a2 2 0 00-2-2zm0 2v8h-6.41L18 15.59V14h-4v1.59L12.41 14H6V6h20zm-2 18H8v-4h4.59L14 21.41V20h4v1.41L19.41 20H24v4z"/>
      </symbol>
      <symbol id="iconToday" viewBox="0 0 32 32">
        <path d="M8 4v2h2V4h12v2h2V4h2v24H6V4h2zm-2 6v16h20V10H6zm4 3h4v4h-4v-4z"/>
      </symbol>
      <symbol id="iconCalendar" viewBox="0 0 32 32">
        <path d="M8 2v4H6a2 2 0 00-2 2v18a2 2 0 002 2h20a2 2 0 002-2V8a2 2 0 00-2-2h-2V2h-4v4H12V2H8zm-2 8h20v16H6V10zm2 3v2h4v-2H8zm6 0v2h4v-2h-4zm6 0v2h4v-2h-4z"/>
      </symbol>
      <symbol id="iconAnytime" viewBox="0 0 32 32">
        <path d="M16 2C8.268 2 2 8.268 2 16s6.268 14 14 14 14-6.268 14-14S23.732 2 16 2zm0 2c6.627 0 12 5.373 12 12s-5.373 12-12 12S4 22.627 4 16 9.373 4 16 4zm-1 6v8l6 4 1-1.73-5-3V12h-2z"/>
      </symbol>
      <symbol id="iconSomeday" viewBox="0 0 32 32">
        <path d="M16 2C8.268 2 2 8.268 2 16s6.268 14 14 14 14-6.268 14-14S23.732 2 16 2zm0 2c6.627 0 12 5.373 12 12s-5.373 12-12 12S4 22.627 4 16 9.373 4 16 4zm-4 8a2 2 0 110 4 2 2 0 010-4zm8 0a2 2 0 110 4 2 2 0 010-4zm8 0a2 2 0 110 4 2 2 0 010-4z"/>
      </symbol>
      <symbol id="iconLog" viewBox="0 0 32 32">
        <path d="M6 4v24h20V8h-8V4H6zm2 2h6v4h10v16H8V6zm4 6v2h8v-2h-8zm0 4v2h8v-2h-8zm0 4v2h5v-2h-5z"/>
      </symbol>
      <symbol id="iconArea" viewBox="0 0 32 32">
        <path d="M4 4v24h24V4H4zm2 2h20v20H6V6zm4 4v4h4v-4h-4zm6 0v4h4v-4h-4zm-6 6v4h4v-4h-4zm6 0v4h4v-4h-4z"/>
      </symbol>
      <symbol id="iconProject" viewBox="0 0 32 32">
        <path d="M6 4v24h20V8h-8V4H6zm2 2h6v4h10v16H8V6zm4 6v2h8v-2h-8zm0 4v2h8v-2h-8zm0 4v2h5v-2h-5z"/>
      </symbol>
      <symbol id="iconAdd" viewBox="0 0 32 32">
        <path d="M16 4v12h12v4H16v12h-4V20H0v-4h12V4h4z"/>
      </symbol>
      <symbol id="iconSearch" viewBox="0 0 32 32">
        <path d="M22 20.59l4.59 4.59L24.59 27 20 22.41V22a10 10 0 110-20 10 10 0 110 20v.59zM14 22a8 8 0 100-16 8 8 0 000 16z"/>
      </symbol>
      <symbol id="iconCheck" viewBox="0 0 32 32">
        <path d="M13.667 21.333l-6.667-6.667 1.88-1.88 4.787 4.787 9.56-9.56 1.88 1.88-11.44 11.44z"/>
      </symbol>
      <symbol id="iconCircle" viewBox="0 0 32 32">
        <circle cx="16" cy="16" r="12" fill="none" stroke="currentColor" stroke-width="2"/>
      </symbol>
    `);

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

        this.element.__thingsApp = app;
      },
      destroy() {
        if (this.element.__thingsApp) {
          this.element.__thingsApp.$destroy();
          this.element.__thingsApp = null;
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

    this.settingUtils = new SettingUtils({
      plugin: this,
      name: STORAGE_NAME,
    });

    this.settingUtils.addItem({
      key: "showCompletedTasks",
      value: false,
      type: "checkbox",
      title: "显示已完成任务",
    });

    this.settingUtils.addItem({
      key: "showCanceledTasks",
      value: false,
      type: "checkbox",
      title: "显示已取消任务",
    });

    console.log("[Things] Plugin loaded");
  }

  async onLayoutReady() {
    await this.store.loadAll();
    await this.settingUtils.load();
    console.log("[Things] Data loaded, tasks:", this.store.tasks.count);

    if (this.dockElement) {
      this.updateCounts(this.dockElement);
    }
  }

  async onunload() {
    console.log("[Things] Plugin unloaded");
  }

  /**
   * 渲染停靠栏
   */
  private renderDock(element: HTMLElement) {
    const navItems = [
      { view: "inbox" as ViewType, icon: "iconInbox", label: "收件箱", emoji: "📥" },
      { view: "today" as ViewType, icon: "", label: "今天", emoji: "⭐" },
      { view: "upcoming" as ViewType, icon: "iconCalendar", label: "计划", emoji: "📅" },
      { view: "anytime" as ViewType, icon: "iconAnytime", label: "随时", emoji: "⏰" },
      { view: "someday" as ViewType, icon: "iconSomeday", label: "某天", emoji: "💭" },
      { view: "log" as ViewType, icon: "iconLog", label: "日志", emoji: "📋" },
    ];

    let html = `<div class="things-nav">`;

    // 搜索框
    html += `
      <div class="things-nav__search">
        <input type="text" class="things-nav__search-input" placeholder="快速查找" />
      </div>
    `;

    // 主要导航
    for (const item of navItems) {
      const iconHtml = item.emoji
        ? `<span class="things-nav__emoji">${item.emoji}</span>`
        : `<svg class="things-nav__icon"><use xlink:href="#${item.icon}"></use></svg>`;
      html += `
        <div class="things-nav__item" data-view="${item.view}">
          ${iconHtml}
          <span class="things-nav__label">${item.label}</span>
          <span class="things-nav__count" data-count="${item.view}"></span>
        </div>
      `;
    }

    // 间隔线
    html += `<div class="things-nav__sep"></div>`;

    // 区域
    html += `
      <div class="things-nav__section">
        <div class="things-nav__header">
          <span>区域</span>
          <span class="things-nav__add" data-add="area">+</span>
        </div>
        <div id="things-areas"></div>
      </div>
    `;

    // 间隔线
    html += `<div class="things-nav__sep"></div>`;

    // 项目
    html += `
      <div class="things-nav__section">
        <div class="things-nav__header">
          <span>项目</span>
          <span class="things-nav__add" data-add="project">+</span>
        </div>
        <div id="things-projects"></div>
      </div>
    `;

    html += `</div>`;
    element.innerHTML = html;

    this.bindEvents(element);
    this.renderProjects(element);
    this.renderAreas(element);
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

    // 添加项目/区域
    element.querySelectorAll('.things-nav__add').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const type = (el as HTMLElement).dataset.add;
        if (type === 'project') {
          this.addProject(element);
        } else if (type === 'area') {
          this.addArea(element);
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
        <div class="things-nav__item things-nav__item--sub" data-view="project" data-id="${p.id}">
          <span class="things-nav__label">${p.name}</span>
        </div>
      `;
    }

    if (projects.length === 0) {
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
   * 打开标签页
   */
  private openThingsTab(view: ViewType, viewId?: string, searchQuery?: string) {
    console.log("[Things] Opening tab:", view, viewId);

    openTab({
      app: this.app,
      custom: {
        icon: "iconThings",
        title: this.getViewTitle(view, viewId),
        data: {
          view: view,
          viewId: viewId || null,
          searchQuery: searchQuery || null,
        },
        id: this.name + TAB_TYPE,
      },
    });
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
          <svg style="width: 18px; height: 18px; color: var(--b3-theme-on-surface-light); flex-shrink: 0;"><use xlink:href="#iconSearch"></use></svg>
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
      const statusIcon = task.status === 'done' ? '✅' : '☐';
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
   * 添加项目
   */
  private async addProject(element: HTMLElement) {
    const name = prompt('输入项目名称:');
    if (name) {
      await this.store.projects.createProject({ name });
      this.renderProjects(element);
      showMessage(`项目已创建: ${name}`);
    }
  }

  /**
   * 添加区域
   */
  private async addArea(element: HTMLElement) {
    const name = prompt('输入区域名称:');
    if (name) {
      await this.store.areas.createArea({ name });
      this.renderAreas(element);
      showMessage(`区域已创建: ${name}`);
    }
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
      ["showCompletedTasks", "showCanceledTasks"].forEach(key => {
        const el = this.settingUtils.getElement(key);
        if (el) {
          const wrapper = document.createElement("div");
          wrapper.style.marginBottom = "16px";
          wrapper.appendChild(el);
          settingsEl.appendChild(wrapper);
        }
      });
    }
  }
}
