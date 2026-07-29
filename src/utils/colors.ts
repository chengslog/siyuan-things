/**
 * 标签调色板（Things 3 风格的柔和色）。
 * 即席创建标签时按序循环取色。
 */
export const TAG_PALETTE = [
  "#e57373", // 红
  "#f06292", // 粉
  "#ba68c8", // 紫
  "#9575cd", // 淡紫
  "#7986cb", // 靛蓝
  "#64b5f6", // 蓝
  "#4fc3f7", // 天蓝
  "#4dd0e1", // 青
  "#4db6ac", // 碧
  "#81c784", // 绿
  "#aed581", // 黄绿
  "#ffb74d", // 橙
];

export function nextTagColor(currentCount: number): string {
  return TAG_PALETTE[currentCount % TAG_PALETTE.length];
}
