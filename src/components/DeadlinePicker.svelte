<script lang="ts">
  import { createEventDispatcher } from "svelte";
  import { getTodayStart, getDaysFromNow } from "@/utils/date";
  import {
    generateCalendar,
    isCalendarToday,
    isCalendarSelected,
    prevMonth,
    nextMonth,
    calendarToDate
  } from "@/utils/calendar";
  import TimePicker from "./TimePicker.svelte";
  import { Icon } from "@/icons";

  export let timestamp: number | undefined = undefined;
  export let showClear: boolean = true;

  const dispatch = createEventDispatcher();

  // 日历状态
  let calendarMonth = new Date().getMonth();
  let calendarYear = new Date().getFullYear();
  let showTimePicker = false;

  // 时间状态（若已有截止时间则回显其时分，否则默认 18:00 即“今晚”）
  let selectedHour = timestamp ? new Date(timestamp).getHours() : 18;
  let selectedMinute = timestamp ? new Date(timestamp).getMinutes() : 0;

  // 日历数据
  $: calendarDays = generateCalendar(calendarYear, calendarMonth);

  function handlePrevMonth() {
    const prev = prevMonth(calendarYear, calendarMonth);
    calendarYear = prev.year;
    calendarMonth = prev.month;
  }

  function handleNextMonth() {
    const nxt = nextMonth(calendarYear, calendarMonth);
    calendarYear = nxt.year;
    calendarMonth = nxt.month;
  }

  function selectCalendarDay(day: any) {
    timestamp = calendarToDate(day);
    dispatch("change", { timestamp });
  }

  function handleQuickOption(option: string) {
    switch (option) {
      case "today":
        timestamp = getTodayStart();
        break;
      case "tomorrow":
        timestamp = getDaysFromNow(1);
        break;
      case "nextWeek":
        timestamp = getDaysFromNow(7);
        break;
      case "clear":
        timestamp = undefined;
        break;
    }
    dispatch("change", { timestamp });
    dispatch("close");
  }

  function handleTimeConfirm(e: CustomEvent) {
    const { hour, minute } = e.detail;
    const date = timestamp ? new Date(timestamp) : new Date();
    date.setHours(hour, minute, 0, 0);
    timestamp = date.getTime();
    showTimePicker = false;
    dispatch("change", { timestamp });
    dispatch("close");
  }
</script>

