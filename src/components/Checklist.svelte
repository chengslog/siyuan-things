<script lang="ts">
  import { createEventDispatcher, onDestroy, tick } from "svelte";

  export let items: Array<{ id: string; title: string; completed: boolean }> = [];
  export let showDragHandle: boolean = false;

  const dispatch = createEventDispatcher();

  // 拖动状态
  let draggedId: string | null = null;
  let draggedIndex: number = -1;
  let insertIndex: number = -1;
  let itemHeight: number = 0;

  // DOM 引用
  let itemElements: Map<string, HTMLElement> = new Map();
  let ghostEl: HTMLElement | null = null;
  let draggedEl: HTMLElement | null = null;

  // 记录所有元素的初始位置
  let initialPositions: Array<{ id: string; centerY: number }> = [];

  // 鼠标状态
  let startY: number = 0;
  let currentY: number = 0;
  let draggedStartTop: number = 0;

  onDestroy(() => {
    cleanup();
  });

  function registerItem(id: string, el: HTMLElement) {
    if (el) {
      itemElements.set(id, el);
    }
  }

  // Svelte use action for binding elements
  function registerItemAction(node: HTMLElement, id: string) {
    registerItem(id, node);
    return {
      destroy() {
        itemElements.delete(id);
      }
    };
  }

  // 本地行 id 生成（Date.now() 同毫秒可能重复，加序号兜底）
  let idSeq = 0;
  function genId(): string {
    return `ck-${Date.now()}-${idSeq++}`;
  }

  // 只保证清单至少有一个输入行（新建模式/空清单能输入第一条）；
  // 新行仅由回车创建（见 handleKeydown），打字过程中不再自动追加。
  $: {
    if (items.length === 0) {
      items = [{ id: genId(), title: "", completed: false }];
    }
  }

  function toggleItem(id: string) {
    items = items.map(item =>
      item.id === id ? { ...item, completed: !item.completed } : item
    );
    dispatch("change", { items });
  }

  function updateItemTitle(id: string, title: string) {
    items = items.map(item =>
      item.id === id ? { ...item, title } : item
    );
    dispatch("change", { items });
  }

  function removeItem(id: string) {
    items = items.filter(item => item.id !== id);
    // 确保至少有一个空项
    if (items.length === 0) {
      items = [{ id: genId(), title: "", completed: false }];
    }
    dispatch("change", { items });
  }

  // 记录需要聚焦的新项 ID
  let pendingFocusId: string | null = null;

  // 当新空项被添加后（包括父组件重渲染恢复的情况），聚焦它
  $: if (pendingFocusId) {
    const targetId = pendingFocusId;
    pendingFocusId = null;
    tick().then(() => {
      const el = itemElements.get(targetId);
      if (el) {
        const input = el.querySelector('.checklist__input');
        if (input) (input as HTMLInputElement).focus();
      }
    });
  }

  function handleKeydown(e: KeyboardEvent, id: string) {
    if (e.key === 'Enter') {
      e.preventDefault();

      const currentIndex = items.findIndex(item => item.id === id);
      const currentItem = items[currentIndex];

      if (currentItem && currentItem.title.trim()) {
        // 在当前项后面插入新空项
        const newId = genId();
        const newItems = [...items];
        newItems.splice(currentIndex + 1, 0, { id: newId, title: "", completed: false });
        items = newItems;
        dispatch("change", { items });

        // 聚焦新项
        pendingFocusId = newId;
      } else if (!currentItem?.title.trim()) {
        // 当前空项按 Enter，聚焦下一项（如果有的话）
        const nextItem = items[currentIndex + 1];
        if (nextItem) {
          const nextEl = itemElements.get(nextItem.id);
          if (nextEl) {
            const input = nextEl.querySelector('.checklist__input');
            if (input) (input as HTMLInputElement).focus();
          }
        }
      }
    }
  }

  // 拖动功能 - 只有点击拖动按钮才能触发
  function handleDragMouseDown(e: MouseEvent, id: string) {
    e.preventDefault();
    e.stopPropagation();

    const el = itemElements.get(id);
    if (!el) return;

    const rect = el.getBoundingClientRect();
    const clientY = e.clientY;
    const index = items.findIndex(item => item.id === id);

    // 记录所有元素的初始位置
    initialPositions = items.map(item => {
      const itemEl = itemElements.get(item.id);
      const itemRect = itemEl!.getBoundingClientRect();
      return {
        id: item.id,
        centerY: itemRect.top + itemRect.height / 2
      };
    });

    // 初始化状态
    draggedId = id;
    draggedIndex = index;
    insertIndex = index;
    itemHeight = rect.height;
    startY = clientY;
    currentY = clientY;
    draggedStartTop = rect.top;
    draggedEl = el;

    // 创建幽灵元素
    ghostEl = el.cloneNode(true) as HTMLElement;
    applyGhostStyles(ghostEl, rect);
    document.body.appendChild(ghostEl);

    // 隐藏原元素
    el.style.visibility = 'hidden';

    // 绑定事件
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onEnd);

    dispatch('dragstart', { id, index });
  }

  function onMove(e: MouseEvent) {
    if (!draggedId || !ghostEl) return;
    e.preventDefault();

    currentY = e.clientY;
    const deltaY = currentY - startY;

    // 计算新的幽灵位置
    let newTop = draggedStartTop + deltaY;

    // 限制在边界内
    const firstPos = initialPositions[0];
    const lastPos = initialPositions[initialPositions.length - 1];
    if (firstPos && lastPos) {
      newTop = Math.max(firstPos.centerY - itemHeight, Math.min(lastPos.centerY, newTop));
    }

    // 更新幽灵位置
    ghostEl.style.top = `${newTop}px`;

    // 计算插入索引
    const ghostCenterY = newTop + itemHeight / 2;
    let newInsertIndex = draggedIndex;

    for (let i = 0; i < initialPositions.length; i++) {
      if (initialPositions[i].id === draggedId) continue;
      if (ghostCenterY < initialPositions[i].centerY) {
        newInsertIndex = i;
        break;
      }
      newInsertIndex = i + 1;
    }

    // 限制范围
    newInsertIndex = Math.max(0, Math.min(items.length, newInsertIndex));

    if (newInsertIndex !== insertIndex) {
      insertIndex = newInsertIndex;
      updatePositions();
    }
  }

  function onEnd(e: MouseEvent) {
    if (!draggedId) return;

    const fromIndex = draggedIndex;
    const toIndex = insertIndex;

    // 如果位置发生变化，重新排列 items
    if (fromIndex !== toIndex) {
      const newItems = [...items];
      const [movedItem] = newItems.splice(fromIndex, 1);
      newItems.splice(toIndex, 0, movedItem);
      items = newItems;
      dispatch("change", { items });
    }

    cleanup();
    dispatch('dragend', { id: draggedId });
  }

  // 更新所有元素位置
  function updatePositions() {
    items.forEach((item, index) => {
      if (item.id === draggedId) return;

      const el = itemElements.get(item.id);
      if (!el) return;

      const offset = calcOffset(index);
      el.style.transition = 'transform 200ms ease-out';
      el.style.transform = offset !== 0 ? `translateY(${offset}px)` : '';
    });
  }

  // 计算位移
  function calcOffset(index: number): number {
    // 向下拖拽
    if (draggedIndex < insertIndex) {
      if (index > draggedIndex && index <= insertIndex) {
        return -itemHeight; // 上移
      }
    }

    // 向上拖拽
    if (draggedIndex > insertIndex) {
      if (index >= insertIndex && index < draggedIndex) {
        return itemHeight; // 下移
      }
    }

    return 0;
  }

  function cleanup() {
    if (ghostEl) {
      ghostEl.remove();
      ghostEl = null;
    }

    if (draggedEl) {
      draggedEl.style.visibility = '';
      draggedEl = null;
    }

    itemElements.forEach(el => {
      el.style.transform = '';
      el.style.transition = '';
    });

    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onEnd);

    draggedId = null;
    draggedIndex = -1;
    insertIndex = -1;
    itemHeight = 0;
    startY = 0;
    currentY = 0;
    draggedStartTop = 0;
    initialPositions = [];
  }

  function applyGhostStyles(el: HTMLElement, rect: DOMRect) {
    el.style.cssText = `
      position: fixed;
      top: ${rect.top}px;
      left: ${rect.left}px;
      width: ${rect.width}px;
      height: ${rect.height}px;
      z-index: 10000;
      pointer-events: none;
      opacity: 0.9;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
      border-radius: 8px;
      margin: 0;
      box-sizing: border-box;
      background: white;
      transition: none;
    `;
  }
