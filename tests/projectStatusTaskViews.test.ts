import assert from "node:assert/strict";
import test from "node:test";

import { isTaskVisibleForProjectStatus } from "../src/utils/taskVisibility.ts";

test("standard time views exclude tasks in paused and canceled projects", () => {
  const projectTask = { projectId: "project" };

  assert.equal(isTaskVisibleForProjectStatus(projectTask, "active"), true);
  assert.equal(isTaskVisibleForProjectStatus(projectTask, "completed"), true);
  assert.equal(isTaskVisibleForProjectStatus(projectTask, "onhold"), false);
  assert.equal(isTaskVisibleForProjectStatus(projectTask, "canceled"), false);
});

test("tasks without a project remain visible", () => {
  assert.equal(isTaskVisibleForProjectStatus({}, undefined), true);
});
