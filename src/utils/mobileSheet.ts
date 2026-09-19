// Native dialog provides a screen-level modal, independent of card/scroll geometry.
export function mobileSheet(node: HTMLElement, onClose: () => void) {
  const previousFocus = document.activeElement as HTMLElement | null;
  const dialog = document.createElement('dialog');
  dialog.className = 'things-mobile-sheet task-card__dropdown';
  dialog.setAttribute('data-prevent-swipe', 'true');
  dialog.setAttribute('aria-label', '编辑任务属性');
  const header = document.createElement('header');
  const title = document.createElement('strong');
  title.textContent = node.parentElement?.querySelector('button')?.getAttribute('title') || '编辑任务属性';
  const done = document.createElement('button');
  done.type = 'button';
  done.textContent = '完成';
  done.addEventListener('click', onClose);
  header.append(title, done);
  dialog.append(header, node);
  document.body.append(dialog);
  node.style.cssText = 'position:relative; inset:auto; width:100%; max-width:100%; margin:0; box-shadow:none; border:0; box-sizing:border-box;';
  const cancel = (event: Event) => { event.preventDefault(); onClose(); };
  dialog.addEventListener('cancel', cancel);
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientY < rect.top || event.clientX < rect.left || event.clientX > rect.right) onClose();
  });
  const place = () => {
    const viewport = window.visualViewport;
    dialog.style.bottom = `${Math.max(0, innerHeight - (viewport ? viewport.offsetTop + viewport.height : innerHeight))}px`;
    dialog.style.maxHeight = `${(viewport?.height || innerHeight) * .85}px`;
  };
  place();
  dialog.showModal();
  window.visualViewport?.addEventListener('resize', place);
  window.visualViewport?.addEventListener('scroll', place);
  return { destroy() {
    window.visualViewport?.removeEventListener('resize', place);
    window.visualViewport?.removeEventListener('scroll', place);
    dialog.close();
    node.remove();
    dialog.remove();
    if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
  } };
}
