const store = new Map<string, number>(); // key: `${userId}:${serviceName}`

let globalCooldownMs = parseInt(process.env.COOLDOWN_SECONDS ?? "600", 10) * 1000;

export function getRemainingMs(
  userId: string,
  serviceName: string,
  serviceMinutes: number | null
): number {
  const key = `${userId}:${serviceName}`;
  const last = store.get(key) ?? 0;
  const durationMs =
    serviceMinutes !== null
      ? serviceMinutes * 60 * 1000
      : globalCooldownMs;
  const remaining = last + durationMs - Date.now();
  return remaining > 0 ? remaining : 0;
}

export function setCooldown(userId: string, serviceName: string): void {
  store.set(`${userId}:${serviceName}`, Date.now());
}

export function resetUserCooldown(userId: string): void {
  for (const key of store.keys()) {
    if (key.startsWith(`${userId}:`)) {
      store.delete(key);
    }
  }
}

export function setGlobalCooldownDuration(minutes: number): void {
  globalCooldownMs = minutes * 60 * 1000;
}

export function getGlobalCooldownMinutes(): number {
  return Math.round(globalCooldownMs / 60 / 1000);
}

export function formatTime(ms: number): string {
  const totalSecs = Math.ceil(ms / 1000);
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  if (mins > 0 && secs > 0) return `${mins}m ${secs}s`;
  if (mins > 0) return `${mins}m`;
  return `${secs}s`;
}
