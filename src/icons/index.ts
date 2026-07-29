/**
 * 图标系统入口：雪碧图 + 语义映射表 + 品牌色。
 *
 * 规则：
 * - 视图 → 图标只认 VIEW_ICON_MAP 这一张表（侧边栏/标签页/dock/页面标题/空状态共用），
 *   不要再在各组件里各写一份。
 * - symbol id 不可改名（恢复的标签页缓存了图标名）。
 */
export { ICON_SPRITE } from "./sprite";
export { default as Icon } from "./Icon.svelte";

/** 视图 → 雪碧图 symbol id */
export const VIEW_ICON_MAP: Record<string, string> = {
  inbox: "iconThingsInbox",
  today: "iconThingsToday",
  upcoming: "iconThingsCalendar",
  anytime: "iconThingsAnytime",
  someday: "iconThingsSomeday",
  log: "iconThingsLog",
  projects: "iconThingsProject",
  project: "iconThingsProject",
  area: "iconThingsArea",
  search: "iconThingsSearch",
};

export const DEFAULT_VIEW_ICON = "iconThings";

export function getViewIconId(view: string): string {
  return VIEW_ICON_MAP[view] || DEFAULT_VIEW_ICON;
}

/** 品牌色：今天=黄 / 今晚=蓝（设计稿要求，emoji 无法实现，故用 SVG） */
export const ICON_COLORS = {
  today: "#FFB900",
  tonight: "#5A7FE0",
} as const;
