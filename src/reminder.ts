import type { Plugin } from "siyuan";
import { showMessage } from "siyuan";
import type { StoreManager } from "@/stores";

const STORAGE_FILE = "things-reminders.json";
const CHECK_INTERVAL = 30_000; // 30s 轮询一次，提醒延迟在 30s 内

/** 时间戳是否带具体时刻（时/分非零）——只有设置了时刻的才触发提醒 */
function hasTime(ts: number): boolean {
  const d = new Date(ts);
  return d.getHours() !== 0 || d.getMinutes() !== 0;
}

/**
 * 提醒通知服务：
 * - 开始日期提醒（DatePicker 设置的时刻）与截止日期提醒（DeadlinePicker 设置的时刻）分开判定
 * - 到点后：思源内消息 + 系统通知（Electron Notification，未授权时静默跳过）
 * - 每个提醒点（任务 id + 时间戳）只通知一次，已提醒记录持久化，重启不重复打扰
 */
export class ReminderService {
  private plugin: Plugin;
  private store: StoreManager;
  private timer: any = null;
  // key：`s:{taskId}:{ts}` 开始提醒 / `d:{taskId}:{ts}` 截止提醒 → 已提醒的时间戳
  private notified = new Map<string, number>();

  constructor(plugin: Plugin, store: StoreManager) {
    this.plugin = plugin;
    this.store = store;
  }

  async start() {
    try {
      const saved = await this.plugin.loadData(STORAGE_FILE);
      if (saved && typeof saved === "object") {
        this.notified = new Map(Object.entries(saved as Record<string, number>));
      }
    } catch {
      /* 无历史数据 */
    }
    // 首查延迟 5s（等 store 加载完），之后每 30s 轮询
    setTimeout(() => this.check(), 5_000);
    this.timer = setInterval(() => this.check(), CHECK_INTERVAL);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async clearHistory() {
    this.notified.clear();
    await this.plugin.saveData(STORAGE_FILE, {});
  }

  private async check() {
    const now = Date.now();
    for (const t of this.store.tasks.getAll()) {
      if (t.status !== "todo" || t.someday) continue;
      // 开始日期提醒
      if (t.startDate && hasTime(t.startDate) && t.startDate <= now) {
        await this.fire(`s:${t.id}:${t.startDate}`, t.startDate, `开始时间到：${t.title}`);
      }
      // 截止日期提醒
      if (t.deadline && hasTime(t.deadline) && t.deadline <= now) {
        await this.fire(`d:${t.id}:${t.deadline}`, t.deadline, `⚑ 截止时间到：${t.title}`);
      }
    }
  }

  private async fire(key: string, ts: number, message: string) {
    if (this.notified.get(key) === ts) return; // 该提醒点已通知过
    this.notified.set(key, ts);
    try {
      await this.plugin.saveData(STORAGE_FILE, Object.fromEntries(this.notified));
    } catch {
      /* 持久化失败不影响本次提醒 */
    }
    showMessage(message, 7000);
    // 系统通知：已授权直接发；未决定则申请一次；拒绝/不支持则静默
    try {
      if ("Notification" in window) {
        if (Notification.permission === "granted") {
          new Notification("Things 提醒", { body: message });
        } else if (Notification.permission !== "denied") {
          Notification.requestPermission();
        }
      }
    } catch {
      /* 环境不支持系统通知 */
    }
  }
}
