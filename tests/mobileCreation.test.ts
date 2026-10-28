import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";
import { parse } from "svelte/compiler";

const entitySource = readFileSync(new URL("../src/components/EntityForm.svelte", import.meta.url), "utf8");
const mobileSource = readFileSync(new URL("../src/components/MobileApp.svelte", import.meta.url), "utf8");

// Execute the actual handlers rather than a parallel implementation of their save logic.
function functions(source: string, names: string[]): string {
  const script = source.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  const ast = ts.createSourceFile("component.ts", script, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  return names.map(name => {
    const declaration = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
    assert.ok(declaration, `Missing component handler: ${name}`);
    return declaration.getText(ast);
  }).join("\n");
}

function eventHandler(source: string, elementName: string, eventName: string): string {
  // Preserve source offsets while removing TypeScript and SCSS from template parsing.
  const template = source.replace(/<script[^>]*>[\s\S]*?<\/script>|<style[^>]*>[\s\S]*?<\/style>/g,
    match => " ".repeat(match.length));
  const ast = parse(template);
  let expression: any;
  function visit(node: any) {
    if (!node || typeof node !== "object") return;
    if (node.name === elementName && Array.isArray(node.attributes)) {
      const handler = node.attributes.find((attribute: any) => attribute.type === "EventHandler" && attribute.name === eventName);
      if (handler) expression = handler.expression;
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === "object") visit(value);
    }
  }
  visit(ast.html);
  assert.ok(expression, `Missing ${elementName} ${eventName} handler`);
  return template.slice(expression.start, expression.end);
}

