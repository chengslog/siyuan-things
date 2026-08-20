/**
 * Svelte action: 弹层智能定位
 * 检测触发按钮在视口中的位置，下方空间不足时向上展开，
 * 右侧溢出时左移，确保弹层完整显示在可视区域内。
 *
 * 用法：<div class="task-card__dropdown" use:smartPosition>
 */
export function smartPosition(node: HTMLElement) {
  const trigger = node.parentElement;
  if (!trigger) return {};

  const alignRight = node.classList.contains('task-card__dropdown--right');
  const margin = 6;
  let frame = 0;

  // Escape card/list overflow clipping while preserving the mounted Svelte component.
  document.body.appendChild(node);
  node.style.position = 'fixed';
  node.style.zIndex = '100000';
  node.style.margin = '0';

  function place() {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      if (!node.isConnected || !trigger.isConnected) return;
      node.style.left = '0';
      node.style.right = 'auto';
      node.style.top = '0';
      node.style.bottom = 'auto';

      const triggerRect = trigger.getBoundingClientRect();
      const popupRect = node.getBoundingClientRect();
      const viewportWidth = document.documentElement.clientWidth;
      const viewportHeight = document.documentElement.clientHeight;

      let left = alignRight ? triggerRect.right - popupRect.width : triggerRect.left;
      left = Math.max(margin, Math.min(left, viewportWidth - popupRect.width - margin));

      const spaceBelow = viewportHeight - triggerRect.bottom;
      const spaceAbove = triggerRect.top;
      let top = triggerRect.bottom + margin;
      if (spaceBelow < popupRect.height + margin && spaceAbove > spaceBelow) {
        top = triggerRect.top - popupRect.height - margin;
      }
      top = Math.max(margin, Math.min(top, viewportHeight - popupRect.height - margin));

      node.style.left = `${Math.round(left)}px`;
      node.style.top = `${Math.round(top)}px`;
    });
  }

  place();
  window.addEventListener('resize', place);
  document.addEventListener('scroll', place, true);

  return {
    destroy() {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', place);
      document.removeEventListener('scroll', place, true);
      // The action portals this element outside its original Svelte block.
      // Remove it explicitly so a conditional/card teardown cannot leave an
      // orphaned picker attached to document.body.
      node.remove();
    },
  };
}
