import { Dialog } from 'siyuan';
import type { DiscoveryOptions } from './discovery.ts';

export const chooseStorageLocation: NonNullable<DiscoveryOptions['choose']> = (kind, choices) => new Promise((resolve, reject) => {
  let settled = false;
  const dialog = new Dialog({
    title: kind === 'database' ? '选择已有 Things 数据中心' : '选择数据库笔记本', width: '520px',
    content: '<div class="b3-dialog__content"><p data-help></p><select class="b3-select" style="width:100%" aria-label="数据位置"></select></div><div class="b3-dialog__action"><button class="b3-button" data-use>使用所选位置</button></div>',
    destroyCallback() { if (!settled) reject(new Error('尚未选择数据位置，原数据已保留；请刷新重试')); },
  });
  dialog.element.querySelector('[data-help]')!.textContent = '检测到多个候选位置。请选择本次使用的数据，其他数据会保留，不会合并或覆盖。';
  const select = dialog.element.querySelector('select')!;
  for (const choice of choices) {
    const option = document.createElement('option'); option.value = choice.id; option.textContent = choice.label; select.append(option);
  }
  dialog.element.querySelector('[data-use]')!.addEventListener('click', () => { settled = true; resolve(select.value); dialog.destroy(); });
});
