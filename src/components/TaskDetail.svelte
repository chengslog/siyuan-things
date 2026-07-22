<script lang="ts">
  import { createEventDispatcher } from "svelte";
  import type { Task, TaskStatus, Priority } from "@/types";
  import type { StoreManager } from "@/stores";
  import { formatDate, parseDate, toDateInputValue } from "@/utils/date";

  export let task: Task;
  export let store: StoreManager;

  const dispatch = createEventDispatcher();

  // 编辑状态
  let title = task.title;
  let notes = task.notes;
  let status: TaskStatus = task.status;
  let priority: Priority = task.priority;
  let startDate = toDateInputValue(task.startDate);
  let deadline = toDateInputValue(task.deadline);
  let projectId = task.projectId || "";
  let areaId = task.areaId || "";
  let selectedTags = [...task.tags];

  // 获取选项
  $: projects = store.projects.getActiveProjects();
  $: areas = store.areas.getAll();
  $: tags = store.tags.getAll();
  $: subTasks = store.tasks.getSubTasks(task.id);

  // 保存更改
  async function handleSave() {
    await store.tasks.updateTask(task.id, {
      title,
      notes,
      status,
      priority,
      startDate: parseDate(startDate),
      deadline: parseDate(deadline),
      projectId: projectId || undefined,
      areaId: areaId || undefined,
      tags: selectedTags,
    });
    dispatch("close");
  }

  // 删除任务
  async function handleDelete() {
    if (confirm("确定要删除这个任务吗？")) {
      await store.tasks.delete(task.id);
      dispatch("close");
    }
  }

  // 添加子任务
  let newSubTaskTitle = "";
  async function handleAddSubTask() {
    if (!newSubTaskTitle.trim()) return;
    await store.tasks.createTask({
      title: newSubTaskTitle.trim(),
      parentId: task.id,
      projectId: task.projectId,
      areaId: task.areaId,
    });
    newSubTaskTitle = "";
    // 刷新子任务列表
    subTasks = store.tasks.getSubTasks(task.id);
  }

  // 切换标签
  function toggleTag(tagId: string) {
    const index = selectedTags.indexOf(tagId);
    if (index >= 0) {
      selectedTags = selectedTags.filter((id) => id !== tagId);
    } else {
      selectedTags = [...selectedTags, tagId];
    }
  }
</script>

