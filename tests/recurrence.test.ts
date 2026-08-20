import test from "node:test";
import assert from "node:assert/strict";
import { nextRepeatTimestamp, normalizeRepeatRule } from "../src/utils/recurrence.ts";

function localDate(year: number, month: number, day: number, hour = 9, minute = 30) {
  return new Date(year, month - 1, day, hour, minute, 0, 0).getTime();
}

test("normalizes AI and Chinese repeat values", () => {
  assert.equal(normalizeRepeatRule("每天"), "daily");
  assert.equal(normalizeRepeatRule("weekday"), "weekdays");
  assert.equal(normalizeRepeatRule("每周"), "weekly");
  assert.equal(normalizeRepeatRule(null), undefined);
  assert.equal(normalizeRepeatRule("sometimes"), undefined);
});

test("weekdays skips Saturday and Sunday and preserves time", () => {
  const friday = localDate(2026, 8, 21, 16, 45);
  const next = new Date(nextRepeatTimestamp(friday, "weekdays"));
  assert.equal(next.getDay(), 1);
  assert.equal(next.getDate(), 24);
  assert.equal(next.getHours(), 16);
  assert.equal(next.getMinutes(), 45);
});

test("monthly recurrence clamps month-end dates", () => {
  const january31 = localDate(2027, 1, 31);
  const next = new Date(nextRepeatTimestamp(january31, "monthly"));
  assert.equal(next.getFullYear(), 2027);
  assert.equal(next.getMonth(), 1);
  assert.equal(next.getDate(), 28);
});

test("yearly recurrence clamps leap day", () => {
  const leapDay = localDate(2028, 2, 29);
  const next = new Date(nextRepeatTimestamp(leapDay, "yearly"));
  assert.equal(next.getFullYear(), 2029);
  assert.equal(next.getMonth(), 1);
  assert.equal(next.getDate(), 28);
});
