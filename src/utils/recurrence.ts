import type { RepeatRule } from "@/types";

export const REPEAT_RULE_LABELS: Record<RepeatRule, string> = {
  daily: "每天",
  weekdays: "每个工作日",
  weekly: "每周",
  monthly: "每月",
  yearly: "每年",
};

export function normalizeRepeatRule(value: unknown): RepeatRule | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  const aliases: Record<string, RepeatRule> = {
    daily: "daily", "每天": "daily", "每日": "daily",
    weekdays: "weekdays", weekday: "weekdays", "工作日": "weekdays", "每个工作日": "weekdays",
    weekly: "weekly", "每周": "weekly", "每星期": "weekly",
    monthly: "monthly", "每月": "monthly",
    yearly: "yearly", annual: "yearly", "每年": "yearly",
  };
  return aliases[normalized];
}

/** Give an undated repeating task a concrete first occurrence. */
export function initialRepeatStartDate(
  rule: RepeatRule | undefined,
  startDate: number | undefined,
  deadline: number | undefined,
  now = Date.now(),
): number | undefined {
  if (startDate || deadline || !rule) return startDate;
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  return today.getTime();
}

export function nextRepeatTimestamp(timestamp: number, rule: RepeatRule): number {
  const source = new Date(timestamp);
  const next = new Date(timestamp);
  if (rule === "daily") next.setDate(next.getDate() + 1);
  if (rule === "weekly") next.setDate(next.getDate() + 7);
  if (rule === "weekdays") {
    do next.setDate(next.getDate() + 1);
    while (next.getDay() === 0 || next.getDay() === 6);
  }
  if (rule === "monthly") {
    const targetDay = source.getDate();
    next.setDate(1);
    next.setMonth(next.getMonth() + 1);
    const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
    next.setDate(Math.min(targetDay, lastDay));
  }
  if (rule === "yearly") {
    const month = source.getMonth();
    const day = source.getDate();
    next.setDate(1);
    next.setFullYear(next.getFullYear() + 1);
    next.setMonth(month);
    const lastDay = new Date(next.getFullYear(), month + 1, 0).getDate();
    next.setDate(Math.min(day, lastDay));
  }
  return next.getTime();
}
