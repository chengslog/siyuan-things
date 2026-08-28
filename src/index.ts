import {
  Plugin,
  showMessage,
  Dialog,
  openTab,
  getFrontend,
  getActiveTab,
  expandDocTree,
  fetchSyncPost,
  confirm as siyuanConfirm,
} from "siyuan";

import "./index.scss";
import App from "@/components/App.svelte";
import { StoreManager } from "@/stores";
import type { ViewType, PluginConfig } from "@/types";
import { DEFAULT_CONFIG } from "@/types";
import { SettingUtils } from "./libs/setting-utils";
import { ICON_SPRITE, getViewIconId } from "@/icons";
import { ReminderService } from "@/reminder";
import { TAG_PALETTE, nextTagColor } from "@/utils/colors";
import { renderMarkdown } from "@/utils/markdown";
import {
  ACTIVE_SYNC_DOCK_RESTORE_TTL,
  DOCK_RESTORE_RETRY_DELAYS,
  POST_SYNC_DOCK_RESTORE_TTL,
  createDockRestoreIntent,
  isDockRestoreIntentValid,
} from "@/utils/dockRestore";
import {
  GITHUB_RELEASE_API,
  expectedSha256,
  resolveGitHubUpdate,
  type GitHubRelease,
} from "@/utils/githubUpdater";
import { resetAiChat, type AIComposerContext } from "@/stores/aiChat";

const STORAGE_NAME = "things-config";
const TAB_TYPE = "things_tab";
const SYNC_DOCK_RESTORE_KEY = "siyuan-things:dock-open-before-sync";
const AI_CONTEXT_MIME = "application/x-siyuan-things-context";
const AI_CONTEXT_DROP_EVENT = "things-ai-context-drop";
declare const __PLUGIN_VERSION__: string;
declare const __PLUGIN_CHANGELOG__: string;

export default class ThingsPlugin extends Plugin {
  private store: StoreManager;
  private reminderService: ReminderService;
  private settingUtils: SettingUtils;
  private dockElement: HTMLElement | null = null;
  private thingsDockType = "things_nav";
  private dockRestoreTimers: number[] = [];
  private dockRestoreRevision = 0;
  private syncInProgress = false;
  private layoutResetTimers: number[] = [];
  private pluginMenuObserver: MutationObserver | null = null;
  private unsubTaskChange: (() => void) | null = null;
  private thingsApp: any = null; // 当前标签页的 Svelte 组件实例
  private thingsTab: any = null; // 当前标签页的 Tab 实例
  private thingsTabElement: HTMLElement | null = null; // 当前自定义页签内容节点（布局重建后仍可判断应用是否存活）
  private openingThingsTab: Promise<any> | null = null;
  private currentThingsView: ViewType = "today";
  private currentThingsViewId: string | undefined = undefined;
  private sidebarFollowRevision = 0;
  private githubUpdatePromise: Promise<void> | null = null;
  private handleSyncStart = () => {
    const shouldRestoreDock = this.hasDockRestoreIntent() || this.isThingsDockOpen();
    this.syncInProgress = true;
    this.sidebarFollowRevision += 1;
    this.cancelDockRestoreTimers();
    if (shouldRestoreDock) {
      this.setDockRestoreIntent(ACTIVE_SYNC_DOCK_RESTORE_TTL);
    } else {
      this.clearDockRestoreIntent();
    }
  };
  private handleSyncEnd = async () => {
    try {
      // 同步可能替换插件数据文件，先刷新内存和侧边栏内容。
      await this.store.loadAll();
      if (this.dockElement) this.renderDock(this.dockElement);
    } finally {
      this.syncInProgress = false;
      if (this.hasDockRestoreIntent()) {
        this.setDockRestoreIntent(POST_SYNC_DOCK_RESTORE_TTL);
      }
      this.scheduleDockRestoreAfterSync();
    }
  };
  private handleThingsDockButtonClick = (event: MouseEvent) => {
    const target = event.target as HTMLElement | null;
    const dockButton = target?.closest('.dock__item') as HTMLElement | null;
    const dockType = dockButton?.dataset.type || "";
    // SiYuan may namespace a plugin dock type with the plugin package name.
    if (!dockButton || (dockType !== "things_nav" && !dockType.endsWith("things_nav"))) return;

    const wasDockOpen = dockButton.classList.contains("dock__item--active");
    // 用户主动操作优先于同步前状态，任何待执行的自动恢复都立即取消。
    if (this.hasDockRestoreIntent()) this.clearDockRestoreIntent();
    // 同步期间只让思源处理这次原生 Dock 点击，插件不再聚焦标签页或调整布局。
    if (this.syncInProgress) return;

    // Let SiYuan finish its own dock toggle first. If a Things tab is already
    // open, focus it and preserve its view; otherwise open the configured default.
    setTimeout(async () => {
      const hasLiveTab = this.hasLiveThingsTab();
      const view = hasLiveTab ? this.currentThingsView : this.getConfiguredThingsView();
      const viewId = hasLiveTab ? this.currentThingsViewId : undefined;
      await this.openThingsTab(view, viewId);
      if (this.dockElement) this.setActive(this.dockElement, view, viewId);

      // 每次由关闭状态展开 Things Dock，都基于新的可用空间恢复默认双栏比例。
      // 关闭 Dock 或点击已展开的 Dock 时不重置，避免干扰思源自身的收起动作。
      if (!wasDockOpen) {
        this.layoutResetTimers.forEach((timer) => window.clearTimeout(timer));
        // 交给 App 的 ResizeObserver 在 Dock 展开期间连续维持默认比例；
        // 此处只启动一次，避免多个定时校准造成卡片分段跳动。
        this.layoutResetTimers = [60].map((delay) => window.setTimeout(() => {
          if (!this.isThingsDockOpen()) return;
          window.dispatchEvent(new CustomEvent("things-reset-layout"));
        }, delay));
      }
    }, 0);
  };

  /**
   * 思源不会让自定义标签页触发 switch-protyle，因此点击标签头后从活动 Tab
   * 模型判断是否为 Things，再同步对应 Dock。模型类型是插件 API 的稳定标识，
   * 不依赖标签标题或不同版本中易变化的 data-* 属性。
   */
  private handleThingsTabClick = (event: MouseEvent) => {
    if (this.syncInProgress || this.settingUtils?.get("tabFollowsSidebar") === false) return;
    const target = event.target as HTMLElement | null;
    const head = target?.closest<HTMLElement>(".layout-tab-bar .item");
    if (!head || target?.closest(".item__close")) return;

    // 先让思源完成标签页聚焦，再读取活动 Tab，避免拿到点击前的文档模型。
    window.setTimeout(() => {
      const activeTab = getActiveTab(false) as any;
      const modelType = activeTab?.model?.type || "";
      const isThingsTab = modelType === `${this.name}${TAB_TYPE}`
        || activeTab === this.thingsTab
        || activeTab?.headElement?.dataset?.thingsTab === "true"
        || (!!this.thingsTabElement && activeTab?.panelElement?.contains(this.thingsTabElement));
      if (isThingsTab) {
        this.sidebarFollowRevision += 1;
        this.openThingsDock();
        if (this.dockElement) {
          this.setActive(this.dockElement, this.currentThingsView, this.currentThingsViewId);
        }
        return;
      }

      // 仅响应顶部标签头的直接点击。不要监听全局 switch-protyle，后者也会在
      // Dock 聚焦等流程触发，导致用户刚收起文档 Dock 又被立即打开。
      const protyle = activeTab?.model?.editor?.protyle;
      if (protyle) this.followDocumentTab(protyle);
    }, 0);
  };

