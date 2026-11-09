/**
 * Versioned JSON saves in `localStorage`. Reads never throw: a missing, corrupt or
 * unavailable store (private browsing, blocked site data) falls back to defaults.
 */

export interface Storage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface SaveSchema<T> {
  readonly key: string;
  readonly version: number;
  defaults(): T;
  /** Upgrades data saved by an older version; return null to discard it. */
  migrate(data: unknown, fromVersion: number): T | null;
}

interface Envelope {
  readonly version: number;
  readonly data: unknown;
}

function isEnvelope(value: unknown): value is Envelope {
  return (
    typeof value === 'object' &&
    value !== null &&
    'version' in value &&
    typeof value.version === 'number' &&
    'data' in value
  );
}

/** Loads saved data, migrating older versions and filling gaps from the defaults. */
export function load<T extends object>(schema: SaveSchema<T>, storage: Storage | null): T {
  const defaults = schema.defaults();
  if (!storage) return defaults;
  try {
    const raw = storage.getItem(schema.key);
    if (raw === null) return defaults;
    const parsed: unknown = JSON.parse(raw);
    if (!isEnvelope(parsed)) return defaults;
    const data =
      parsed.version === schema.version
        ? (parsed.data as Partial<T>)
        : schema.migrate(parsed.data, parsed.version);
    if (!data || typeof data !== 'object') return defaults;
    return { ...defaults, ...data };
  } catch {
    return defaults;
  }
}

/** Saves data; returns false if the store refused it. */
export function save<T>(schema: SaveSchema<T>, storage: Storage | null, data: T): boolean {
  if (!storage) return false;
  try {
    const envelope: Envelope = { version: schema.version, data };
    storage.setItem(schema.key, JSON.stringify(envelope));
    return true;
  } catch {
    return false;
  }
}

/** The browser's localStorage, or null where it is unavailable. */
export function browserStorage(): Storage | null {
  try {
    const probe = '__clearway_probe__';
    window.localStorage.setItem(probe, probe);
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    return null;
  }
}