</script>

<div class="checklist">
  {#each items as item (item.id)}
    <div
      class="checklist__item"
      class:is-dragging={draggedId === item.id}
      use:registerItemAction={item.id}
    >
      <button
        class="checklist__check"
        class:is-done={item.completed}
        on:click={() => toggleItem(item.id)}
      >
        {#if item.completed}
          <svg><use xlink:href="#iconThingsCheck" /></svg>
        {/if}
      </button>
      <input
        type="text"
        class="checklist__input"
        class:is-done={item.completed}
        placeholder="检查项"
        bind:value={item.title}
        on:blur={() => dispatch("change", { items })}
        on:keydown={(e) => handleKeydown(e, item.id)}
      />
      <div class="checklist__actions">
        <button
          class="checklist__delete"
          on:click={() => removeItem(item.id)}
          title="删除"
        >
          ×
        </button>
        {#if showDragHandle}
          <div
            class="checklist__drag"
            title="拖动排序"
            on:mousedown={(e) => handleDragMouseDown(e, item.id)}
          >
            <svg viewBox="0 0 24 24" fill="currentColor">
              <circle cx="9" cy="6" r="1.5"/>
              <circle cx="15" cy="6" r="1.5"/>
              <circle cx="9" cy="12" r="1.5"/>
              <circle cx="15" cy="12" r="1.5"/>
            </svg>
          </div>
        {/if}
      </div>
    </div>
  {/each}
</div>

<style lang="scss">
  .checklist {
    display: flex;
    flex-direction: column;

    &__item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 0;
      border-bottom: 1px solid var(--b3-border-color);

      &:last-child {
        border-bottom: none;
      }

      &.is-dragging {
        opacity: 0;
      }
    }

    &__check {
      flex-shrink: 0;
      width: 16px;
      height: 16px;
      padding: 0;
      border: 1.5px solid var(--b3-border-color);
      border-radius: 50%;
      background: transparent;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.2s;

      svg {
        width: 10px;
        height: 10px;
        color: white;
      }

      &:hover {
        border-color: var(--b3-theme-primary);
      }

      &.is-done {
        background: var(--b3-theme-primary);
        border-color: var(--b3-theme-primary);
      }
    }

    &__input {
      flex: 1;
      border: none;
      outline: none;
      font-size: 13px;
      color: var(--b3-theme-on-surface);
      background: transparent;
      padding: 2px 0;
      min-width: 0;

      &.is-done {
        text-decoration: line-through;
        color: var(--b3-theme-on-surface-light);
      }

      &::placeholder {
        color: var(--b3-theme-on-surface-light);
      }
    }

    &__actions {
      display: flex;
      align-items: center;
      gap: 4px;
    }

    &__delete {
      flex-shrink: 0;
      width: 22px;
      height: 22px;
      padding: 0;
      border: none;
      background: transparent;
      cursor: pointer;
      color: var(--b3-theme-on-surface-light);
      font-size: 16px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 4px;
      transition: all 0.2s;

      &:hover {
        background: var(--b3-theme-error-light);
        color: var(--b3-theme-error);
      }
    }

    &__drag {
      flex-shrink: 0;
      width: 22px;
      height: 22px;
      cursor: grab;
      color: var(--b3-theme-on-surface-light);
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 4px;
      transition: all 0.2s;

      svg {
        width: 14px;
        height: 14px;
      }

      &:hover {
        background: var(--b3-theme-surface-light);
        color: var(--b3-theme-on-surface);
      }

      &:active {
        cursor: grabbing;
      }
    }
  }
</style>