function compile(body: string, env: any): any {
  const javascript = ts.transpileModule(body, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  return new Function("env", javascript)(env);
}

function mobileHarness(env: any, kind = "tag") {
  return compile(`
    const {store, showMessage, console} = env;
    let createKind = env.kind, tagName = "  手机标签  ", tagSaving = false, entitySaving = false;
    const tagInput = {focus: env.focus};
    ${functions(mobileSource, ["createTag", "closeCreate"])}
    return {
      createTag, closeCreate,
      keydown: (${eventHandler(mobileSource, "input", "keydown")}),
      onBusy: (${eventHandler(mobileSource, "EntityForm", "busy")}),
      onCreated: (${eventHandler(mobileSource, "EntityForm", "created")}),
      onCancel: (${eventHandler(mobileSource, "EntityForm", "cancel")}),
      read: () => ({createKind, tagName, tagSaving, entitySaving})
    };
  `, { ...env, kind });
}

function entityHarness(env: any, kind: "project" | "area") {
  return compile(`
    const {store, showMessage, dispatch, console, kind} = env;
    let name = "  手机创建名称  ", areaId = "area-example", saving = false;
    const inputEl = {focus: env.focus};
    ${functions(entitySource, ["submit"])}
    return {
      submit,
      keydown: (${eventHandler(entitySource, "input", "keydown")}),
      read: () => ({name, areaId, saving})
    };
  `, { ...env, kind });
}

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function environment() {
  const requests: Array<{ kind: string; value: any; gate: ReturnType<typeof deferred> }> = [];
  const messages: string[] = [];
  const events: Array<{ type: string; detail: any }> = [];
  const save = (kind: string) => (value: any) => {
    const gate = deferred();
    requests.push({ kind, value, gate });
    return gate.promise;
  };
  return {
    requests, messages, events,
    store: { projects: { createProject: save("project") }, areas: { createArea: save("area") }, tags: { createTag: save("tag") } },
    showMessage: (message: string) => messages.push(message),
    console: { error() {} }, focus() {},
  };
}

for (const kind of ["project", "area"] as const) {
  test(`${kind} creation blocks duplicates, preserves failed input, and closes only after a successful retry`, async () => {
    const env = environment();
    const parent = mobileHarness(env, kind);
    const form = entityHarness({ ...env, dispatch(type: string, detail: any) {
      env.events.push({ type, detail });
      if (type === "busy") parent.onBusy({ detail });
      if (type === "created") parent.onCreated();
      if (type === "cancel") parent.onCancel();
    } }, kind);

    const first = form.submit();
    await form.submit();
    assert.equal(env.requests.length, 1);
    assert.equal(env.requests[0].kind, kind);
    assert.deepEqual(env.requests[0].value, kind === "project" ? { name: "手机创建名称", areaId: "area-example" } : { name: "手机创建名称" });
    assert.equal(form.read().saving, true);
    assert.equal(parent.read().entitySaving, true);
    parent.closeCreate();
    form.keydown({ key: "Escape" });
    assert.equal(parent.read().createKind, kind, "Backdrop and keyboard cancellation must not dismiss an active save");

    env.requests[0].gate.reject(new Error("Synthetic persistence failure"));
    await first;
    assert.deepEqual(form.read(), { name: "  手机创建名称  ", areaId: "area-example", saving: false });
    assert.deepEqual(parent.read(), { createKind: kind, tagName: "  手机标签  ", tagSaving: false, entitySaving: false });
    assert.equal(env.events.some(event => event.type === "created" || event.type === "cancel"), false);
    assert.match(env.messages.at(-1)!, /创建失败.*保留输入/);

    const retry = form.submit();
    assert.equal(parent.read().createKind, kind);
    env.requests[1].gate.resolve();
    await retry;
    assert.equal(parent.read().createKind, null);
    assert.equal(parent.read().entitySaving, false, "The busy flag must reset after created closes the child");
    assert.equal(form.read().saving, false);
    assert.deepEqual(env.events.map(event => [event.type, event.detail]), [
      ["busy", true], ["busy", false], ["busy", true], ["created", undefined], ["busy", false],
    ]);
  });
}

test("tag creation prevents double submission and cancellation until settlement, retaining failed input for retry", async () => {
  const env = environment();
  const form = mobileHarness(env);
  const first = form.createTag();
  await form.createTag();
  assert.equal(env.requests.length, 1);
  assert.deepEqual(env.requests[0].value, { name: "手机标签" });
  form.closeCreate();
  form.keydown({ key: "Escape" });
  assert.equal(form.read().createKind, "tag");
  env.requests[0].gate.reject(new Error("Synthetic persistence failure"));
  await first;
  assert.deepEqual(form.read(), { createKind: "tag", tagName: "  手机标签  ", tagSaving: false, entitySaving: false });
  assert.match(env.messages.at(-1)!, /标签创建失败.*保留输入/);
  const retry = form.createTag();
  assert.equal(form.read().createKind, "tag");
  env.requests[1].gate.resolve();
  await retry;
  assert.equal(form.read().createKind, null);
  assert.equal(form.read().tagSaving, false);
});

test("composition Enter never submits project, area, or tag; a normal Enter still does", async () => {
  for (const kind of ["project", "area", "tag"] as const) {
    const env = environment();
    const form = kind === "tag" ? mobileHarness(env) : entityHarness({ ...env, dispatch() {} }, kind);
    form.keydown({ key: "Enter", isComposing: true, keyCode: 13 });
    form.keydown({ key: "Enter", isComposing: false, keyCode: 229 });
    assert.equal(env.requests.length, 0, `${kind}: Chinese composition must preserve the draft`);
    form.keydown({ key: "Enter", isComposing: false, keyCode: 13 });
    assert.equal(env.requests.length, 1, `${kind}: ordinary Enter must remain usable`);
    env.requests[0].gate.resolve();
    await env.requests[0].gate.promise;
  }
});

test("parent cancellation resumes after a failed save", async () => {
  const env = environment();
  const form = mobileHarness(env);
  const pending = form.createTag();
  env.requests[0].gate.reject(new Error("Synthetic persistence failure"));
  await pending;
  form.closeCreate();
  assert.equal(form.read().createKind, null);

  const parent = mobileHarness(env, "project");
  parent.onBusy({ detail: true });
  parent.onCancel();
  assert.equal(parent.read().createKind, "project");
  parent.onBusy({ detail: false });
  parent.onCancel();
  assert.equal(parent.read().createKind, null);
});