  /** 文档标签激活后打开文档树，并展开、选中该标签对应的根文档。 */
  private followDocumentTab(protyle: any) {
    const rootId = protyle?.block?.rootID || protyle?.block?.id;
    if (!rootId || getFrontend().includes("mobile")) return;

    const revision = ++this.sidebarFollowRevision;
    const fileDock = this.findDockModel((type) => type === "file");
    if (!fileDock) return;

    try {
      fileDock.dock.toggleModel(fileDock.type, true);
    } catch (error) {
      console.warn("[Things] Failed to activate document dock:", error);
      return;
    }

    void Promise.resolve().then(() => expandDocTree({ id: rootId, isSetCurrent: true })).catch((error) => {
      // 快速切换到其他标签后，不用旧请求覆盖新的侧边栏状态；这里只记录仍为
      // 当前请求的真实错误。expandDocTree 自身只更新文档树，不再切换 Dock。
      if (revision === this.sidebarFollowRevision) {
        console.warn("[Things] Failed to locate active document:", error);
      }
    });
  }
  private handleThingsNavigate = async (event: Event) => {
    const detail = (event as CustomEvent).detail || {};
    if (!detail.view) return;
    await this.openThingsTab(detail.view, detail.viewId);
    if (this.dockElement) this.setActive(this.dockElement, detail.view, detail.viewId);
  };

  private getConfiguredThingsView(): ViewType {
    const configured = this.settingUtils?.get("defaultView") || "today";
    return configured === "none" ? "today" : configured as ViewType;
  }

  private hasLiveThingsTab(): boolean {
    if (!this.thingsApp) return false;
    // 同步可能只替换 Tab 外壳，使旧 Tab 引用断开；只要自定义内容节点仍在 DOM，
    // Svelte 应用就仍可直接更新，不能因旧 headElement 失效而判定为死页签。
    if (this.thingsTabElement?.isConnected) return true;
    // 自定义页签初始化时内容节点会先被记录，因此即使 Tab parent 尚未就绪，
    // 上面的 isConnected 也足以确认应用可复用。反之若内容和 Tab 都已脱离 DOM，
    // 说明这里只剩同步前的幽灵实例，必须走引用恢复或新建流程。
    if (!this.thingsTab) return false;
    const head = this.thingsTab.headElement as HTMLElement | undefined;
    const element = this.thingsTab.element as HTMLElement | undefined;
    return !!(head?.isConnected || element?.isConnected);
  }

  /**
   * 同步或布局恢复期间，SiYuan 可能暂时重建 Dock/Tab 模型，导致内存引用丢失，
   * 但页签头仍然存在。通过稳定标记和 SiYuan 自定义页签属性兜底查找，
   * 避免把“引用暂时丢失”误判成“页签不存在”。
   */
  private findExistingThingsTabHead(): HTMLElement | null {
    const customId = `${this.name}${TAB_TYPE}`;
    const selectors = [
      '[data-things-tab="true"]',
      `.layout-tab-bar .item[data-type="${TAB_TYPE}"]`,
      `.layout-tab-bar .item[data-type="${customId}"]`,
      `.layout-tab-bar .item[data-id="${customId}"]`,
      `[data-type="${TAB_TYPE}"]`,
      `[data-type="${customId}"]`,
      `[data-id="${customId}"]`,
    ];
    const heads: HTMLElement[] = [];

    document.querySelectorAll<HTMLElement>(selectors.join(",")).forEach((element) => {
      const head = element.matches(".item") ? element : element.closest<HTMLElement>(".item");
      if (head?.isConnected && !heads.includes(head)) heads.push(head);
    });

    return heads.find((head) => head.classList.contains("item--focus")) || heads[0] || null;
  }

  private markThingsTab(tab: any, modelElement?: HTMLElement, app?: any) {
    const head = tab?.headElement as HTMLElement | undefined;
    if (head) head.dataset.thingsTab = "true";
    if (modelElement) {
      this.thingsTabElement = modelElement;
      modelElement.dataset.thingsTabContent = "true";
      (modelElement as any).__thingsPlugin = this;
      (modelElement as any).__thingsTab = tab || null;
      if (app) (modelElement as any).__thingsApp = app;
    }
  }

  /** 尝试从当前插件实例创建的内容节点恢复被布局重建清掉的内存引用。 */
  private recoverThingsTabReferences(): boolean {
    const elements = document.querySelectorAll<HTMLElement>('[data-things-tab-content="true"]');
    for (const element of elements) {
      if (!element.isConnected || (element as any).__thingsPlugin !== this) continue;
      const app = (element as any).__thingsApp;
      if (!app) continue;
      this.thingsApp = app;
      this.thingsTabElement = element;
      this.thingsTab = (element as any).__thingsTab || this.thingsTab;
      return true;
    }
    return false;
  }

  /** 聚焦仍存在的 Things 页签；返回 true 表示不得再创建新页签。 */
  private focusExistingThingsTab(): boolean {
    const head = this.findExistingThingsTabHead();
    if (!head) return false;
    head.dataset.thingsTab = "true";
    if (!head.classList.contains("item--focus")) {
      head.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    }
    return true;
  }

  /** 返回布局重建后的当前页签头，旧 Tab 引用断开时自动回退到 DOM 查找。 */
  private getLiveThingsTabHead(): HTMLElement | null {
    const referencedHead = this.thingsTab?.headElement as HTMLElement | undefined;
    return referencedHead?.isConnected ? referencedHead : this.findExistingThingsTabHead();
  }

  /** Ensure SiYuan does not restore old tabs before Things opens its default view. */
  private async ensureCloseTabsOnStart(): Promise<boolean> {
    const siyuan = (window as any).siyuan;
    const fileTree = siyuan?.config?.fileTree;
    if (!fileTree) return false;
    if (fileTree.closeTabsOnStart === true && fileTree.tabStartupMode === 2) return true;

    const nextFileTree = {
      ...fileTree,
      closeTabsOnStart: true,
      tabStartupMode: 2,
    };
    const response: any = await fetchSyncPost("/api/setting/setFiletree", nextFileTree);
    if (response?.code !== 0) {
      console.error("[Things] Failed to update SiYuan startup behavior:", response);
      return false;
    }
    siyuan.config.fileTree = response.data || nextFileTree;
    return true;
  }

