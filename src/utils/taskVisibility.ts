import type { ProjectStatus, Task } from "../types.ts";

/** 全局时间视图不展示暂停或作废项目中的任务。 */
export function isTaskVisibleForProjectStatus(
  task: Pick<Task, "projectId">,
  projectStatus: ProjectStatus | undefined,
): boolean {
  if (!task.projectId) return true;
  return projectStatus !== "onhold" && projectStatus !== "canceled";
}
