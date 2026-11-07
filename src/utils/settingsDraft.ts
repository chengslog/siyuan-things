import { saveAISettings, type AISettingsStore } from './aiSettings.ts';

/** A category keeps its own draft. Only explicitly saved edits reach the store. */
export function createSettingsDraft(settings: AISettingsStore, keys: string[]) {
  const baseline = new Map(keys.map(key => [key, settings.get(key)]));
  const current = new Map(baseline);
  return {
    get(key: string) { return current.get(key); },
    set(key: string, value: unknown) {
      if (!current.has(key)) throw new Error('Unknown settings field');
      current.set(key, value);
    },
    async save() {
      const changes = Object.fromEntries([...current].filter(([key, value]) => !Object.is(baseline.get(key), value)));
      if (!Object.keys(changes).length) return changes;
      await saveAISettings(settings, changes);
      for (const [key, value] of Object.entries(changes)) baseline.set(key, value);
      return changes;
    },
  };
}
