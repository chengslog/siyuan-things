import { mobileSort } from './mobileSort';

type Drop = { group: string; id: string; beforeId: string | null };

export function touchSort(node: HTMLElement, onDrop: (drop: Drop) => void) {
  const parents = new Set([...node.querySelectorAll<HTMLElement>('[data-sort-id]')].map(row => row.parentElement!));
  node.querySelectorAll<HTMLElement>('.mobile-things__section').forEach(section => parents.add(section));
  const actions = [...parents].map(parent => mobileSort(parent, {
    canMove: (dragged, related) => dragged.dataset.sortGroup === related.dataset.sortGroup,
    onDrop: drop => {
      const row = [...parent.querySelectorAll<HTMLElement>('[data-sort-id]')].find(item => item.dataset.sortId === drop.id);
      if (row) onDrop({ group: row.dataset.sortGroup!, id: drop.id, beforeId: drop.beforeId });
    },
  }));
  return { destroy() { actions.forEach(action => action.destroy()); } };
}
