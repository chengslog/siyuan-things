import assert from "node:assert/strict";
import test from "node:test";

import { findViewportCreateTarget } from "../src/utils/createPosition.ts";

test("places a new card before the first task visible at the current scroll position", () => {
  const target = findViewportCreateTarget([
    {
      group: "group-1",
      top: -180,
      bottom: 260,
      rows: [
        { top: -120, bottom: -60 },
        { top: 20, bottom: 80 },
        { top: 90, bottom: 150 },
      ],
    },
    { group: "group-2", top: 280, bottom: 500, rows: [] },
  ], 0, 400);

  assert.deepEqual(target, { group: "group-1", index: 1 });
});

test("uses the next group when the current viewport is between groups", () => {
  const target = findViewportCreateTarget([
    { group: "group-1", top: -300, bottom: -20, rows: [] },
    { group: "group-2", top: 80, bottom: 300, rows: [] },
  ], 0, 400);

  assert.deepEqual(target, { group: "group-2", index: 0 });
});
