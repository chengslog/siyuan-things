import Sortable from 'sortablejs';

// Sortable 1.15 implements this option; @types/sortablejs 1.15.9 omits it.
type TouchSortableOptions = Sortable.Options & { supportPointer: boolean };

export type MobileSortDrop = { id: string; from: HTMLElement; to: HTMLElement; fromIndex: number; toIndex: number; beforeId: string | null };
type Options = { enabled?: boolean; draggable?: string; handle?: string; group?: string; onStart?: () => void; onEnd?: () => void; onDrop: (drop: MobileSortDrop) => void; canMove?: (dragged: HTMLElement, related: HTMLElement) => boolean };

/** Shared touch sorting; restore DOM before Svelte applies the final keyed order. */
export function mobileSort(node: HTMLElement, options: Options) {
  let sortable: Sortable | undefined;
  let next: ChildNode | null = null;
  let cancelled = false;
  let suppressUntil = 0;
  let descendants: HTMLElement[] = [];
  const cancel = () => { cancelled = true; };
  const click = (event: Event) => {
    if (Date.now() < suppressUntil) { event.preventDefault(); event.stopImmediatePropagation(); }
  };
  const context = (event: Event) => {
    if ((event.target as HTMLElement).closest('[data-sort-id]') && !(event.target as HTMLElement).closest('input,textarea')) event.preventDefault();
  };
  function setup() {
    if (options.enabled === false) return;
    const sortableOptions: TouchSortableOptions = {
      draggable: options.draggable || '[data-sort-id]', handle: options.handle, group: options.group || undefined,
      direction: 'vertical', delay: 450, delayOnTouchOnly: true, touchStartThreshold: 8,
      forceFallback: true, fallbackOnBody: true, fallbackTolerance: 5,
      supportPointer: false,
      animation: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 160,
      scroll: true, scrollSensitivity: 48, scrollSpeed: 8, bubbleScroll: true,
      ghostClass: 'things-sort-ghost', chosenClass: 'things-sort-chosen', fallbackClass: 'things-sort-fallback',
      filter: (event, target) => {
        const point = (event as TouchEvent).touches?.[0];
        return !!target.closest(options.handle ? 'input,textarea' : 'input,textarea,button,.task-card.is-expanded,.task-card.is-create') ||
          !!point && (point.clientX < 28 || point.clientX > innerWidth - 28);
      },
      preventOnFilter: false,
      onChoose(event) { next = event.item.nextSibling; cancelled = false; window.getSelection()?.removeAllRanges(); },
      onStart(event) {
        options.onStart?.();
        document.body.classList.add('things-touch-sorting');
        try { navigator.vibrate?.(15); } catch { /* optional */ }
        if (event.item.dataset.sortDepth !== undefined) {
          let peer = event.item.nextElementSibling;
          while (peer instanceof HTMLElement && Number(peer.dataset.sortDepth) > Number(event.item.dataset.sortDepth)) {
            descendants.push(peer); peer.style.visibility = 'hidden'; peer = peer.nextElementSibling;
          }
        }
      },
      onMove(event) { return options.canMove?.(event.dragged, event.related) ?? true; },
      onEnd(event) {
        const from = event.from, to = event.to;
        const id = event.item.dataset.sortId!;
        let peer = event.item.nextElementSibling as HTMLElement | null;
        while (peer && (!peer.dataset.sortId || peer.dataset.sortGroup !== event.item.dataset.sortGroup)) peer = peer.nextElementSibling as HTMLElement | null;
        const beforeId = peer?.dataset.sortId ?? null;
        from.insertBefore(event.item, next?.parentNode === from ? next : null);
        descendants.forEach(row => row.style.visibility = ''); descendants = [];
        document.body.classList.remove('things-touch-sorting');
        suppressUntil = Date.now() + 500;
        if (!cancelled && (from !== to || event.oldDraggableIndex !== event.newDraggableIndex)) {
          options.onDrop({ id, from, to, fromIndex: event.oldDraggableIndex ?? 0, toIndex: event.newDraggableIndex ?? 0, beforeId });
        }
        options.onEnd?.();
      },
    };
    sortable = new Sortable(node, sortableOptions);
  }
  node.addEventListener('click', click, true);
  node.addEventListener('contextmenu', context);
  document.addEventListener('touchcancel', cancel, true);
  setup();
  return {
    update(value: Options) {
      const changed = (value.enabled !== false) !== (options.enabled !== false);
      options = value;
      if (changed) { sortable?.destroy(); sortable = undefined; setup(); }
    },
    destroy() {
      sortable?.destroy(); descendants.forEach(row => row.style.visibility = '');
      document.body.classList.remove('things-touch-sorting');
      node.removeEventListener('click', click, true); node.removeEventListener('contextmenu', context);
      document.removeEventListener('touchcancel', cancel, true);
    },
  };
}
