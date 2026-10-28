/** Internal capability; never persisted as part of user data. */
export const STORAGE_BRIDGE = Symbol.for('siyuan-things.storage');

export interface DataStore {
  loadData(name: string): Promise<any>;
  saveData(name: string, data: any): Promise<any>;
}

export interface StorageBridge {
  isNative(): boolean;
  writeFiles(files: Record<string, any[]>): Promise<void>;
}

export function usesNativeStorage(store: DataStore): boolean {
  return !!(store as any)[STORAGE_BRIDGE]?.isNative();
}

/** Moving a task between current/archive/trash must be one logical write. */
export async function saveFiles(store: DataStore, files: Record<string, any[]>): Promise<void> {
  const bridge: StorageBridge | undefined = (store as any)[STORAGE_BRIDGE];
  if (bridge) return bridge.writeFiles(files);
  for (const [name, data] of Object.entries(files)) await store.saveData(name, data);
}
