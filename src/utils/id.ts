/**
 * 生成 UUID v4
 */
export function genUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * 生成短 ID（8 位）
 */
export function genShortId(): string {
  return Math.random().toString(36).substring(2, 10);
}
