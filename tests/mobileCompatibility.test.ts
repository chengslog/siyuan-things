import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const manifest = JSON.parse(readFileSync(new URL("../plugin.json", import.meta.url), "utf8"));
const entry = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
const globalStyles = readFileSync(new URL("../src/index.scss", import.meta.url), "utf8");
const mobileApp = readFileSync(new URL("../src/components/MobileApp.svelte", import.meta.url), "utf8");
const mobileTaskPage = readFileSync(new URL("../src/components/MobileTaskPage.svelte", import.meta.url), "utf8");
const taskList = readFileSync(new URL("../src/components/TaskList.svelte", import.meta.url), "utf8");
const taskCard = readFileSync(new URL("../src/components/TaskCard.svelte", import.meta.url), "utf8");
const checklist = readFileSync(new URL("../src/components/Checklist.svelte", import.meta.url), "utf8");
const dragSort = readFileSync(new URL("../src/components/DragSort.svelte", import.meta.url), "utf8");
const touchSort = readFileSync(new URL("../src/utils/touchSort.ts", import.meta.url), "utf8");

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
  assert.match(entry, /document\.body\.appendChild\(host\)/);
  assert.match(mobileApp, /plugin\?\.openMobileTaskPage\?\./);
  assert.doesNotMatch(mobileApp, /<TaskList/);
  assert.match(mobileTaskPage, /position:\s*absolute/);
  assert.match(mobileTaskPage, /aiEnabled=\{false\}/);
  assert.match(mobileTaskPage, /mobile=\{true\}/);
  assert.match(mobileTaskPage, /aiMode="full"/);
  assert.match(globalStyles, /body\.things-mobile-page-open[\s\S]*?#toolbarName,[\s\S]*?#mobileBottomBar/);
});

test("mobile task pages override desktop overflow geometry", () => {
  assert.match(taskList, /&\.is-mobile[\s\S]*?margin:\s*0 -16px/);
  assert.match(taskList, /&\.is-mobile[\s\S]*?overflow-x:\s*hidden/);
  assert.match(taskCard, /&\.is-mobile[\s\S]*?width:\s*100%/);
  assert.match(taskCard, /&\.is-mobile[\s\S]*?\.task-card__aux[\s\S]*?flex:\s*1 0 100%/);
});

test("mobile interactions do not depend on desktop HTML drag events", () => {
  assert.match(taskCard, /setTimeout\(\(\) => \{[\s\S]*?dispatch\('dragstart'/);
  assert.match(taskCard, /on:touchmove\|nonpassive/);
  assert.match(checklist, /on:touchstart\|nonpassive/);
  assert.match(dragSort, /addEventListener\('touchcancel'/);
  assert.match(dragSort, /addEventListener\('selectstart'/);
  assert.match(dragSort, /insertIndex > draggedIndex \? insertIndex - 1 : insertIndex/);
  assert.match(touchSort, /setTimeout\(begin, 450\)/);
  assert.match(touchSort, /window\.getSelection\(\)\?\.removeAllRanges\(\)/);
  assert.match(taskList, /moveHeadingOnMobile/);
  assert.match(taskList, /on:touchstart\|nonpassive=\{handleFabTouchStart\}/);
});

test("mobile navigation alignment and task toolbar use touch-sized controls", () => {
  assert.match(mobileApp, /&__section-open[\s\S]*?padding:\s*6px 10px/);
  assert.match(mobileApp, /&__nav-icon,[\s\S]*?width:\s*20px;[\s\S]*?height:\s*20px/);
  assert.doesNotMatch(mobileApp, />↕<\/button>/);
  assert.match(mobileApp, /use:touchSort=\{reorderEntities\}/);
  assert.doesNotMatch(mobileApp, /toggleReorder|mobile-things__reorder-actions/);
  assert.match(mobileApp, /aria-label="新建项目"[\s\S]*?#iconThingsAdd/);
  assert.match(taskCard, /\.task-card__toolbar-right[\s\S]*?justify-content:\s*flex-start/);
  assert.match(taskCard, /\.task-card__tool-btn[\s\S]*?height:\s*52px/);
  assert.match(taskCard, /\.task-card__tag-item[\s\S]*?min-height:\s*36px/);
  assert.match(taskCard, /task-card__tool-label/);
  assert.match(taskCard, /task-card__mobile-more-shell/);
  assert.match(taskCard, /swipeToolsOpen = true/);
  assert.doesNotMatch(taskCard, />完成编辑<\/button>/);
  assert.match(taskList, /\.task-list__header-top\.has-border[\s\S]*?border-bottom:\s*0/);
  assert.match(taskList, /padding:\s*3px 0 calc\(96px \+ env\(safe-area-inset-bottom\)\)/);
  assert.doesNotMatch(taskList, /aria-label="新建任务" on:click=\{\(\) => openCreateAtCurrentPosition/);
});

test("mobile editor stays compact and shares a visual treatment with its floating toolbar", () => {
  assert.doesNotMatch(taskCard, /toolbar-owner|定位当前任务/);
  assert.match(taskCard, /class:is-editor-footer=\{expanded && mode !== 'create'\}/);
  assert.match(taskCard, /&\.is-expanded:not\(\.is-create\)[\s\S]*?position:\s*relative/);
  assert.doesNotMatch(taskCard, /--mobile-editor-bottom|top: max\(15vh/);
  assert.equal((taskCard.match(/animation: things-editor-reveal 180ms ease-out/g) || []).length, 2);
  assert.equal((taskCard.match(/background: var\(--things-editor-glass/g) || []).length, 2);
});

test("expanded mobile cards show editable property values instead of toolbar highlights", () => {
  assert.match(taskCard, /aria-label="已设置的任务属性"/);
  assert.match(taskCard, /aria-label="修改日期"/);
  assert.match(taskCard, /aria-label="修改截止日期"/);
  assert.match(taskCard, /修改标签 \$\{tag.name\}/);
  assert.match(taskCard, /task-card__selection-mark/);
  assert.match(taskCard, /\.task-card__notes-md[^\n]*font-size: 16px/);
});
