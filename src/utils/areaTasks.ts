import type { Task } from "@/types";

/**
 * 返回区域页面应展示的顶层任务。
 *
 * “全部”同时包含区域直属任务和区域内各项目的任务；选择项目后，
 * 项目筛选会作用于整个页面，只保留该项目的任务。
 */
export function selectAreaTasks(
  tasks: Task[],
  areaId: string,
  areaProjectIds: Iterable<string>,
  selectedProjectId?: string,
): Task[] {
  const projectIds = new Set(areaProjectIds);

  return tasks.filter((task) => {
    if (task.status === "canceled" || task.parentId) return false;

    if (selectedProjectId) {
      return projectIds.has(selectedProjectId) && task.projectId === selectedProjectId;
    }

    if (task.projectId) return projectIds.has(task.projectId);
    return task.areaId === areaId;
  });
}
