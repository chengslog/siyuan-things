import assert from "node:assert/strict";
import test from "node:test";

import { hasStartDateArrived } from "../src/utils/date.ts";

const now = new Date(2026, 8, 18, 10, 0, 0).getTime();

test("past and current start dates remain active Today items", () => {
  assert.equal(hasStartDateArrived(new Date(2026, 8, 16).getTime(), now), true);
  assert.equal(hasStartDateArrived(new Date(2026, 8, 18, 20, 0).getTime(), now), true);
});

test("future start dates remain inactive in Upcoming", () => {
  assert.equal(hasStartDateArrived(new Date(2026, 8, 19).getTime(), now), false);
});
