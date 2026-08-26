type DraftLike = { clientId?: unknown; [key: string]: unknown };

/**
 * 独立 create 轮次只应展示本轮新任务。模型若把上下文中的旧草稿按
 * clientId 原样带回，则在进入 UI 前剔除，避免旧任务在最新轮再次展开。
 */
export function omitEchoedDraftsForCreate<T extends DraftLike>(
  currentTasks: T[] | undefined,
  previousDrafts: DraftLike[] | undefined,
): T[] {
  const tasks = Array.isArray(currentTasks) ? currentTasks : [];
  const previousIds = new Set(
    (previousDrafts || [])
      .map((task) => String(task?.clientId || '').trim())
      .filter(Boolean),
  );
  if (previousIds.size === 0) return tasks;
  return tasks.filter((task) => {
    const clientId = String(task?.clientId || '').trim();
    return !clientId || !previousIds.has(clientId);
  });
}
