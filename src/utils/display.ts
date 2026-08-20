/**
 * 日期/截止/提醒的展示辅助（图标名 + 文案）。
 * 图标名是雪碧图 symbol id（见 src/icons/sprite.ts），由使用方渲染为 <Icon>。
 * 此前 TaskCard / DatePicker 各有一份返回 emoji 的重复实现，现合并于此。
 */
import { isTodayDate, isTomorrowDate, formatDateFull } from "@/utils/calendar";
import { ICON_COLORS } from "@/icons";

export interface IconLabel {
  icon: string;      // symbol id
  text: string;
  color?: string;    // 图标显式颜色；缺省由使用方 CSS color 决定
}

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

/**
 * 开始日期胶囊：某天→与侧边栏同款图标；今晚(18:00)→蓝月；今天→黄星；
 * 明天→计划日历+"明天"；其他→计划日历+完整日期。
 * 今天视图特判：视图内任务统一以今天语义展示。
 */
export function getStartDateDisplay(startDate?: number, someday?: boolean, view?: string): IconLabel | null {
  if (someday) return { icon: "iconThingsSomeday", text: "" };
  if (!startDate) return null;

  const d = new Date(startDate);
  // “今晚”不应只认 18:00 整；AI 或用户指定 19:30、20:00 等晚间时刻时也显示月亮语义。
  const isTonight = isTodayDate(startDate) && d.getHours() >= 18;

  if (isTonight) return { icon: "iconThingsMoonFilled", text: "", color: ICON_COLORS.tonight };
  if (isTodayDate(startDate)) return { icon: "iconThingsStarFilled", text: "", color: ICON_COLORS.today };
  if (view === "today") return { icon: "iconThingsStarFilled", text: "", color: ICON_COLORS.today };
  if (isTomorrowDate(startDate)) return { icon: "iconThingsCalendar", text: "明天" };
  return { icon: "iconThingsCalendar", text: formatDateFull(startDate) };
}

/** 截止日期胶囊：红旗 + 今天/明天/完整日期（红色由使用方 CSS 控制） */
export function getDeadlineDisplay(deadline?: number): IconLabel | null {
  if (!deadline) return null;
  if (isTodayDate(deadline)) return { icon: "iconThingsFlag", text: "今天" };
  if (isTomorrowDate(deadline)) return { icon: "iconThingsFlag", text: "明天" };
  return { icon: "iconThingsFlag", text: formatDateFull(deadline) };
}

/** 提醒胶囊：仅设置了具体时间（非 00:00）时出现，铃铛 + HH:mm */
export function getReminderDisplay(timestamp?: number): IconLabel | null {
  if (!timestamp) return null;
  const d = new Date(timestamp);
  if (d.getHours() === 0 && d.getMinutes() === 0) return null;
  return { icon: "iconThingsBell", text: `${pad2(d.getHours())}:${pad2(d.getMinutes())}` };
}
