import { tick } from 'svelte';

/** Measure after Svelte applies values and width, before the next paint. */
export function autoSizeTextarea(node: HTMLTextAreaElement) {
  let alive = true;
  let width = 0;
  const resize = () => {
    if (!alive || !node.isConnected) return;
    const scrollTop = node.scrollTop;
    const overflow = node.style.overflowY;
    node.style.overflowY = 'hidden';
    node.style.height = '0px';
    const style = getComputedStyle(node);
    const borders = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
    const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    node.style.height = `${node.scrollHeight + (style.boxSizing === 'border-box' ? borders : -padding)}px`;
    node.style.overflowY = overflow;
    node.scrollTop = scrollTop;
  };
  const measure = () => { void tick().then(resize); };
  const observer = new ResizeObserver(entries => {
    const next = entries[0]?.contentRect.width ?? 0;
    if (next && next !== width) { width = next; resize(); }
  });
  observer.observe(node);
  node.addEventListener('input', resize);
  measure();
  return {
    update: measure,
    destroy() { alive = false; observer.disconnect(); node.removeEventListener('input', resize); },
  };
}
