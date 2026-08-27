type OrderedHeading = { id: string; order: number };
export type ProjectGroupDropPosition = "before" | "after";

/**
 * 生成项目详情的完整可排序分组序列。
 * 特殊 id "none" 代表“进行中”，旧数据没有 groupOrder 时默认排在标题分组之后。
 */
export function normalizeProjectGroupOrder(headings: OrderedHeading[], storedOrder?: string[]): string[] {
  const headingIds = [...headings].sort((a, b) => a.order - b.order).map((heading) => heading.id);
  const validIds = new Set([...headingIds, "none"]);
  const normalized = (storedOrder || [])
    .filter((id, index, all) => validIds.has(id) && all.indexOf(id) === index);

  for (const id of headingIds) {
    if (!normalized.includes(id)) normalized.push(id);
  }
  if (!normalized.includes("none")) normalized.push("none");
  return normalized;
}

/** 按明确落点移动项目分组；用于标题行和包含任务的整块分组拖放。 */
export function moveProjectGroup(
  order: string[],
  draggedId: string,
  targetId: string,
  position: ProjectGroupDropPosition,
): string[] {
  if (draggedId === targetId || !order.includes(draggedId) || !order.includes(targetId)) return [...order];

  const next = order.filter((id) => id !== draggedId);
  const targetIndex = next.indexOf(targetId);
  next.splice(targetIndex + (position === "after" ? 1 : 0), 0, draggedId);
  return next;
}
