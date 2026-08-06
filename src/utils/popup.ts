/**
 * Svelte action: 弹层智能定位
 * 检测触发按钮在视口中的位置，下方空间不足时向上展开，
 * 右侧溢出时左移，确保弹层完整显示在可视区域内。
 *
 * 用法：<div class="task-card__dropdown" use:smartPosition>
 */
export function smartPosition(node: HTMLElement) {
  requestAnimationFrame(() => {
    const trigger = node.parentElement;
    if (!trigger) return;

    const triggerRect = trigger.getBoundingClientRect();
    const dropdownHeight = node.offsetHeight;
    const dropdownWidth = node.offsetWidth;
    const margin = 4;
    const viewportH = window.innerHeight;
    const viewportW = window.innerWidth;

    // 垂直：下方空间不足且上方更宽裕则向上翻
    const spaceBelow = viewportH - triggerRect.bottom;
    const spaceAbove = triggerRect.top;
    if (spaceBelow < dropdownHeight + margin && spaceAbove > spaceBelow) {
      node.style.top = 'auto';
      node.style.bottom = '100%';
      node.style.marginTop = '0';
      node.style.marginBottom = margin + 'px';
    }

    // 水平：溢出右边界则切换为右对齐
    const leftEdge = triggerRect.left;
    if (leftEdge + dropdownWidth > viewportW) {
      node.style.left = 'auto';
      node.style.right = '0';
    }
  });

  return {};
}
