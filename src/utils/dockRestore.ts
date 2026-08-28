export const ACTIVE_SYNC_DOCK_RESTORE_TTL = 10 * 60 * 1000;
export const POST_SYNC_DOCK_RESTORE_TTL = 5 * 1000;
export const DOCK_RESTORE_RETRY_DELAYS = [300, 800, 1600] as const;

interface DockRestoreIntent {
  expiresAt: number;
}

export function createDockRestoreIntent(now: number, ttl: number): string {
  return JSON.stringify({ expiresAt: now + ttl });
}

export function isDockRestoreIntentValid(raw: string | null, now: number): boolean {
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw) as Partial<DockRestoreIntent>;
    return typeof parsed.expiresAt === "number" && parsed.expiresAt > now;
  } catch {
    return false;
  }
}
