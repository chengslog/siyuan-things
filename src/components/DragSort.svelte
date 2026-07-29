<script lang="ts">
  import { createEventDispatcher, onDestroy } from "svelte";

  export let items: Array<{ id: string; [key: string]: any }> = [];
  export let itemKey: string = "id";
  // 所属分组标识（跨组拖拽时随 drop 事件上报，供父级判断落点分组）
  export let groupKey: string = "";

  let containerEl: HTMLElement;

  const dispatch = createEventDispatcher();

  // 状态
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

  export function registerItem(id: string, el: HTMLElement) {
    if (el) itemElements.set(id, el);
  }

  export function unregisterItem(id: string) {
    itemElements.delete(id);
  }

  // —— 跨组拖拽支持：供父级查询本组的位置信息 ——
  // 垂直坐标是否落在本组容器内
  export function containsPoint(clientY: number): boolean {
    if (!containerEl) return false;
    const r = containerEl.getBoundingClientRect();
    return clientY >= r.top && clientY <= r.bottom;
  }

  // 按当前 DOM 位置计算 clientY 对应的插入索引（用于跨组落点）
  export function computeInsertIndex(clientY: number): number {
    const centers: number[] = [];
    for (const item of items) {
      const el = itemElements.get(item[itemKey]);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      centers.push(r.top + r.height / 2);
    }
    let idx = centers.length;
    for (let i = 0; i < centers.length; i++) {
      if (clientY < centers[i]) {
        idx = i;
        break;
      }
    }
    return idx;
  }

  export function handleDragStart(e: MouseEvent | TouchEvent, id: string) {
    e.preventDefault();

    const el = itemElements.get(id);
    if (!el) return;

    const rect = el.getBoundingClientRect();
    const clientY = getClientY(e);
    const index = items.findIndex(item => item[itemKey] === id);

    // 记录所有元素的初始位置
    initialPositions = items.map(item => {
      const itemEl = itemElements.get(item[itemKey]);
      const itemRect = itemEl!.getBoundingClientRect();
      return {
        id: item[itemKey],
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
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onEnd);

    dispatch('dragstart', { id, index });
  }

  function onMove(e: MouseEvent | TouchEvent) {
    if (!draggedId || !ghostEl) return;
    e.preventDefault();

    currentY = getClientY(e);
    const deltaY = currentY - startY;

    // 计算新的幽灵位置
    let newTop = draggedStartTop + deltaY;

    // 指针离开本组容器 → 跨组拖拽，幽灵自由跟随；否则限制在组内边界
    const outsideSelf = containerEl && (() => {
      const r = containerEl.getBoundingClientRect();
      return currentY < r.top || currentY > r.bottom;
    })();
    const firstPos = initialPositions[0];
    const lastPos = initialPositions[initialPositions.length - 1];
    if (!outsideSelf && firstPos && lastPos) {
      newTop = Math.max(firstPos.centerY - itemHeight, Math.min(lastPos.centerY, newTop));
    }

    // 更新幽灵位置
    ghostEl.style.top = `${newTop}px`;

    // 计算插入索引（基于幽灵元素中心位置和初始位置）
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

  function onEnd(e: MouseEvent | TouchEvent) {
    if (!draggedId) return;

    const clientY = getClientY(e);
    const fromIndex = draggedIndex;
    const toIndex = insertIndex;
    const id = draggedId;
    // 松手时指针还在本组内 → 组内排序（reorder）；否则交给父级做跨组判定（drop）
    const withinSelf = containerEl ? containsPoint(clientY) : true;

    cleanup();

    if (withinSelf && fromIndex !== toIndex) {
      dispatch('reorder', { fromIndex, toIndex, id });
    }

    dispatch('drop', { id, clientY, fromGroup: groupKey, withinSelf });
    dispatch('dragend', { id });
  }

  // 更新所有元素位置
  function updatePositions() {
    items.forEach((item, index) => {
      const id = item[itemKey];
      if (id === draggedId) return;

      const el = itemElements.get(id);
      if (!el) return;

      const offset = calcOffset(index);
      el.style.transition = 'transform 200ms ease-out';
      el.style.transform = offset !== 0 ? `translateY(${offset}px)` : '';
    });
  }

  // 计算位移
  function calcOffset(index: number): number {
    // 向下拖拽：原位置 < 目标位置
    // 例：A(0)拖到C之后(insertIndex=2)，B需要上移1格
    if (draggedIndex < insertIndex) {
      if (index > draggedIndex && index <= insertIndex) {
        return -itemHeight; // 上移
      }
    }

    // 向上拖拽：原位置 > 目标位置
    // 例：E(4)拖到A之前(insertIndex=0)，ABCD需要下移1格
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
    document.removeEventListener('touchmove', onMove);
    document.removeEventListener('touchend', onEnd);

    draggedId = null;
    draggedIndex = -1;
    insertIndex = -1;
    itemHeight = 0;
    startY = 0;
    currentY = 0;
    draggedStartTop = 0;
    initialPositions = [];
  }

  function getClientY(e: MouseEvent | TouchEvent): number {
    if ('touches' in e) {
      const t = e.touches[0] || e.changedTouches[0];
      return t ? t.clientY : 0;
    }
    return e.clientY;
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

<div class="drag-sort" bind:this={containerEl}>
  <slot
    items={items}
    isDragging={draggedId !== null}
    draggedId={draggedId}
    {registerItem}
    {unregisterItem}
    {handleDragStart}
  />
</div>

<style>
  .drag-sort {
    position: relative;
  }
</style>
