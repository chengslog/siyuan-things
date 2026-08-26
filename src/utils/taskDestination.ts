import type { Task } from "@/types";

export interface TaskDestination {
  label: string;
  icon: string;
}

interface DestinationLookup {
  projectName: (id: string) => string | undefined;
  areaName: (id: string) => string | undefined;
}

/**
 * 选择任务添加成功后展示的单一主位置。
 * 任务可能同时出现在多个视图，产品优先级为：项目 > 区域 > 时间/状态视图 > 收件箱。
 */
export function getTaskDestination(task: Task, lookup: DestinationLookup, now = Date.now()): TaskDestination {
  if (task.projectId) {
    return {
      label: `已添加到${lookup.projectName(task.projectId) || "项目"}`,
      icon: "iconThingsProject",
    };
  }

  if (task.areaId) {
    return {
      label: `已添加到${lookup.areaName(task.areaId) || "区域"}`,
      icon: "iconThingsArea",
    };
  }

  if (task.status === "done") return { label: "已添加到日志", icon: "iconThingsLog" };
  if (task.someday) return { label: "已添加到某天", icon: "iconThingsSomeday" };

  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(todayStart);
  todayEnd.setHours(23, 59, 59, 999);
  const date = task.startDate || task.deadline;

  if (date && date <= todayEnd.getTime() && (task.startDate || date >= todayStart.getTime())) {
    return { label: "已添加到今天", icon: "iconThingsToday" };
  }
  if (date && date > todayEnd.getTime()) {
    return { label: "已添加到计划", icon: "iconThingsCalendar" };
  }
  return { label: "已添加到收件箱", icon: "iconThingsInbox" };
}
