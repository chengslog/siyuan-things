/** One refresh glyph for settings, with the action kept available to assistive tools. */
export function setRefreshButton(button: HTMLButtonElement, label: string, busy = false): void {
  button.type = 'button';
  button.classList.add('things-settings__action-button', 'things-settings__refresh-button');
  button.title = label;
  button.setAttribute('aria-label', label);
  button.setAttribute('aria-busy', String(busy));
  if (!button.querySelector('svg')) {
    button.innerHTML = '<svg aria-hidden="true" focusable="false"><use xlink:href="#iconRefresh"></use></svg>';
  }
}
