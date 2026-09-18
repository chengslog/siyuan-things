import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const manifest = JSON.parse(readFileSync(new URL("../plugin.json", import.meta.url), "utf8"));
const entry = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
const mobileApp = readFileSync(new URL("../src/components/MobileApp.svelte", import.meta.url), "utf8");
const mobileTaskPage = readFileSync(new URL("../src/components/MobileTaskPage.svelte", import.meta.url), "utf8");
const taskList = readFileSync(new URL("../src/components/TaskList.svelte", import.meta.url), "utf8");
const taskCard = readFileSync(new URL("../src/components/TaskCard.svelte", import.meta.url), "utf8");
const checklist = readFileSync(new URL("../src/components/Checklist.svelte", import.meta.url), "utf8");
const dragSort = readFileSync(new URL("../src/components/DragSort.svelte", import.meta.url), "utf8");

test("declares native and browser mobile compatibility", () => {
  assert.ok(manifest.frontends.includes("mobile"));
  assert.ok(manifest.frontends.includes("browser-mobile"));
  for (const backend of ["android", "ios", "harmony"]) {
    assert.ok(manifest.backends.includes(backend));
    assert.ok(manifest.kernels.includes(backend));
  }
});

test("routes mobile navigation into a separate main task page", () => {
  assert.match(entry, /frontend === "mobile" \|\| frontend === "browser-mobile"/);
  assert.match(entry, /new MobileApp/);
  assert.match(entry, /new MobileTaskPage/);
  assert.match(entry, /if \(!this\.isMobileFrontend\) this\.addTab/);
  assert.match(entry, /document\.getElementById\("editor"\)/);
  assert.match(mobileApp, /plugin\?\.openMobileTaskPage\?\./);
  assert.doesNotMatch(mobileApp, /<TaskList/);
  assert.match(mobileTaskPage, /position:\s*absolute/);
  assert.match(mobileTaskPage, /aiEnabled=\{false\}/);
  assert.match(mobileTaskPage, /mobile=\{true\}/);
});

test("mobile task pages override desktop overflow geometry", () => {
  assert.match(taskList, /&\.is-mobile[\s\S]*?margin:\s*0 -12px/);
  assert.match(taskList, /&\.is-mobile[\s\S]*?overflow-x:\s*hidden/);
  assert.match(taskCard, /&\.is-mobile[\s\S]*?width:\s*100%/);
  assert.match(taskCard, /&\.is-mobile[\s\S]*?\.task-card__aux[\s\S]*?flex:\s*1 0 100%/);
});

test("mobile interactions do not depend on desktop HTML drag events", () => {
  assert.match(taskCard, /setTimeout\(\(\) => \{[\s\S]*?dispatch\('dragstart'/);
  assert.match(taskCard, /on:touchmove\|nonpassive/);
  assert.match(checklist, /on:touchstart\|nonpassive/);
  assert.match(dragSort, /addEventListener\('touchcancel'/);
  assert.match(taskList, /moveHeadingOnMobile/);
  assert.match(taskList, /on:touchstart\|nonpassive=\{handleFabTouchStart\}/);
});

test("mobile navigation alignment and task toolbar use touch-sized controls", () => {
  assert.match(mobileApp, /&__section-open[\s\S]*?padding:\s*6px 10px/);
  assert.match(mobileApp, /&__nav-icon,[\s\S]*?width:\s*20px;[\s\S]*?height:\s*20px/);
  assert.doesNotMatch(mobileApp, />↕<\/button>/);
  assert.match(mobileApp, /reorderKind === "project" \? "完成" : "排序"/);
  assert.match(taskCard, /\.task-card__toolbar-right[\s\S]*?justify-content:\s*flex-end/);
  assert.match(taskCard, /\.task-card__tool-btn[\s\S]*?height:\s*38px/);
  assert.match(taskCard, /\.task-card__tag-item[\s\S]*?min-height:\s*36px/);
  assert.match(taskCard, /task-card__tool-label/);
});
