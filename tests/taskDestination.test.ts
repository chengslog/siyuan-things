import test from "node:test";
import assert from "node:assert/strict";
import type { Task } from "../src/types.ts";
import { getTaskDestination } from "../src/utils/taskDestination.ts";

const now = new Date(2026, 7, 26, 12, 0, 0, 0).getTime();
const lookup = {
  projectName: (id: string) => id === "project-1" ? "产品项目" : undefined,
  areaName: (id: string) => id === "area-1" ? "工作区域" : undefined,
};

function task(changes: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    title: "测试任务",
    notes: "",
    status: "todo",
    priority: "none",
    created: now,
    updated: now,
    tags: [],
    order: 0,
    ...changes,
  };
}

test("AI added-task destination follows project, area, then sidebar view priority", () => {
  assert.equal(getTaskDestination(task({ projectId: "project-1", areaId: "area-1", someday: true }), lookup, now).label, "已添加到产品项目");
  assert.equal(getTaskDestination(task({ areaId: "area-1", status: "done" }), lookup, now).label, "已添加到工作区域");
  assert.equal(getTaskDestination(task({ status: "done" }), lookup, now).label, "已添加到日志");
  assert.equal(getTaskDestination(task({ someday: true }), lookup, now).label, "已添加到某天");
  assert.equal(getTaskDestination(task({ startDate: new Date(2026, 7, 26, 18, 0, 0, 0).getTime() }), lookup, now).label, "已添加到今天");
  assert.equal(getTaskDestination(task({ startDate: new Date(2026, 7, 27, 0, 0, 0, 0).getTime() }), lookup, now).label, "已添加到计划");
  assert.equal(getTaskDestination(task(), lookup, now).label, "已添加到收件箱");
});