  private async verifyGitHubPackage(blob: Blob, release: GitHubRelease): Promise<void> {
    const asset = release.assets.find((item) => item.name === "package.zip");
    if (!asset || blob.size !== asset.size) {
      throw new Error("下载的 package.zip 大小与 GitHub Release 不一致");
    }
    const expected = expectedSha256(asset);
    if (!expected) return;
    const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()));
    const actual = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    if (actual !== expected) throw new Error("下载的 package.zip SHA-256 校验失败");
  }

  private async performGitHubUpdate(status?: (message: string, error?: boolean) => void): Promise<void> {
    const report = (message: string, error = false) => {
      status?.(message, error);
      console[error ? "error" : "info"](`[Things Update] ${message}`);
    };
    report("正在检查 GitHub 最新版本…");

    const releaseResponse = await fetch(GITHUB_RELEASE_API, {
      headers: { Accept: "application/vnd.github+json" },
      cache: "no-store",
    });
    if (!releaseResponse.ok) throw new Error(`GitHub 版本检查失败（HTTP ${releaseResponse.status}）`);
    const release = await releaseResponse.json() as GitHubRelease;
    const update = resolveGitHubUpdate(release, __PLUGIN_VERSION__);
    if (!update) {
      report(`当前已是最新版本 v${__PLUGIN_VERSION__}`);
      return;
    }

    report(`发现 v${update.version}，正在下载并校验…`);
    showMessage(`Things v${update.version} 正在从 GitHub 下载`, 3500);
    const packageResponse = await fetch(update.asset.browser_download_url, { cache: "no-store" });
    if (!packageResponse.ok) throw new Error(`package.zip 下载失败（HTTP ${packageResponse.status}）`);
    const packageBlob = await packageResponse.blob();
    await this.verifyGitHubPackage(packageBlob, release);

    report(`v${update.version} 校验通过，正在交给思源安装…`);
    const form = new FormData();
    form.append("file", packageBlob, "package.zip");
    form.append("frontend", getFrontend());
    form.append("overwrite", "true");
    const installResponse = await fetch("/api/bazaar/installLocalBazaarPackage", {
      method: "POST",
      body: form,
    });
    if (!installResponse.ok) throw new Error(`思源本地安装接口失败（HTTP ${installResponse.status}）`);
    const result = await installResponse.json();
    if (result?.code !== 0) throw new Error(result?.msg || "思源未能安装 GitHub 更新包");

    report(`已更新到 v${update.version}，Things 正在重新加载`);
    showMessage(`Things 已更新到 v${update.version}，正在重新加载`, 5000);
  }

  private runGitHubUpdate(status?: (message: string, error?: boolean) => void): Promise<void> {
    if (this.githubUpdatePromise) return this.githubUpdatePromise;
    this.githubUpdatePromise = this.performGitHubUpdate(status)
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        status?.(`更新失败：${message}`, true);
        console.error("[Things Update] GitHub update failed:", error);
        showMessage(`Things GitHub 更新失败：${message}`, 6000, "error");
      })
      .finally(() => {
        this.githubUpdatePromise = null;
      });
    return this.githubUpdatePromise;
  }

  async onload() {
    console.log("[Things] Loading plugin...");

    this.store = new StoreManager(this);

    // 提醒通知服务：开始/截止时刻到点后消息+系统通知（每 30s 轮询，已提醒不重复）
    this.reminderService = new ReminderService(this, this.store);
    this.reminderService.start();

    this.addIcons(ICON_SPRITE);

    // 不注册 addTopBar：思源会将带顶栏按钮的插件强制显示为
    // “插件名 → 钉住 / 设置 / 打开”的二级菜单。Things 通过左侧 Dock
    // 进入任务管理；在插件菜单中点击 Things 时应直接调用 openSetting()。
    this.observePluginMenuIcon();

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
        this.element.style.overflow = "hidden";
        this.element.appendChild(container);

        // 挂载 App 外壳：rail + sidebar + main + AI 面板
        const app = new App({
          target: container,
          props: {
            view: view,
            viewId: viewId,
            searchQuery: "",
            store: pluginInstance.store,
            plugin: pluginInstance,
            aiEnabled: pluginInstance.settingUtils?.get("aiEnabled") !== false,
          },
        });

        (this.element as any).__thingsApp = app;
        pluginInstance.markThingsTab((this as any).parent, this.element as HTMLElement, app);
        pluginInstance.thingsApp = app;
        pluginInstance.currentThingsView = view as ViewType;
        pluginInstance.currentThingsViewId = viewId || undefined;
        // this.parent 是实际的 Tab 实例（拥有 updateTitle, headElement 等方法）
        if ((this as any).parent) {
          pluginInstance.thingsTab = (this as any).parent;
          pluginInstance.markThingsTab(pluginInstance.thingsTab, this.element as HTMLElement, app);
          console.log("[Things] Tab captured via parent:", !!pluginInstance.thingsTab);
        }
      },
      destroy() {
        const app = (this.element as any).__thingsApp;
        if (app) {
          app.$destroy();
          (this.element as any).__thingsApp = null;
        }
        // 只有当前标签页（或当前挂载的应用）被销毁时才清空引用。
        // parent 尚未捕获时也要清理，避免残留的应用引用被误判为可复用。
        const tab = (this as any).parent;
        if (pluginInstance.thingsApp === app || pluginInstance.thingsTab === tab) {
          pluginInstance.thingsApp = null;
          pluginInstance.thingsTab = null;
          if (pluginInstance.thingsTabElement === this.element) {
            pluginInstance.thingsTabElement = null;
          }
        }
      },
    });

    // 注册左侧面板（停靠栏展开后显示导航面板，保持原样）
    const dockRegistration = this.addDock({
      config: {
        position: "LeftTop",
        size: { width: 232, height: 0 },
        icon: "iconThings",
        title: `Things v${__PLUGIN_VERSION__}`,
        hotkey: "⌥⌘T",
      },
      data: {},
      type: "things_nav",
      init: (dock) => {
        console.log("[Things] Dock init");
        this.thingsDockType = (dock as any).type || this.thingsDockType;
        this.dockElement = dock.element;
        dock.element.classList.add("things-dock-surface");
        this.renderDock(dock.element);
        // 插件因同步结果重载时，等布局稳定后走同一套有限重试，不在 init 内抢占布局。
        this.scheduleDockRestoreAfterSync();
      },
      destroy() {
        this.dockElement = null;
      }
    });
    this.thingsDockType = (dockRegistration.model as any)?.type || this.thingsDockType;
    document.addEventListener("click", this.handleThingsDockButtonClick, true);
    document.addEventListener("click", this.handleThingsTabClick, true);

    // 注册命令
    this.addCommand({
      langKey: "quickAddTask",
      hotkey: "⇧⌘N",
      callback: () => {
        this.quickAddTask();
      },
    });

    this.eventBus.on("click-blockicon", this.blockIconEvent.bind(this));
    this.eventBus.on("sync-start", this.handleSyncStart);
    this.eventBus.on("sync-end", this.handleSyncEnd);
    this.eventBus.on("sync-fail", this.handleSyncEnd);

    // 面板级导航（如项目删除后跳回收件箱）：组件 dispatch window 事件，外壳执行切换
    window.addEventListener("things-navigate", this.handleThingsNavigate);

    // 项目/区域变更 → 侧边栏实时刷新（改名、删除、完成、暂停都同步）
    const refreshDock = () => {
      if (this.dockElement) {
        this.renderProjects(this.dockElement);
        this.renderAreas(this.dockElement);
        this.renderTags(this.dockElement);
        this.updateCounts(this.dockElement);
        this.restoreDockActiveState(this.dockElement);
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
      value: "none",
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

    this.settingUtils.addItem({
      key: "tabFollowsSidebar",
      value: true,
      type: "checkbox",
      title: "标签页联动侧边栏",
      description: "切换文档标签时打开并定位文档树；切换 Things 标签时打开 Things 侧边栏。关闭后保持思源原生的独立状态。",
    });

    this.settingUtils.addItem({
      key: "githubAutoUpdate",
      value: false,
      type: "checkbox",
      title: "从 GitHub 自动更新",
      description: "启动时直接检查 Things 官方 GitHub 仓库，发现新的正式版后下载、校验并交给思源安装，不经过思源集市下载通道。",
    });

    // AI 服务配置
    this.settingUtils.addItem({
      key: "aiEnabled",
      value: true,
      type: "checkbox",
      title: "启用 AI 功能",
      description: "关闭后隐藏 AI 面板和所有 AI 入口，已有 AI 配置会保留",
    });

    this.settingUtils.addItem({
      key: "aiMode",
      value: "siyuan",
      type: "select",
      title: "AI 服务来源",
      description: "选择复用思源内置 AI 设置，或自定义 API 配置",
      options: {
        siyuan: "复用思源设置",
        custom: "自定义 AI 设置",
      },
    });

    this.settingUtils.addItem({
      key: "aiApiEndpoint",
      value: "https://api.openai.com/v1/chat/completions",
      type: "textinput",
      title: "AI API 端点",
      description: "OpenAI 兼容的 API 端点地址（仅在「自定义 AI 设置」时生效）",
    });

    this.settingUtils.addItem({
      key: "aiApiKey",
      value: "",
      type: "textinput",
      title: "AI API Key",
      description: "AI 服务的 API 密钥（仅在「自定义 AI 设置」时生效）",
    });

    this.settingUtils.addItem({
      key: "aiModel",
      value: "gpt-4o-mini",
      type: "textinput",
      title: "AI 模型",
      description: "使用的 AI 模型名称（仅在「自定义 AI 设置」时生效）",
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
    this.thingsApp?.$set?.({ aiEnabled: this.settingUtils.get("aiEnabled") !== false });
    window.dispatchEvent(new Event("things-ai-config-change"));
    console.log("[Things] Data loaded, tasks:", this.store.tasks.count);

    if (this.dockElement) {
      this.updateCounts(this.dockElement);
    }
    this.scheduleDockRestoreAfterSync();
    if (this.settingUtils.get("githubAutoUpdate") === true) {
      window.setTimeout(() => void this.runGitHubUpdate(), 1200);
    }

    {
      // 获取默认视图设置
      const defaultView = this.settingUtils.get("defaultView") || "today";

      // 选了"不打开" → 不干预思源启动逻辑（不打开 Things 标签页）
      if (defaultView === "none") {
        console.log("[Things] defaultView=none，跳过启动时打开");
        return;
      }

      // A concrete startup view requires SiYuan not to restore arbitrary old
      // tabs. Keep the global setting in sync and use one creation path only.
      await this.ensureCloseTabsOnStart();
      setTimeout(() => {
        this.openThingsTab(defaultView as ViewType);
        if (this.dockElement) this.setActive(this.dockElement, defaultView as ViewType);
      }, 300);
    }
  }

  async onunload() {
    console.log("[Things] Plugin unloaded");
    this.pluginMenuObserver?.disconnect();
    this.pluginMenuObserver = null;
    document.removeEventListener("click", this.handleThingsDockButtonClick, true);
    document.removeEventListener("click", this.handleThingsTabClick, true);
    window.removeEventListener("things-navigate", this.handleThingsNavigate);
    this.eventBus.off("sync-start", this.handleSyncStart);
    this.eventBus.off("sync-end", this.handleSyncEnd);
    this.eventBus.off("sync-fail", this.handleSyncEnd);
    // 不清除带有效期的恢复意图：同步结果导致插件重载时由新实例接手。
    this.cancelDockRestoreTimers();
    this.layoutResetTimers.forEach((timer) => window.clearTimeout(timer));
    this.layoutResetTimers = [];

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
   * 思源会把“无顶栏按钮但提供设置”的插件直接列入插件菜单，但图标固定为齿轮。
   * 菜单没有开放自定义图标参数，因此在菜单节点生成后仅替换 Things 自身的图标。
   */
  private observePluginMenuIcon(): void {
    this.pluginMenuObserver?.disconnect();
    const selector = `.b3-menu__item[data-id="${this.name}"]`;

    const applyIcon = (root: ParentNode) => {
      const items = root instanceof HTMLElement && root.matches(selector)
        ? [root]
        : Array.from(root.querySelectorAll<HTMLElement>(selector));
      items.forEach((item) => {
        const label = item.querySelector<HTMLElement>(":scope > .b3-menu__label")?.textContent?.trim();
        if (label !== this.displayName.trim()) return;

        const use = item.querySelector<SVGUseElement>(":scope > .b3-menu__icon use");
        if (!use) return;
        use.setAttribute("href", "#iconThings");
        use.setAttribute("xlink:href", "#iconThings");
      });
    };

    applyIcon(document);
    this.pluginMenuObserver = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node instanceof HTMLElement) applyIcon(node);
        });
      });
    });
    this.pluginMenuObserver.observe(document.body, { childList: true, subtree: true });
  }

  private getThingsDockButton(): HTMLElement | null {
    return Array.from(document.querySelectorAll<HTMLElement>(".dock__item")).find((item) => {
      const type = item.dataset.type || "";
      return type === this.thingsDockType || type === "things_nav" || type.endsWith("things_nav");
    }) || null;
  }

  /** Dock 布局属于全局 SiYuan 运行时，不在插件 App 实例上。 */
  private getRuntimeLayout(): any {
    return (window as any).siyuan?.layout || (this.app as any)?.layout;
  }

  /** 查找实际承载指定模型的 Dock，兼容用户把内置 Dock 移到右侧。 */
  private findDockModel(matches: (type: string) => boolean): { dock: any; type: string } | null {
    const layout = this.getRuntimeLayout();
    const docks = [layout?.leftDock, layout?.rightDock, layout?.bottomDock].filter(Boolean);
    for (const dock of docks) {
      const type = Object.keys(dock.data || {}).find(matches);
      if (type) return { dock, type };
    }
    return null;
  }

  private isThingsDockOpen(): boolean {
    const button = this.getThingsDockButton();
    if (!button?.classList.contains("dock__item--active")) return false;

    // 同步期间可能只保留按钮的 active class，却先把左侧布局宽度清零。
    // 此时视觉上已经收缩，不能仅凭按钮状态误判为仍处于展开状态。
    const leftDock = this.getRuntimeLayout()?.leftDock;
    const layoutElement = leftDock?.layout?.element as HTMLElement | undefined;
    if (!layoutElement?.isConnected || layoutElement.classList.contains("fn__none")) return false;
    if (layoutElement.style.width === "0px" || layoutElement.clientWidth <= 1) return false;
    if (leftDock?.pin === false && layoutElement.style.opacity === "0") return false;
    return true;
  }

  /** 激活 Things Dock；同步恢复时才强制恢复浮动 Dock 的可见性。 */
  private openThingsDock(forceRestoreVisibility = false): boolean {
    const button = this.getThingsDockButton();
    if (!button) return false;
    const found = this.findDockModel((type) =>
      type === this.thingsDockType || type === "things_nav" || type.endsWith("things_nav") || type.includes(this.name)
    );
    if (!found) return false;
    try {
      // 同步后恢复只改运行时布局，不把同步过程中的瞬态状态写回 uiLayout。
      const shouldSaveLayout = !this.hasDockRestoreIntent();
      found.dock.toggleModel(found.type, true, false, false, shouldSaveLayout);
      if (forceRestoreVisibility) found.dock.showDock(true);
      return this.isThingsDockOpen();
    } catch (error) {
      console.warn("[Things] Failed to restore dock after sync:", error);
      return false;
    }
  }

  private restoreThingsDockIfNeeded(): boolean {
    if (this.syncInProgress || !this.hasDockRestoreIntent()) return false;
    const restored = this.isThingsDockOpen() || this.openThingsDock(true);
    if (restored && this.dockElement) {
      this.setActive(this.dockElement, this.currentThingsView, this.currentThingsViewId);
    }
    return restored;
  }

  private setDockRestoreIntent(ttl: number) {
    sessionStorage.setItem(SYNC_DOCK_RESTORE_KEY, createDockRestoreIntent(Date.now(), ttl));
  }

  private hasDockRestoreIntent(): boolean {
    const raw = sessionStorage.getItem(SYNC_DOCK_RESTORE_KEY);
    const valid = isDockRestoreIntentValid(raw, Date.now());
    if (!valid && raw) sessionStorage.removeItem(SYNC_DOCK_RESTORE_KEY);
    return valid;
  }

  private cancelDockRestoreTimers() {
    this.dockRestoreRevision += 1;
    this.dockRestoreTimers.forEach((timer) => window.clearTimeout(timer));
    this.dockRestoreTimers = [];
  }

  private clearDockRestoreIntent() {
    sessionStorage.removeItem(SYNC_DOCK_RESTORE_KEY);
    this.cancelDockRestoreTimers();
  }

  /** 同步结束且布局稳定后最多尝试三次；同步过程中绝不操作 Dock。 */
  private scheduleDockRestoreAfterSync() {
    this.cancelDockRestoreTimers();
    if (this.syncInProgress || !this.hasDockRestoreIntent()) return;

    const revision = this.dockRestoreRevision;
    this.dockRestoreTimers = DOCK_RESTORE_RETRY_DELAYS.map((delay, index) => window.setTimeout(() => {
      if (revision !== this.dockRestoreRevision || this.syncInProgress || !this.hasDockRestoreIntent()) return;
      if (this.restoreThingsDockIfNeeded()) {
        this.clearDockRestoreIntent();
        return;
      }
      if (index === DOCK_RESTORE_RETRY_DELAYS.length - 1) {
        this.clearDockRestoreIntent();
      }
    }, delay));
  }

  /**
   * 渲染停靠栏
   */
  private renderDock(element: HTMLElement) {
    // 主导航按语义分组（组间以空行分隔，不用分割线）：
    // 快速查找 | 收件箱 | 今天、计划、随时、某天 | 日志
    const navGroups: { view: ViewType; icon: string; label: string }[][] = [
      [{ view: "search" as ViewType, icon: "iconThingsSearch", label: "快速查找" }],
      [{ view: "inbox" as ViewType, icon: "iconThingsInbox", label: "收件箱" }],
      [
        { view: "today" as ViewType, icon: "iconThingsToday", label: "今天" },
        { view: "upcoming" as ViewType, icon: "iconThingsCalendar", label: "计划" },
        { view: "anytime" as ViewType, icon: "iconThingsAnytime", label: "随时" },
        { view: "someday" as ViewType, icon: "iconThingsSomeday", label: "某天" },
      ],
      [{ view: "log" as ViewType, icon: "iconThingsLog", label: "日志" }],
    ];

    let html = `<div class="things-nav"><div class="things-nav__scroll">`;

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

    html += `
      </div>
      <div class="things-nav__footer">
        <button type="button" class="things-nav__version" data-footer-action="changelog" title="查看更新日志">
          Things v${__PLUGIN_VERSION__}
        </button>
      </div>
    </div>`;
    element.innerHTML = html;

    this.bindEvents(element);
    this.renderProjects(element);
    this.renderAreas(element);
    this.renderTags(element);
    this.updateCounts(element);

    this.restoreDockActiveState(element);
  }

  /**
   * 绑定事件
   */
  private bindEvents(element: HTMLElement) {
    // 主要导航点击
    element.querySelectorAll('.things-nav__item').forEach(el => {
      const node = el as HTMLElement;
      const view = node.dataset.view as ViewType;
      const label = node.querySelector('.things-nav__label')?.textContent?.trim();
      if (view && view !== 'search' && label) this.bindAiContextDrag(node, { kind: 'view', value: view, label });
      el.addEventListener('click', () => {
        const view = node.dataset.view as ViewType;
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

    element.querySelector('[data-footer-action="changelog"]')?.addEventListener('click', () => {
      this.openChangelogDialog();
    });
  }

  private openChangelogDialog() {
    new Dialog({
      title: `Things v${__PLUGIN_VERSION__} 更新日志`,
      content: `<div class="b3-typography" style="padding: 20px; max-height: 70vh; overflow: auto;">${renderMarkdown(__PLUGIN_CHANGELOG__)}</div>`,
      width: "680px",
    });
  }

  /**
   * 渲染项目列表
   */
  private renderProjects(element: HTMLElement) {
    const container = element.querySelector('#things-projects');
    if (!container) return;

    const projects = this.store.projects.getActiveProjects().sort((a, b) => a.order - b.order);
    let html = '';

    for (const p of projects) {
      html += `
        <div class="things-nav__item things-nav__item--sub things-nav-row" data-view="project" data-id="${p.id}" title="单击打开 · 拖动排序或添加到 AI">
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
      const project = this.store.projects.get(id);
      if (project) node.dataset.aiContext = JSON.stringify({ kind: 'project', id, value: project.name, label: `项目 · ${project.name}` });
    });
    this.bindSectionDragSort(container, 'project');
  }

  /**
   * 渲染区域列表
   */
  private renderAreas(element: HTMLElement) {
    const container = element.querySelector('#things-areas');
    if (!container) return;

    const areas = this.store.areas.getAll().sort((a, b) => a.order - b.order);
    let html = '';

    for (const a of areas) {
      html += `
        <div class="things-nav__item things-nav__item--sub things-nav-row" data-view="area" data-id="${a.id}" title="单击打开 · 拖动排序或添加到 AI">
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
      const area = this.store.areas.get(id);
      if (area) node.dataset.aiContext = JSON.stringify({ kind: 'area', id, value: area.name, label: `区域 · ${area.name}` });
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
               style="padding-left: ${12 + depth * 16}px" title="单击打开 · 拖动排序或添加到 AI">
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
      const tag = this.store.tags.get(id);
      if (tag) row.dataset.aiContext = JSON.stringify({ kind: 'tag', id, value: tag.name, label: `标签 · ${tag.name}` });
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
    // 子标签虽然不参与层级排序，也允许从整行拖到 AI 输入框。
    const dragSel = kind === 'tag' ? '.things-tag-row' : rowSel;
    container.querySelectorAll(dragSel).forEach(el => {
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
        this.startSectionDrag(ev, node, container as HTMLElement, kind, rowSel, node.matches(rowSel));
      });
    });
  }

  private bindAiContextDrag(source: HTMLElement, context: AIComposerContext, row: HTMLElement = source) {
    row.dataset.aiContext = JSON.stringify(context);
    source.addEventListener('click', (event) => event.stopPropagation());

    // 项目/区域/标签由整行自定义拖动统一处理；主导航没有排序行为，继续使用原生拖放。
    if (source !== row) return;
    source.draggable = true;
    if (!source.title.includes('拖到 AI 输入框')) {
      source.title = `${source.title ? `${source.title} · ` : ''}拖到 AI 输入框作为新建任务设定`;
    }
    source.addEventListener('dragstart', (event) => {
      const transfer = event.dataTransfer;
      if (!transfer) return;
      transfer.effectAllowed = 'copy';
      transfer.setData(AI_CONTEXT_MIME, JSON.stringify(context));
      transfer.setData('text/plain', context.label);
      row.classList.add('is-ai-context-dragging');
    });
    source.addEventListener('dragend', () => row.classList.remove('is-ai-context-dragging'));
  }

  private startSectionDrag(startEv: MouseEvent, node: HTMLElement, container: HTMLElement, kind: 'area' | 'project' | 'tag', rowSel: string, canSort: boolean) {
    const startX = startEv.clientX;
    const startY = startEv.clientY;
    const rect = node.getBoundingClientRect();
    const offsetX = startX - rect.left;
    const offsetY = startY - rect.top;
    const itemH = rect.height;
    let dragging = false;
    let ghost: HTMLElement | null = null;
    let indicator: HTMLElement | null = null;
    let aiDropTarget: HTMLElement | null = null;
    let insertIdx = -1;

    const rows = () => Array.from(container.querySelectorAll(rowSel)) as HTMLElement[];
    const others0 = rows().filter(r => r !== node);
    // 起始中心位置用于落点判定（不受挤占位移影响，避免反馈抖动）
    const centers0 = others0.map(r => {
      const rc = r.getBoundingClientRect();
      return rc.top + rc.height / 2;
    });

    const layout = (pointerY: number) => {
      if (!canSort) return;
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
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 5) return; // 阈值：区分点击与拖动
        dragging = true;
        ghost = node.cloneNode(true) as HTMLElement;
        ghost.classList.add('things-drag-ghost');
        ghost.style.width = `${rect.width}px`;
        document.body.appendChild(ghost);
        node.style.visibility = 'hidden';
        node.classList.add('is-ai-context-dragging');
        if (canSort) {
          indicator = document.createElement('div');
          indicator.className = 'things-drag-indicator';
          container.appendChild(indicator);
        }
      }
      ghost!.style.left = `${ev.clientX - offsetX}px`;
      ghost!.style.top = `${ev.clientY - offsetY}px`;
      const pointerTarget = document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null;
      const nextAiTarget = pointerTarget?.closest('.ai-chat__input-container') as HTMLElement | null;
      if (nextAiTarget !== aiDropTarget) {
        aiDropTarget?.classList.remove('is-context-drop');
        aiDropTarget = nextAiTarget;
        aiDropTarget?.classList.add('is-context-drop');
      }

      const inSourceList = !!pointerTarget && container.contains(pointerTarget);
      ghost!.classList.toggle('is-ai-context-target', !!aiDropTarget);
      if (indicator) indicator.style.display = inSourceList && !aiDropTarget ? '' : 'none';

      if (inSourceList && !aiDropTarget) {
        layout(ev.clientY);
      } else {
        insertIdx = -1;
        rows().forEach(r => { r.style.transform = ''; });
      }
    };

    const onUp = async (ev: MouseEvent) => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      if (!dragging) return;
      node.dataset.justDragged = '1'; // 抑制本次拖拽后的 click（避免误触导航）
      // 松手在 AI/空白处时不会产生该行的 click，下一轮清掉标记，避免吞掉之后的正常单击。
      window.setTimeout(() => {
        if (node.dataset.justDragged === '1') delete node.dataset.justDragged;
      }, 0);

      const pointerTarget = document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null;
      const droppedOnAi = pointerTarget?.closest('.ai-chat__input-container') as HTMLElement | null;
      const droppedInSourceList = !!pointerTarget && container.contains(pointerTarget);
      if (droppedInSourceList && canSort) layout(ev.clientY);

      // 清理视觉状态
      aiDropTarget?.classList.remove('is-context-drop');
      ghost?.remove();
      indicator?.remove();
      node.style.visibility = '';
      node.classList.remove('is-ai-context-dragging');
      rows().forEach(r => { r.style.transform = ''; });

      if (droppedOnAi && node.dataset.aiContext) {
        try {
          const context = JSON.parse(node.dataset.aiContext) as AIComposerContext;
          window.dispatchEvent(new CustomEvent(AI_CONTEXT_DROP_EVENT, { detail: { context } }));
        } catch {
          // 数据来自本插件渲染的侧边栏；解析失败时取消本次拖动。
        }
        return;
      }

      if (!droppedInSourceList || !canSort || insertIdx < 0) return;

      // 仅在原列表内松手时按新序列重写 order。
      const others = rows().filter(r => r !== node);
      const newIds: string[] = [];
      others.forEach((r, i) => {
        if (i === insertIdx) newIds.push(node.dataset.id!);
        newIds.push(r.dataset.id!);
      });
      if (insertIdx >= others.length) newIds.push(node.dataset.id!);
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
    // TagStore 在数据层统一清理所有任务引用，任何删除入口都不会留下失效标签 ID。
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
    const isEntityView = view === 'project' || view === 'area' || view === 'tag';
    element.querySelectorAll('.things-nav__item').forEach(el => {
      el.classList.remove('is-active');
      const elView = (el as HTMLElement).dataset.view;
      const elId = (el as HTMLElement).dataset.id;
      // 项目/区域/标签必须同时匹配实体 ID。同步恢复时即使 ID 暂时缺失，
      // 也不能把同 view 的所有行一起激活。
      const matches = elView === view && (isEntityView ? !!id && elId === id : !id || elId === id);
      if (matches) {
        el.classList.add('is-active');
      }
    });
    // 总览视图（项目/区域/标签）时高亮对应区块头
    element.querySelectorAll('.things-nav__header[data-view]').forEach(el => {
      el.classList.toggle('is-active', (el as HTMLElement).dataset.view === view);
    });
  }

  private restoreDockActiveState(element: HTMLElement) {
    const hasLiveTab = this.hasLiveThingsTab();
    const view = hasLiveTab ? this.currentThingsView : this.getConfiguredThingsView();
    const viewId = hasLiveTab ? this.currentThingsViewId : undefined;
    this.setActive(element, view, viewId);
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
    this.currentThingsView = view;
    this.currentThingsViewId = viewId || undefined;

    const title = this.getViewTitle(view, viewId);

    // 如果已有界面，直接更新内容。自定义页签 init 时应用可能先于 Tab 引用就绪，
    // 这段窗口期同样必须复用，否则区域内点击项目会额外创建一个项目页签。
    if (this.hasLiveThingsTab()) {
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
        const head = this.getLiveThingsTabHead();
        if (head && !head.classList.contains("item--focus")) {
          head.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
        }
      } catch {
        /* 静默降级 */
      }
      return;
    }

    // 同步后的布局恢复可能只留下页签 DOM，而暂时丢失 Custom/Tab 内存引用。
    // 先尝试从稳定内容标记恢复；若只能找到页签头，也只聚焦它并等待 SiYuan
    // 恢复对应模型，绝不能在已有页签旁再创建一个重复页签。
    if (this.recoverThingsTabReferences() && this.hasLiveThingsTab()) {
      return this.openThingsTab(view, viewId, searchQuery);
    }
    if (this.focusExistingThingsTab()) {
      // 聚焦页签会触发 SiYuan 恢复自定义模型；短暂等待后若引用已回来，
      // 再把本次目标视图同步进去。无论恢复是否完成，当前调用都不会进入
      // openTab 创建分支，因此不会生成重复页签。
      window.setTimeout(() => {
        this.recoverThingsTabReferences();
        if (this.hasLiveThingsTab()) void this.openThingsTab(view, viewId, searchQuery);
      }, 80);
      return;
    }

    this.thingsApp = null;
    this.thingsTab = null;
    this.thingsTabElement = null;

    // Serialize creation: startup, Dock clicks and sidebar clicks can arrive in
    // the same frame, but only one custom tab may be created.
    if (this.openingThingsTab) {
      await this.openingThingsTab;
      if (this.hasLiveThingsTab()) return this.openThingsTab(view, viewId, searchQuery);
      return;
    }
    this.openingThingsTab = openTab({
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
    try {
      this.thingsTab = await this.openingThingsTab;
      this.markThingsTab(this.thingsTab);
    } finally {
      this.openingThingsTab = null;
    }
  }

  /**
   * 更新标签页标题（直接操作 DOM，确保对恢复的标签页也生效）
   */
  private updateTabTitle(title: string) {
    const referencedHead = this.thingsTab?.headElement as HTMLElement | undefined;
    // 只调用仍连接在当前布局中的 Tab 模型；同步前的旧模型可能保留方法，
    // 但调用后会操作已销毁节点并中断本次导航。
    if (this.thingsTab && referencedHead?.isConnected) this.thingsTab.title = title;
    if (referencedHead?.isConnected && typeof this.thingsTab?.updateTitle === 'function') {
      this.thingsTab.updateTitle(title);
    }
    // 直接更新 headElement 中的标题文本
    const headEl = this.getLiveThingsTabHead();
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
    const referencedHead = this.thingsTab?.headElement as HTMLElement | undefined;
    if (this.thingsTab && referencedHead?.isConnected) this.thingsTab.icon = iconName;
    if (referencedHead?.isConnected && typeof this.thingsTab?.setDocIcon === 'function') {
      this.thingsTab.setDocIcon(iconName);
    }
    const headEl = this.getLiveThingsTabHead();
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
      content: '<div id="things-settings" style="padding: 16px 16px 20px;"></div>',
      width: "600px",
    });

    const settingsEl = dialog.element.querySelector("#things-settings");
    if (settingsEl) {
      const generalSection = document.createElement("section");
      generalSection.className = "things-settings__section things-settings__section--first things-settings__category";
      const generalTitle = document.createElement("div");
      generalTitle.className = "things-settings__category-title";
      generalTitle.textContent = "通用设置";
      generalSection.appendChild(generalTitle);
      settingsEl.appendChild(generalSection);

      // 添加默认视图设置
      const defaultViewKey = "defaultView";
      const defaultViewEl = this.settingUtils.getElement(defaultViewKey);
      if (defaultViewEl) {
        const item = this.settingUtils.settings.get(defaultViewKey);
        if (item && item.setEleVal) {
          item.setEleVal(defaultViewEl, item.value);
        }

        const wrapper = document.createElement("div");
        wrapper.className = "things-settings__category-item";

        const label = document.createElement("label");
        label.className = "things-settings__section-title";
        label.textContent = "启动时默认显示";
        wrapper.appendChild(label);

        const desc = document.createElement("div");
        desc.className = "things-settings__section-desc";
        desc.textContent = "选择具体页面后，Things 会将思源的“启动行为”自动设为“关闭所有页签”，以确保启动时只打开这里设置的页面。选择“不打开”不会修改思源设置。";
        wrapper.appendChild(desc);

        const startupStatus = document.createElement("div");
        startupStatus.style.display = "none";
        startupStatus.style.fontSize = "12px";
        startupStatus.style.marginTop = "8px";

        defaultViewEl.addEventListener('change', async () => {
          const value = (defaultViewEl as HTMLSelectElement).value;
          await this.settingUtils.setAndSave(defaultViewKey, value);
          if (value !== "none") {
            const updated = await this.ensureCloseTabsOnStart();
            startupStatus.style.display = "block";
            startupStatus.style.color = updated
              ? "var(--b3-theme-primary)"
              : "var(--b3-theme-error)";
            startupStatus.textContent = updated
              ? "已自动将思源启动行为设为“关闭所有页签”"
              : "未能修改思源启动行为，请在思源设置中手动选择“关闭所有页签”";
          } else {
            startupStatus.style.display = "block";
            startupStatus.style.color = "var(--b3-theme-on-surface-light)";
            startupStatus.textContent = "已设为启动时不打开 Things；思源的启动行为保持不变";
          }
          console.log(`[Things] Setting ${defaultViewKey} saved:`, value);
        });

        defaultViewEl.classList.add("things-settings__section-control");
        wrapper.appendChild(defaultViewEl);
        wrapper.appendChild(startupStatus);
        generalSection.appendChild(wrapper);
      }

      // 标签页与侧边栏联动开关
      const tabFollowKey = "tabFollowsSidebar";
      const tabFollowEl = this.settingUtils.getElement(tabFollowKey) as HTMLInputElement | undefined;
      if (tabFollowEl) {
        const item = this.settingUtils.settings.get(tabFollowKey);
        item?.setEleVal?.(tabFollowEl, item.value);

        const section = document.createElement("section");
        section.className = "things-settings__category-item";
        const wrapper = document.createElement("div");
        wrapper.className = "things-settings__ai-toggle";

        const copy = document.createElement("div");
        copy.className = "things-settings__ai-toggle-copy";
        const label = document.createElement("div");
        label.className = "things-settings__ai-toggle-title";
        label.textContent = item?.title || "标签页联动侧边栏";
        const desc = document.createElement("div");
        desc.className = "things-settings__ai-toggle-desc";
        desc.textContent = item?.description || "切换标签页时自动切换并定位对应侧边栏";
        copy.append(label, desc);
        wrapper.append(copy, tabFollowEl);
        section.appendChild(wrapper);
        generalSection.appendChild(section);

        tabFollowEl.addEventListener("change", async () => {
          await this.settingUtils.setAndSave(tabFollowKey, tabFollowEl.checked);
        });
      }

      // GitHub 直连更新放在“维护与支持”，手动检查使用开关旁的图标按钮。
      let githubUpdateSection: HTMLElement | null = null;
      const githubUpdateKey = "githubAutoUpdate";
      const githubUpdateEl = this.settingUtils.getElement(githubUpdateKey) as HTMLInputElement | undefined;
      if (githubUpdateEl) {
        const item = this.settingUtils.settings.get(githubUpdateKey);
        item?.setEleVal?.(githubUpdateEl, item.value);

        const section = document.createElement("div");
        section.className = "things-settings__maintenance-toggle";
        const wrapper = document.createElement("div");
        wrapper.className = "things-settings__ai-toggle";
        const copy = document.createElement("div");
        copy.className = "things-settings__ai-toggle-copy";
        const label = document.createElement("div");
        label.className = "things-settings__ai-toggle-title";
        label.textContent = item?.title || "从 GitHub 自动更新";
        const desc = document.createElement("div");
        desc.className = "things-settings__ai-toggle-desc";
        desc.textContent = item?.description || "绕过思源集市，直接从 Things 官方仓库获取正式版";
        const updateDescription = desc.textContent;
        copy.append(label, desc);

        const checkButton = document.createElement("button");
        checkButton.type = "button";
        checkButton.className = "things-settings__update-button";
        checkButton.title = "检查更新";
        checkButton.setAttribute("aria-label", "检查更新");
        checkButton.innerHTML = '<svg aria-hidden="true"><use xlink:href="#iconRefresh"></use></svg>';
        const controls = document.createElement("div");
        controls.className = "things-settings__toggle-controls";
        controls.append(checkButton, githubUpdateEl);
        wrapper.append(copy, controls);
        section.appendChild(wrapper);
        const setStatus = (message: string, error = false) => {
          desc.textContent = message || updateDescription;
          desc.classList.toggle("is-error", error);
        };
        const check = async () => {
          checkButton.disabled = true;
          await this.runGitHubUpdate(setStatus);
          if (checkButton.isConnected) checkButton.disabled = false;
        };
        checkButton.addEventListener("click", () => void check());
        githubUpdateEl.addEventListener("change", async () => {
          await this.settingUtils.setAndSave(githubUpdateKey, githubUpdateEl.checked);
          setStatus(githubUpdateEl.checked ? "已启用，将在每次启动时检查一次" : "已关闭自动检查");
          if (githubUpdateEl.checked) await check();
        });
        githubUpdateSection = section;
      }

      // AI 功能总开关
      const aiEnabledKey = "aiEnabled";
      const aiEnabledEl = this.settingUtils.getElement(aiEnabledKey) as HTMLInputElement | undefined;
      const aiSection = document.createElement("section");
      aiSection.className = "things-settings__section things-settings__ai-section things-settings__category";
      const aiSectionTitle = document.createElement("div");
      aiSectionTitle.className = "things-settings__category-title";
      aiSectionTitle.textContent = "AI 设置";
      aiSection.appendChild(aiSectionTitle);
      const aiConfigSection = document.createElement("div");
      aiConfigSection.id = "things-ai-config-section";
      aiConfigSection.className = "things-settings__ai-config";
      settingsEl.appendChild(aiSection);
      if (aiEnabledEl) {
        const item = this.settingUtils.settings.get(aiEnabledKey);
        item?.setEleVal?.(aiEnabledEl, item.value);

        const wrapper = document.createElement("div");
        wrapper.className = "things-settings__ai-toggle";

        const copy = document.createElement("div");
        copy.className = "things-settings__ai-toggle-copy";
        const label = document.createElement("div");
        label.className = "things-settings__ai-toggle-title";
        label.textContent = "启用 AI 功能";
        const desc = document.createElement("div");
        desc.className = "things-settings__ai-toggle-desc";
        desc.textContent = "关闭后隐藏 AI 面板和所有 AI 入口，已有配置会保留";
        copy.append(label, desc);
        wrapper.append(copy, aiEnabledEl);
        aiSection.appendChild(wrapper);

        aiEnabledEl.setAttribute("aria-controls", aiConfigSection.id);
        aiEnabledEl.setAttribute("aria-expanded", String(aiEnabledEl.checked));
        aiConfigSection.hidden = !aiEnabledEl.checked;
        aiEnabledEl.addEventListener("change", async () => {
          const enabled = aiEnabledEl.checked;
          await this.settingUtils.setAndSave(aiEnabledKey, enabled);
          aiConfigSection.hidden = !enabled;
          aiEnabledEl.setAttribute("aria-expanded", String(enabled));
          this.thingsApp?.$set?.({ aiEnabled: enabled });
        });
      }

      // 添加 AI 模式选择
      const aiModeKey = "aiMode";
      const aiModeEl = this.settingUtils.getElement(aiModeKey);
      if (aiModeEl) {
        const item = this.settingUtils.settings.get(aiModeKey);
        if (item && item.setEleVal) {
          item.setEleVal(aiModeEl, item.value);
        }

        const wrapper = document.createElement("div");
        wrapper.className = "things-settings__ai-field";

        const label = document.createElement("label");
        label.style.display = "block";
        label.style.marginBottom = "4px";
        label.style.fontWeight = "500";
        label.textContent = "AI 服务来源";
        wrapper.appendChild(label);

        const desc = document.createElement("div");
        desc.className = "things-settings__ai-field-desc";
        desc.textContent = "选择复用思源内置 AI 设置，或自定义 API 配置";
        wrapper.appendChild(desc);

        wrapper.appendChild(aiModeEl);
        aiConfigSection.appendChild(wrapper);

        // 自定义配置容器
        const customConfigContainer = document.createElement("div");
        customConfigContainer.id = "custom-ai-config";
        customConfigContainer.className = "things-settings__ai-custom";
        customConfigContainer.hidden = (aiModeEl as HTMLSelectElement).value !== "custom";

        // 添加自定义配置项
        const customKeys = ["aiApiEndpoint", "aiApiKey", "aiModel"];
        for (const key of customKeys) {
          const el = this.settingUtils.getElement(key);
          if (el) {
            const item = this.settingUtils.settings.get(key);
            if (item && item.setEleVal) {
              item.setEleVal(el, item.value);
            }

            const itemWrapper = document.createElement("div");
            itemWrapper.className = "things-settings__ai-custom-field";

            const itemLabel = document.createElement("label");
            itemLabel.style.display = "block";
            itemLabel.style.marginBottom = "4px";
            itemLabel.style.fontWeight = "500";
            itemLabel.style.fontSize = "13px";
            itemLabel.textContent = item?.title || key;
            itemWrapper.appendChild(itemLabel);

            if (item?.description) {
              const itemDesc = document.createElement("div");
              itemDesc.style.fontSize = "12px";
              itemDesc.style.color = "var(--b3-theme-on-surface-light)";
              itemDesc.style.marginBottom = "6px";
              itemDesc.textContent = item.description;
              itemWrapper.appendChild(itemDesc);
            }

            const eventType = (el instanceof HTMLSelectElement) ? 'change' : 'input';
            el.addEventListener(eventType, async () => {
              const value = (el as HTMLInputElement | HTMLSelectElement).value;
              await this.settingUtils.setAndSave(key, value);
              window.dispatchEvent(new Event("things-ai-config-change"));
              console.log(`[Things] Setting ${key} saved:`, value);
            });

            itemWrapper.appendChild(el);
            customConfigContainer.appendChild(itemWrapper);
          }
        }

        aiConfigSection.appendChild(customConfigContainer);

        // 监听 AI 模式变化
        aiModeEl.addEventListener('change', async () => {
          const value = (aiModeEl as HTMLSelectElement).value;
          await this.settingUtils.setAndSave(aiModeKey, value);
          window.dispatchEvent(new Event("things-ai-config-change"));
          console.log(`[Things] Setting ${aiModeKey} saved:`, value);
          
          // 显示/隐藏自定义配置
          customConfigContainer.hidden = value !== "custom";
        });
      }
      aiSection.appendChild(aiConfigSection);

      const maintenanceSection = document.createElement("section");
      maintenanceSection.className = "things-settings__section things-settings__maintenance";
      const maintenanceTitle = document.createElement("div");
      maintenanceTitle.className = "things-settings__maintenance-title";
      maintenanceTitle.textContent = "维护与支持";
      maintenanceSection.appendChild(maintenanceTitle);
      if (githubUpdateSection) maintenanceSection.appendChild(githubUpdateSection);

      const maintenanceActions = document.createElement("div");
      maintenanceActions.className = "things-settings__footer-actions";

      const resetButton = document.createElement("button");
      resetButton.className = "things-settings__action-button things-settings__action-button--danger";
      resetButton.textContent = "重置 Things";
      resetButton.title = "清空 Things 的任务、分类、提醒、AI 会话和设置";
      resetButton.addEventListener("click", () => {
        const taskStats = this.store.tasks.getStorageStats();
        const entityCount = this.store.projects.count + this.store.areas.count + this.store.tags.count;
        siyuanConfirm(
          "清空 Things 数据",
          `即将永久清空 ${taskStats.active + taskStats.archived} 条任务记录和 ${entityCount} 个项目、区域或标签，并恢复默认设置。<br><br>此操作不会删除思源笔记，但无法撤销。`,
          async (confirmDialog) => {
            confirmDialog.destroy();
            resetButton.disabled = true;
            resetButton.textContent = "正在重置…";
            try {
              await this.store.clearAll();
              await this.reminderService.clearHistory();
              resetAiChat();
              await this.settingUtils.resetToDefaults();
              this.thingsApp?.$set?.({ aiEnabled: true });
              window.dispatchEvent(new Event("things-ai-config-change"));
              if (this.dockElement) {
                this.renderDock(this.dockElement);
                this.setActive(this.dockElement, "today");
              }
              await this.openThingsTab("today");
              dialog.destroy();
              showMessage("Things 已清空并恢复默认设置", 4000);
            } catch (error) {
              console.error("[Things] Reset failed:", error);
              resetButton.disabled = false;
              resetButton.textContent = "重置 Things";
              showMessage("重置失败，请查看开发者控制台", 5000, "error");
            }
          },
        );
      });
      const bugLink = document.createElement("a");
      bugLink.href = "https://github.com/chengslog/siyuan-things/issues/new?labels=bug&title=%5BBug%5D%20";
      bugLink.target = "_blank";
      bugLink.rel = "noopener noreferrer";
      bugLink.className = "things-settings__action-button";
      bugLink.textContent = "Bug 反馈";
      maintenanceActions.appendChild(bugLink);
      maintenanceActions.appendChild(resetButton);
      settingsEl.appendChild(maintenanceSection);
      settingsEl.appendChild(maintenanceActions);

    }
  }
}
