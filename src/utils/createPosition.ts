export type CreatePositionRow = { top: number; bottom: number };
export type CreatePositionGroup = {
  group: string;
  top: number;
  bottom: number;
  rows: CreatePositionRow[];
};

/**
 * 根据滚动视口选择新建卡片的分组和插入位置。
 * 落点优先贴近视口顶部，让卡片出现在用户当前阅读位置而非列表开头。
 */
export function findViewportCreateTarget(
  groups: CreatePositionGroup[],
  viewportTop: number,
  viewportBottom: number,
): { group: string; index: number } | null {
  if (!groups.length) return null;

  const ordered = [...groups].sort((a, b) => a.top - b.top);
  const anchor = viewportTop + Math.min(32, Math.max(0, (viewportBottom - viewportTop) / 3));
  const visible = ordered.filter((item) => item.bottom > viewportTop && item.top < viewportBottom);
  const targetGroup = visible.find((item) => item.bottom >= anchor)
    || ordered.find((item) => item.top >= anchor)
    || ordered[ordered.length - 1];
  const rowIndex = targetGroup.rows.findIndex((row) => row.bottom > anchor);

  return {
    group: targetGroup.group,
    index: rowIndex < 0 ? targetGroup.rows.length : rowIndex,
  };
}
