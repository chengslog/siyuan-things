import assert from "node:assert/strict";
import test from "node:test";

import type { Task } from "../src/types.ts";
import { selectAreaTasks } from "../src/utils/areaTasks.ts";

function task(id: string, overrides: Partial<Task> = {}): Task {
  return {
    id,
    title: id,
    notes: "",
    status: "todo",
    priority: "none",
    created: 1,
    updated: 1,
    tags: [],
    order: 0,
    ...overrides,
  };
}

const tasks = [
  task("direct", { areaId: "work" }),
  task("project-a", { projectId: "a" }),
  task("project-b-done", { projectId: "b", status: "done" }),
  task("other-area", { areaId: "life" }),
  task("other-project", { projectId: "c" }),
  task("canceled", { projectId: "a", status: "canceled" }),
  task("subtask", { projectId: "a", parentId: "project-a" }),
];

test("all projects includes direct, active, and completed tasks in the area", () => {
  assert.deepEqual(
    selectAreaTasks(tasks, "work", ["a", "b"]).map(({ id }) => id),
    ["direct", "project-a", "project-b-done"],
  );
});

test("a project tab filters the whole area page", () => {
  assert.deepEqual(
    selectAreaTasks(tasks, "work", ["a", "b"], "b").map(({ id }) => id),
    ["project-b-done"],
  );
});

test("an invalid project tab cannot expose tasks outside the area", () => {
  assert.deepEqual(selectAreaTasks(tasks, "work", ["a", "b"], "c"), []);
});
