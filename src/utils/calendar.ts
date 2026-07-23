/**
 * 日历工具函数
 */

export interface CalendarDay {
  day: number;
  month: number;
  year: number;
  isCurrentMonth: boolean;
}

/**
 * 生成日历数据（6行7列，周一开头）
 */
export function generateCalendar(year: number, month: number): CalendarDay[] {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const daysInMonth = lastDay.getDate();

  // 周一开始 (0=周日, 1=周一, ..., 6=周六)
  let startWeekday = firstDay.getDay();
  if (startWeekday === 0) startWeekday = 7;
  startWeekday = startWeekday - 1;

  const days: CalendarDay[] = [];

  // 上个月的日期
  const prevMonthLastDay = new Date(year, month, 0).getDate();
  for (let i = startWeekday - 1; i >= 0; i--) {
    days.push({
      day: prevMonthLastDay - i,
      month: month - 1,
      year: month === 0 ? year - 1 : year,
      isCurrentMonth: false,
    });
  }

  // 本月的日期
  for (let i = 1; i <= daysInMonth; i++) {
    days.push({
      day: i,
      month,
      year,
      isCurrentMonth: true,
    });
  }

  // 下个月的日期 (补齐到42天，6行)
  const remaining = 42 - days.length;
  for (let i = 1; i <= remaining; i++) {
    days.push({
      day: i,
      month: month + 1,
      year: month === 11 ? year + 1 : year,
      isCurrentMonth: false,
    });
  }

  return days;
}

/**
 * 判断日历日期是否是今天
 */
export function isCalendarToday(day: CalendarDay): boolean {
  const today = new Date();
  return day.day === today.getDate() &&
         day.month === today.getMonth() &&
         day.year === today.getFullYear();
}

/**
 * 判断日历日期是否是选中日期
 */
export function isCalendarSelected(day: CalendarDay, timestamp: number | undefined): boolean {
  if (!timestamp) return false;
  const selected = new Date(timestamp);
  return day.day === selected.getDate() &&
         day.month === selected.getMonth() &&
         day.year === selected.getFullYear();
}

/**
 * 获取上个月
 */
export function prevMonth(year: number, month: number): { year: number; month: number } {
  if (month === 0) {
    return { year: year - 1, month: 11 };
  }
  return { year, month: month - 1 };
}

/**
 * 获取下个月
 */
export function nextMonth(year: number, month: number): { year: number; month: number } {
  if (month === 11) {
    return { year: year + 1, month: 0 };
  }
  return { year, month: month + 1 };
}

/**
 * 将日历日期转为时间戳
 */
export function calendarToDate(day: CalendarDay): number {
  const date = new Date(day.year, day.month, day.day);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/**
 * 判断时间戳是否是今天
 */
export function isTodayDate(timestamp: number): boolean {
  const date = new Date(timestamp);
  const today = new Date();
  return date.getDate() === today.getDate() &&
         date.getMonth() === today.getMonth() &&
         date.getFullYear() === today.getFullYear();
}

/**
 * 判断时间戳是否是明天
 */
export function isTomorrowDate(timestamp: number): boolean {
  const date = new Date(timestamp);
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return date.getDate() === tomorrow.getDate() &&
         date.getMonth() === tomorrow.getMonth() &&
         date.getFullYear() === tomorrow.getFullYear();
}

/**
 * 格式化日期为完整格式（X年X月X日）
 */
export function formatDateFull(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}
