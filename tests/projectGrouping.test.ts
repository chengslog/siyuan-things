import assert from "node:assert/strict";
import test from "node:test";

import { moveProjectGroup, normalizeProjectGroupOrder } from "../src/utils/projectGrouping.ts";

test("legacy projects place active group after ordered headings", () => {
  const headings = [
    { id: "second", order: 1 },
    { id: "first", order: 0 },
  ];

  assert.deepEqual(normalizeProjectGroupOrder(headings), ["first", "second", "none"]);
});

test("persisted ordering keeps active group movable and cleans invalid or duplicate ids", () => {
  const headings = [
    { id: "first", order: 0 },
    { id: "second", order: 1 },
    { id: "new", order: 2 },
  ];

  assert.deepEqual(
    normalizeProjectGroupOrder(headings, ["none", "second", "missing", "second", "new", "first"]),
    ["none", "second", "new", "first"],
  );
});

test("a newly prepended heading remains above the previous persisted groups", () => {
  const headings = [
    { id: "new", order: 0 },
    { id: "first", order: 1 },
  ];
  const previousOrder = normalizeProjectGroupOrder([{ id: "first", order: 0 }], ["none", "first"]);

  assert.deepEqual(normalizeProjectGroupOrder(headings, ["new", ...previousOrder]), ["new", "none", "first"]);
});

test("moves the active group before a populated heading group", () => {
  assert.deepEqual(
    moveProjectGroup(["group-1", "group-2", "none"], "none", "group-2", "before"),
    ["group-1", "none", "group-2"],
  );
});
