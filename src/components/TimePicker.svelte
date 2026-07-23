<script lang="ts">
  import { createEventDispatcher } from "svelte";

  export let hour: number = 9;
  export let minute: number = 0;

  const dispatch = createEventDispatcher();

  // 小时选项 0-23
  const hourOptions = Array.from({ length: 24 }, (_, i) => i);
  // 分钟选项 0, 5, 10, 15, ..., 55
  const minuteOptions = Array.from({ length: 12 }, (_, i) => i * 5);

  function handleCancel() {
    dispatch("cancel");
  }

  function handleConfirm() {
    dispatch("confirm", { hour, minute });
  }
</script>

<div class="time-picker" on:click|stopPropagation>
  <div class="time-picker__scrolls">
    <div class="time-picker__scroll">
      <div class="time-picker__label">时</div>
      <div class="time-picker__options">
        {#each hourOptions as h}
          <button
            class="time-picker__option"
            class:is-selected={hour === h}
            on:click={() => hour = h}
          >
            {h.toString().padStart(2, '0')}
          </button>
        {/each}
      </div>
    </div>
    <div class="time-picker__separator">:</div>
    <div class="time-picker__scroll">
      <div class="time-picker__label">分</div>
      <div class="time-picker__options">
        {#each minuteOptions as m}
          <button
            class="time-picker__option"
            class:is-selected={minute === m}
            on:click={() => minute = m}
          >
            {m.toString().padStart(2, '0')}
          </button>
        {/each}
      </div>
    </div>
  </div>
  <div class="time-picker__actions">
    <button class="time-picker__btn" on:click={handleCancel}>取消</button>
    <button class="time-picker__btn time-picker__btn--primary" on:click={handleConfirm}>确定</button>
  </div>
</div>

<style lang="scss">
  .time-picker {
    margin-top: 8px;
    padding-top: 8px;
    border-top: 1px solid var(--b3-border-color);

    &__scrolls {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      margin-bottom: 12px;
    }

    &__scroll {
      display: flex;
      flex-direction: column;
      align-items: center;
    }

    &__label {
      font-size: 11px;
      color: var(--b3-theme-on-surface-light);
      margin-bottom: 4px;
    }

    &__options {
      height: 120px;
      overflow-y: auto;
      width: 60px;
      border: 1px solid var(--b3-border-color);
      border-radius: 6px;
      scrollbar-width: thin;
    }

    &__separator {
      font-size: 24px;
      font-weight: 600;
      padding-bottom: 20px;
    }

    &__option {
      display: block;
      width: 100%;
      padding: 6px;
      border: none;
      background: transparent;
      cursor: pointer;
      font-size: 14px;
      text-align: center;
      color: var(--b3-theme-on-surface);

      &:hover {
        background: var(--b3-theme-surface-light);
      }

      &.is-selected {
        background: var(--b3-theme-primary);
        color: var(--b3-theme-on-primary);
        font-weight: 600;
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
      background: transparent;
      cursor: pointer;
      font-size: 13px;
      color: var(--b3-theme-on-surface);
      border-radius: 4px;

      &:hover {
        background: var(--b3-theme-surface-light);
      }

      &--primary {
        background: var(--b3-theme-primary);
        color: var(--b3-theme-on-primary);

        &:hover {
          opacity: 0.9;
        }
      }
    }
  }
</style>
