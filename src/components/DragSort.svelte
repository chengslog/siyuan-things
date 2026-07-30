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
  let indicatorEl: HTMLElement | null = null;

  // 记录所有元素的初始位置
  let initialPositions: Array<{ id: string; centerY: number }> = [];

  // 鼠标状态
  let startY: number = 0;
  let currentY: number = 0;
  let draggedStartTop: number = 0;
  let wasOutsideSelf: boolean = false;

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

  // 供父级跨组拖拽时，在"目标组"内撑开一个槽位（后续任务下移避让）并显示插入指引线
  export function showGapAt(clientY: number, gapHeight: number) {
    if (!containerEl) return;
    if (!indicatorEl) {
      indicatorEl = document.createElement('div');
      indicatorEl.className = 'things-drag-indicator';
      containerEl.appendChild(indicatorEl);
    }
    const idx = computeInsertIndex(clientY);
    let i = 0;
    for (const item of items) {
      const el = itemElements.get(item[itemKey]);
      if (!el) continue;
      el.style.transition = 'transform 200ms ease-out';
      el.style.transform = i >= idx ? `translateY(${gapHeight}px)` : '';
      i++;
    }
    placeIndicator(idx);
  }

  // 清除避让位移（指针离开本组 / 拖拽结束时由父级调用）
  export function clearGap() {
    for (const item of items) {
      const el = itemElements.get(item[itemKey]);
      if (!el) continue;
      el.style.transition = 'transform 200ms ease-out';
      el.style.transform = '';
    }
    hideIndicator();
  }

  // 被拖任务的高度（供父级计算目标组避让槽位高度）
  export function getItemHeight(): number {
    return itemHeight;
  }

  export function hideIndicator() {
    if (indicatorEl) {
      indicatorEl.remove();
      indicatorEl = null;
    }
  }

  // 指引线放在（挤占后）目标槽位的边界上；excludeDragged 排除被拖元素（跨组时它不在本组）
  function placeIndicator(idx: number) {
    if (!indicatorEl || !containerEl) return;
    const rects: { top: number; bottom: number }[] = [];
    for (const item of items) {
      if (item[itemKey] === draggedId) continue;
      const el = itemElements.get(item[itemKey]);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      rects.push({ top: r.top, bottom: r.bottom });
    }
    const containerRect = containerEl.getBoundingClientRect();
    let y: number;
    if (rects.length === 0) {
      y = containerRect.top;
    } else if (idx <= 0) {
      y = rects[0].top - 4;
    } else if (idx >= rects.length) {
      y = rects[rects.length - 1].bottom + 4;
    } else {
      y = (rects[idx - 1].bottom + rects[idx].top) / 2;
    }
    indicatorEl.style.top = `${y - containerRect.top}px`;
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

    // 插入位置指引线
    indicatorEl = document.createElement('div');
    indicatorEl.className = 'things-drag-indicator';
    containerEl.appendChild(indicatorEl);
    updateIndicator();

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

    const changed = newInsertIndex !== insertIndex;
    if (changed) {
      insertIndex = newInsertIndex;
      updatePositions();
    }
    // 指引线：组内拖拽显示本组指引线；一旦离开本组就隐藏（由父级在目标组内绘制）；回到组内时恢复
    if (outsideSelf) {
      if (!wasOutsideSelf) hideIndicator();
    } else if (changed || wasOutsideSelf) {
      updateIndicator();
    }
    wasOutsideSelf = !!outsideSelf;
  }

  // 组内指引线定位：按挤占后的实时布局，落在目标槽位的边界上
  function updateIndicator() {
    if (draggedIndex < 0) return;
    if (!indicatorEl && containerEl) {
      indicatorEl = document.createElement('div');
      indicatorEl.className = 'things-drag-indicator';
      containerEl.appendChild(indicatorEl);
    }
    if (!indicatorEl) return;
    const idx = insertIndex > draggedIndex ? insertIndex - 1 : insertIndex;
    placeIndicator(idx);
  }

  function onEnd(e: MouseEvent | TouchEvent) {
    if (!draggedId) return;

    const clientY = getClientY(e);
    const clientX = getClientX(e);
    const fromIndex = draggedIndex;
    const toIndex = insertIndex;
    const id = draggedId;
    // 松手时指针还在本组内 → 组内排序（reorder）；否则交给父级做跨组判定（drop）
    const withinSelf = containerEl ? containsPoint(clientY) : true;

    cleanup();

    if (withinSelf && fromIndex !== toIndex) {
      dispatch('reorder', { fromIndex, toIndex, id });
    }

    dispatch('drop', { id, clientX, clientY, fromGroup: groupKey, withinSelf });
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

    if (indicatorEl) {
      indicatorEl.remove();
      indicatorEl = null;
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
    wasOutsideSelf = false;
  }

  function getClientY(e: MouseEvent | TouchEvent): number {
    if ('touches' in e) {
      const t = e.touches[0] || e.changedTouches[0];
      return t ? t.clientY : 0;
    }
    return e.clientY;
  }

  function getClientX(e: MouseEvent | TouchEvent): number {
    if ('touches' in e) {
      const t = e.touches[0] || e.changedTouches[0];
      return t ? t.clientX : 0;
    }
    return e.clientX;
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
    /* 空分组也保留落点区域：否则空组高度为 0，只有组头一条线能命中，
       拖到"今晚"这类空分组必须精确指着标题才出指引线 */
    min-height: 48px;
  }
</style>
