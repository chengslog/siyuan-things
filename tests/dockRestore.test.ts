import test from "node:test";
import assert from "node:assert/strict";
import {
  ACTIVE_SYNC_DOCK_RESTORE_TTL,
  DOCK_RESTORE_RETRY_DELAYS,
  POST_SYNC_DOCK_RESTORE_TTL,
  createDockRestoreIntent,
  isDockRestoreIntentValid,
} from "../src/utils/dockRestore.ts";

test("dock restore uses a bounded post-sync retry plan", () => {
  assert.deepEqual(DOCK_RESTORE_RETRY_DELAYS, [300, 800, 1600]);
  assert.equal(POST_SYNC_DOCK_RESTORE_TTL, 5000);
  assert.equal(ACTIVE_SYNC_DOCK_RESTORE_TTL, 600000);
});

test("dock restore intent expires and rejects legacy or malformed values", () => {
  const now = 1_000;
  const intent = createDockRestoreIntent(now, POST_SYNC_DOCK_RESTORE_TTL);

  assert.equal(isDockRestoreIntentValid(intent, now + 4_999), true);
  assert.equal(isDockRestoreIntentValid(intent, now + 5_000), false);
  assert.equal(isDockRestoreIntentValid("1", now), false);
  assert.equal(isDockRestoreIntentValid("invalid", now), false);
  assert.equal(isDockRestoreIntentValid(null, now), false);
});
