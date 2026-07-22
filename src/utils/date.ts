/**
 * 获取今天零点时间戳
 */
export function getTodayStart(): number {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now.getTime();
}

/**
 * 获取今天结束时间戳（23:59:59）
 */
export function getTodayEnd(): number {
  const now = new Date();
  now.setHours(23, 59, 59, 999);
  return now.getTime();
}

/**
 * 判断时间戳是否是今天
 */
export function isToday(timestamp: number): boolean {
  const start = getTodayStart();
  const end = getTodayEnd();
  return timestamp >= start && timestamp <= end;
}

/**
 * 判断时间戳是否已过期
 */
export function isOverdue(timestamp: number): boolean {
  return timestamp < getTodayStart();
}

/**
 * 获取 N 天后的零点时间戳
 */
export function getDaysFromNow(days: number): number {
  const now = new Date();
  now.setDate(now.getDate() + days);
  now.setHours(0, 0, 0, 0);
  return now.getTime();
}

/**
 * 格式化日期为 YYYY-MM-DD
 */
export function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * 格式化日期为相对描述
 */
export function formatRelativeDate(timestamp: number): string {
  const now = getTodayStart();
  const target = new Date(timestamp);
  target.setHours(0, 0, 0, 0);
  const targetTime = target.getTime();

  const diffDays = Math.round((targetTime - now) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return '今天';
  if (diffDays === 1) return '明天';
  if (diffDays === -1) return '昨天';
  if (diffDays > 0 && diffDays <= 7) return `${diffDays}天后`;
  if (diffDays < 0 && diffDays >= -7) return `${Math.abs(diffDays)}天前`;

  return formatDate(timestamp);
}

/**
 * 解析日期字符串为时间戳
 */
export function parseDate(dateStr: string): number | undefined {
  if (!dateStr) return undefined;
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return undefined;
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/**
 * 获取日期字符串用于 input[type=date]
 */
export function toDateInputValue(timestamp?: number): string {
  if (!timestamp) return '';
  return formatDate(timestamp);
}

/**
 * 格式化日期为 YYYY-MM-DD（短格式）
 */
export function formatDateShort(timestamp: number): string {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * 格式化时间为 HH:MM
 */
export function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

/**
 * 是否有时间设置（非0点）
 */
export function hasTime(timestamp: number): boolean {
  const date = new Date(timestamp);
  return date.getHours() !== 0 || date.getMinutes() !== 0;
}
