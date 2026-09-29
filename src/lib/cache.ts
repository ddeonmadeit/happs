/**
 * Tiny stale-while-revalidate cache: screens show what they had last time
 * straight away, then refresh. In memory, plus localStorage for things worth
 * having on the next launch.
 */
const memory = new Map<string, unknown>();

export function readCache<T>(key: string, { persist = false } = {}): T | undefined {
  if (memory.has(key)) return memory.get(key) as T;
  if (!persist) return undefined;
  try {
    const raw = localStorage.getItem(`happs:cache:${key}`);
    if (!raw) return undefined;
    const value = JSON.parse(raw) as T;
    memory.set(key, value);
    return value;
  } catch {
    return undefined;
  }
}

export function writeCache<T>(key: string, value: T, { persist = false } = {}) {
  memory.set(key, value);
  if (!persist) return;
  try {
    localStorage.setItem(`happs:cache:${key}`, JSON.stringify(value));
  } catch {
    // storage full or unavailable
  }
}

export function forgetCache(key: string) {
  memory.delete(key);
  try {
    localStorage.removeItem(`happs:cache:${key}`);
  } catch {
    // storage unavailable
  }
}