<div class="task-detail">
  <!-- 状态和优先级 -->
  <div class="task-detail__row">
    <div class="task-detail__field">
      <label>状态</label>
      <select class="b3-select" bind:value={status}>
        <option value="todo">待办</option>
        <option value="done">已完成</option>
        <option value="canceled">已取消</option>
      </select>
    </div>

    <div class="task-detail__field">
      <label>优先级</label>
      <select class="b3-select" bind:value={priority}>
        <option value="none">无</option>
        <option value="low">低</option>
        <option value="medium">中</option>
        <option value="high">高</option>
      </select>
    </div>
  </div>

  <!-- 标题 -->
  <div class="task-detail__field">
    <label>标题</label>
    <input type="text" class="b3-text-field" bind:value={title} placeholder="任务标题" />
  </div>

  <!-- 备注 -->
  <div class="task-detail__field">
    <label>备注</label>
    <textarea class="b3-text-field" bind:value={notes} placeholder="添加备注..." rows="4" />
  </div>

  <!-- 日期 -->
  <div class="task-detail__row">
    <div class="task-detail__field">
      <label>开始日期</label>
      <input type="date" class="b3-text-field" bind:value={startDate} />
    </div>

    <div class="task-detail__field">
      <label>截止日期</label>
      <input type="date" class="b3-text-field" bind:value={deadline} />
    </div>
  </div>

  <!-- 项目和区域 -->
  <div class="task-detail__row">
    <div class="task-detail__field">
      <label>项目</label>
      <select class="b3-select" bind:value={projectId}>
        <option value="">无</option>
        {#each projects as project}
          <option value={project.id}>{project.name}</option>
        {/each}
      </select>
    </div>

    <div class="task-detail__field">
      <label>区域</label>
      <select class="b3-select" bind:value={areaId}>
        <option value="">无</option>
        {#each areas as area}
          <option value={area.id}>{area.name}</option>
        {/each}
      </select>
    </div>
  </div>

  <!-- 标签 -->
  <div class="task-detail__field">
    <label>标签</label>
    <div class="task-detail__tags">
      {#each tags as tag}
        <button
          class="task-detail__tag"
          class:is-selected={selectedTags.includes(tag.id)}
          on:click={() => toggleTag(tag.id)}
          style={tag.color ? `background-color: ${tag.color}` : ""}
        >
          {tag.name}
        </button>
      {/each}
    </div>
  </div>

  <!-- 子任务 -->
  <div class="task-detail__field">
    <label>子任务 ({subTasks.filter((t) => t.status === "done").length}/{subTasks.length})</label>
    <div class="task-detail__subtasks">
      {#each subTasks as subTask}
        <div class="task-detail__subtask">
          <button
            class="task-detail__subtask-check"
            class:is-done={subTask.status === "done"}
            on:click={() => store.tasks.toggleTask(subTask.id)}
          >
            {#if subTask.status === "done"}
              <svg><use xlink:href="#iconCheck" /></svg>
            {:else}
              <svg><use xlink:href="#iconCircle" /></svg>
            {/if}
          </button>
          <span class:is-done={subTask.status === "done"}>{subTask.title}</span>
        </div>
      {/each}

      <form class="task-detail__add-subtask" on:submit|preventDefault={handleAddSubTask}>
        <input
          type="text"
          class="b3-text-field"
          placeholder="添加子任务..."
          bind:value={newSubTaskTitle}
        />
      </form>
    </div>
  </div>

  <!-- 操作按钮 -->
  <div class="task-detail__actions">
    <button class="b3-button b3-button--outline" on:click={handleSave}>保存</button>
    <button class="b3-button b3-button--outline b3-button--danger" on:click={handleDelete}>删除</button>
  </div>
</div>

<style lang="scss">
  .task-detail {
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 16px;

    &__row {
      display: flex;
      gap: 16px;

      .task-detail__field {
        flex: 1;
      }
    }

    &__field {
      display: flex;
      flex-direction: column;
      gap: 6px;

      label {
        font-size: 12px;
        font-weight: 600;
        color: var(--b3-theme-on-surface-light);
      }

      input,
      select,
      textarea {
        width: 100%;
      }
    }

    &__tags {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }

    &__tag {
      padding: 4px 10px;
      border: none;
      border-radius: 12px;
      background: var(--b3-theme-surface-light);
      color: var(--b3-theme-on-surface);
      font-size: 12px;
      cursor: pointer;
      transition: all 0.2s;

      &:hover {
        opacity: 0.8;
      }

      &.is-selected {
        background: var(--b3-theme-primary);
        color: var(--b3-theme-on-primary);
      }
    }

    &__subtasks {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    &__subtask {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 4px 0;

      .is-done {
        text-decoration: line-through;
        color: var(--b3-theme-on-surface-light);
      }
    }

    &__subtask-check {
      width: 18px;
      height: 18px;
      padding: 0;
      border: 1.5px solid var(--b3-border-color);
      border-radius: 50%;
      background: transparent;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;

      svg {
        width: 12px;
        height: 12px;
      }

      &.is-done {
        background: var(--b3-theme-primary);
        border-color: var(--b3-theme-primary);
        color: var(--b3-theme-on-primary);
      }
    }

    &__add-subtask {
      margin-top: 4px;

      input {
        width: 100%;
        font-size: 13px;
      }
    }

    &__actions {
      display: flex;
      gap: 8px;
      padding-top: 8px;
      border-top: 1px solid var(--b3-border-color);
    }
  }
</style>