<div class="deadline-picker" on:click|stopPropagation>
  <!-- 今天 -->
  <button class="deadline-picker__option" on:click={() => handleQuickOption("today")}>
    <span class="deadline-picker__icon"><Icon name="iconThingsCalendarLine" size={16} /></span>
    <span class="deadline-picker__label">今天</span>
  </button>

  <!-- 明天 -->
  <button class="deadline-picker__option" on:click={() => handleQuickOption("tomorrow")}>
    <span class="deadline-picker__icon"><Icon name="iconThingsCalendarLine" size={16} /></span>
    <span class="deadline-picker__label">明天</span>
  </button>

  <!-- 下周 -->
  <button class="deadline-picker__option" on:click={() => handleQuickOption("nextWeek")}>
    <span class="deadline-picker__icon"><Icon name="iconThingsCalendarLine" size={16} /></span>
    <span class="deadline-picker__label">下周</span>
  </button>

  <!-- 日历 -->
  <div class="deadline-picker__calendar">
    <div class="deadline-picker__calendar-header">
      <button class="deadline-picker__calendar-nav" on:click={handlePrevMonth}>‹</button>
      <span class="deadline-picker__calendar-title">{calendarYear}年{calendarMonth + 1}月</span>
      <button class="deadline-picker__calendar-nav" on:click={handleNextMonth}>›</button>
    </div>
    <div class="deadline-picker__calendar-weekdays">
      <span>一</span>
      <span>二</span>
      <span>三</span>
      <span>四</span>
      <span>五</span>
      <span>六</span>
      <span>日</span>
    </div>
    <div class="deadline-picker__calendar-days">
      {#each calendarDays as day}
        <button
          class="deadline-picker__calendar-day"
          class:is-other-month={!day.isCurrentMonth}
          class:is-today={isCalendarToday(day)}
          class:is-selected={isCalendarSelected(day, timestamp)}
          on:click={() => selectCalendarDay(day)}
        >
          {day.day}
        </button>
      {/each}
    </div>
  </div>

  <div class="deadline-picker__separator"></div>

  <!-- 添加提醒时间 -->
  <button class="deadline-picker__option" on:click={() => showTimePicker = !showTimePicker}>
    <span class="deadline-picker__icon"><Icon name="iconThingsBell" size={16} /></span>
    <span class="deadline-picker__label">+添加提醒时间</span>
  </button>

  <!-- 时间选择器 -->
  {#if showTimePicker}
    <TimePicker
      hour={selectedHour}
      minute={selectedMinute}
      on:cancel={() => showTimePicker = false}
      on:confirm={handleTimeConfirm}
    />
  {/if}

  <!-- 清除 -->
  {#if showClear && timestamp}
    <div class="deadline-picker__separator"></div>
    <button class="deadline-picker__option deadline-picker__option--clear" on:click={() => handleQuickOption("clear")}>
      <span class="deadline-picker__icon"><Icon name="iconThingsX" size={16} /></span>
      <span class="deadline-picker__label">清除</span>
    </button>
  {/if}
</div>

<style lang="scss">
  .deadline-picker {
    width: 280px;

    &__option {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      padding: 8px 12px;
      border: none;
      background: transparent;
      cursor: pointer;
      font-size: 13px;
      text-align: left;
      color: var(--b3-theme-on-surface);
      border-radius: 4px;

      &:hover {
        background: var(--b3-theme-surface-light);
      }

      &--clear {
        color: var(--b3-theme-on-surface-light);

        &:hover {
          color: var(--b3-theme-error);
          background: var(--b3-theme-surface-light);
        }
      }
    }

    &__icon {
      width: 20px;
      text-align: center;
    }

    &__label {
      flex: 1;
    }

    &__separator {
      height: 1px;
      background: var(--b3-border-color);
      margin: 4px 0;
    }

    &__calendar {
      margin: 8px 0;
    }

    &__calendar-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 4px 0;
      margin-bottom: 8px;
    }

    &__calendar-title {
      font-size: 13px;
      font-weight: 500;
    }

    &__calendar-nav {
      width: 28px;
      height: 28px;
      border: none;
      background: transparent;
      cursor: pointer;
      font-size: 18px;
      color: var(--b3-theme-on-surface);
      border-radius: 4px;
      display: flex;
      align-items: center;
      justify-content: center;

      &:hover {
        background: var(--b3-theme-surface-light);
      }
    }

    &__calendar-weekdays {
      display: grid;
      grid-template-columns: repeat(7, 1fr);
      gap: 2px;
      margin-bottom: 4px;

      span {
        text-align: center;
        font-size: 11px;
        color: var(--b3-theme-on-surface-light);
        padding: 4px;
      }
    }

    &__calendar-days {
      display: grid;
      grid-template-columns: repeat(7, 1fr);
      gap: 2px;
    }

    &__calendar-day {
      width: 32px;
      height: 32px;
      border: none;
      background: transparent;
      cursor: pointer;
      font-size: 12px;
      color: var(--b3-theme-on-surface);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto;

      &:hover {
        background: var(--b3-theme-surface-light);
      }

      &.is-other-month {
        color: var(--b3-theme-on-surface-light);
        opacity: 0.5;
      }

      &.is-today {
        font-weight: 600;
        color: var(--b3-theme-primary);
      }

      &.is-selected {
        background: var(--b3-theme-primary);
        color: var(--b3-theme-on-primary);
      }
    }
  }
</style>
