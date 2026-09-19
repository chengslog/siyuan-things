type Drop = { group: string; id: string; beforeId: string | null };

/** 长按排序：普通滑动交给浏览器，只有长按成立后才接管触摸。 */
export function touchSort(node: HTMLElement, onDrop: (drop: Drop) => void) {
  let row: HTMLElement | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let frame = 0;
  let active = false;
  let startX = 0;
  let startY = 0;
  let x = 0;
  let y = 0;
  let offsetY = 0;
  let touchId = -1;
  let ghost: HTMLElement | null = null;
  let indicator: HTMLElement | null = null;
  let beforeId: string | null = null;
  let suppressClickUntil = 0;

  function siblings() {
    return [...node.querySelectorAll<HTMLElement>('[data-sort-id]')]
      .filter(item => item !== row && item.dataset.sortGroup === row?.dataset.sortGroup);
  }

  function position() {
    if (!active || !row || !ghost || !indicator) return;
    const bounds = node.getBoundingClientRect();
    const peers = siblings();
    const before = peers.find(item => {
      const r = item.getBoundingClientRect();
      return y < r.top + r.height / 2;
    });
    beforeId = before?.dataset.sortId ?? null;
    ghost.style.top = `${y - offsetY}px`;
    // 最后一项的落点放在其整棵标签子树之后，而不是子标签之间。
    let last = peers[peers.length - 1] || row;
    const depth = Number(last.dataset.sortDepth || 0);
    while (last.nextElementSibling instanceof HTMLElement && Number(last.nextElementSibling.dataset.sortDepth) > depth) {
      last = last.nextElementSibling;
    }
    const lineY = before ? before.getBoundingClientRect().top : last.getBoundingClientRect().bottom;
    indicator.style.top = `${Math.max(bounds.top + 2, Math.min(bounds.bottom - 2, lineY))}px`;
    indicator.style.left = `${bounds.left + 12}px`;
    indicator.style.width = `${Math.max(0, bounds.width - 24)}px`;
  }

  function scrollFrame() {
    if (!active) return;
    const r = node.getBoundingClientRect();
    const edge = Math.min(48, r.height / 4);
    const speed = y < r.top + edge ? -Math.min(10, (r.top + edge - y) / 4)
      : y > r.bottom - edge ? Math.min(10, (y - r.bottom + edge) / 4) : 0;
    if (x >= r.left && x <= r.right) node.scrollTop += speed;
    position();
    frame = requestAnimationFrame(scrollFrame);
  }

  function begin() {
    timer = undefined;
    if (!row?.isConnected || !siblings().length) return;
    active = true;
    const r = row.getBoundingClientRect();
    offsetY = startY - r.top;
    window.getSelection()?.removeAllRanges();
    ghost = row.cloneNode(true) as HTMLElement;
    ghost.removeAttribute('data-sort-id');
    ghost.removeAttribute('tabindex');
    ghost.setAttribute('aria-hidden', 'true');
    Object.assign(ghost.style, {
      position: 'fixed', left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`,
      height: `${r.height}px`, margin: '0', zIndex: '100000', pointerEvents: 'none',
      background: 'var(--b3-theme-background)', boxShadow: '0 8px 24px rgba(0,0,0,.2)',
      borderRadius: '8px', opacity: '.94', boxSizing: 'border-box',
    });
    indicator = document.createElement('div');
    indicator.dataset.touchSortIndicator = '';
    Object.assign(indicator.style, { position: 'fixed', height: '2px', background: 'var(--b3-theme-primary)', zIndex: '100001', pointerEvents: 'none' });
    document.body.append(ghost, indicator);
    row.style.opacity = '.3';
    document.addEventListener('selectstart', preventSelection);
    try { navigator.vibrate?.(18); } catch { /* optional in WebView */ }
    scrollFrame();
  }

  function preventSelection(event: Event) { event.preventDefault(); }

  function start(event: TouchEvent) {
    if (active) { cancel(); return; }
    cleanup();
    if (event.touches.length !== 1) return;
    const target = event.target as HTMLElement;
    row = target.closest<HTMLElement>('[data-sort-id]');
    if (!row || !node.contains(row) || target.closest('button,input,textarea')) { row = null; return; }
    suppressClickUntil = 0;
    const touch = event.touches[0];
    touchId = touch.identifier;
    startX = x = touch.clientX;
    startY = y = touch.clientY;
    document.addEventListener('touchmove', move, { passive: false });
    document.addEventListener('touchend', end, { passive: false });
    document.addEventListener('touchcancel', cancel);
    timer = setTimeout(begin, 450);
  }

  function move(event: TouchEvent) {
    if (event.touches.length !== 1) { cancel(); return; }
    const touch = [...event.touches].find(t => t.identifier === touchId);
    if (!touch) { cancel(); return; }
    x = touch.clientX;
    y = touch.clientY;
    if (active) {
      if (!event.cancelable) { cancel(); return; }
      event.preventDefault();
      position();
    } else if (Math.hypot(x - startX, y - startY) > 8) {
      cleanup();
    }
  }

  function end(event: TouchEvent) {
    if (!active || !row) { cleanup(); return; }
    if (event.cancelable) event.preventDefault();
    const r = node.getBoundingClientRect();
    const drop = { group: row.dataset.sortGroup!, id: row.dataset.sortId!, beforeId };
    const inside = x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    suppressClickUntil = Date.now() + 600;
    cleanup();
    if (inside) onDrop(drop);
  }

  function cancel() {
    if (active) suppressClickUntil = Date.now() + 600;
    cleanup();
  }

  function click(event: MouseEvent) {
    if (active || Date.now() < suppressClickUntil) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }

  function contextMenu(event: Event) {
    if ((event.target as HTMLElement).closest('[data-sort-id]')) event.preventDefault();
  }

  function cleanup() {
    clearTimeout(timer);
    timer = undefined;
    cancelAnimationFrame(frame);
    if (row) row.style.opacity = '';
    ghost?.remove();
    indicator?.remove();
    row = ghost = indicator = null;
    active = false;
    document.removeEventListener('touchmove', move);
    document.removeEventListener('touchend', end);
    document.removeEventListener('touchcancel', cancel);
    document.removeEventListener('selectstart', preventSelection);
  }

  node.addEventListener('touchstart', start, { passive: false });
  node.addEventListener('click', click, true);
  node.addEventListener('contextmenu', contextMenu);
  window.addEventListener('blur', cancel);
  return {
    destroy() {
      cleanup();
      node.removeEventListener('touchstart', start);
      node.removeEventListener('click', click, true);
      node.removeEventListener('contextmenu', contextMenu);
      window.removeEventListener('blur', cancel);
    },
  };
}
