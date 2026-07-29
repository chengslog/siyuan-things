<script lang="ts">
  /**
   * 项目/区域创建表单卡片（替代 prompt()）。
   * 项目：名称 + 所属区域；区域：仅名称。
   */
  import { createEventDispatcher, onMount } from "svelte";
  import type { StoreManager } from "@/stores";
  import { showMessage } from "siyuan";

  export let store: StoreManager;
  export let kind: "project" | "area";

  const dispatch = createEventDispatcher();
  let name = "";
  let areaId: string | undefined = undefined;
  let inputEl: HTMLInputElement;

  $: areas = store.areas.getAll().sort((a, b) => a.order - b.order);

  onMount(() => {
    setTimeout(() => inputEl?.focus(), 50);
  });

  async function submit() {
    const n = name.trim();
    if (!n) {
      inputEl?.focus();
      return;
    }
    if (kind === "project") {
      await store.projects.createProject({ name: n, areaId });
      showMessage(`项目已创建：${n}`);
    } else {
      await store.areas.createArea({ name: n });
      showMessage(`区域已创建：${n}`);
    }
    dispatch("created");
  }
</script>

<div class="entity-form" on:click|stopPropagation>
  <div class="entity-form__title">{kind === "project" ? "新建项目" : "新建区域"}</div>

  <input
    bind:this={inputEl}
    type="text"
    class="entity-form__input"
    placeholder={kind === "project" ? "项目名称" : "区域名称"}
    bind:value={name}
    on:keydown={(e) => {
      if (e.key === "Enter") submit();
      if (e.key === "Escape") dispatch("cancel");
    }}
  />

  {#if kind === "project"}
    <select class="entity-form__select" bind:value={areaId}>
      <option value={undefined}>无区域</option>
      {#each areas as area (area.id)}
        <option value={area.id}>{area.name}</option>
      {/each}
    </select>
  {/if}

  <div class="entity-form__actions">
    <button class="entity-form__btn" on:click={() => dispatch("cancel")}>取消</button>
    <button class="entity-form__btn entity-form__btn--primary" on:click={submit}>创建</button>
  </div>
</div>

<style lang="scss">
  .entity-form {
    background: var(--b3-theme-surface);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12), 0 2px 8px rgba(0, 0, 0, 0.08);
    border-radius: 16px;
    padding: 16px 20px;
    margin: 8px 0;
    display: flex;
    flex-direction: column;
    gap: 10px;

    &__title {
      font-size: 14px;
      font-weight: 600;
      color: var(--b3-theme-on-surface);
    }

    &__input,
    &__select {
      width: 100%;
      font-size: 14px;
      padding: 8px 10px;
      border: 1px solid var(--b3-border-color);
      border-radius: 8px;
      outline: none;
      background: var(--b3-theme-background);
      color: var(--b3-theme-on-surface);

      &:focus {
        border-color: var(--b3-theme-primary);
      }
    }

    &__actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }

    &__btn {
      padding: 6px 16px;
      border: none;
      border-radius: 6px;
      background: transparent;
      cursor: pointer;
      font-size: 13px;
      color: var(--b3-theme-on-surface);

      &:hover {
        background: var(--b3-theme-surface-light);
      }

      &--primary {
        background: var(--b3-theme-primary);
        color: var(--b3-theme-on-primary);

        &:hover {
          background: var(--b3-theme-primary);
          opacity: 0.9;
        }
      }
    }
  }
</style>
