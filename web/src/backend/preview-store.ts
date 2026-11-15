// What the in-browser preview keeps in this browser between visits (src/backend/preview.ts):
//   * the demo's database: PGlite's data directory in IndexedDB, with a fingerprint of the SQL it was built from;
//   * the Test person who is signed in, as the real app keeps its session;
//   * the preview's own conveniences, such as the hidden demo guide.
// Browser storage can be missing or throw (private windows, blocked site data), so every use here is guarded, and the
// preview then runs in memory, where a reload starts again. Only one tab at a time keeps the data (holdStorageLock).
import { KEYS, readItem, writeItem } from '../lib/storage.ts';

/** PGlite's data directory in IndexedDB. Emscripten names the IndexedDB database after its mount point. */
export const STORE_NAME = 'get-paid-apprentice-preview';
export const STORE_DATA_DIR = `idb://${STORE_NAME}`;
export const STORE_DATABASE = `/pglite/${STORE_NAME}`;

/** The preview's keys, under lib/storage.ts's "gpa." prefix: "gpa.preview.session" and so on. */
export const PREVIEW_KEYS = {
  session: 'preview.session',
  demoGuideHidden: 'preview.demoGuideHidden',
} as const;

const STORAGE_PREFIX = 'gpa.';

/**
 * A short fingerprint of the text that shapes the stored database: the SQL the preview runs and the engine's files.
 * It only has to change when any of that changes (cyrb53-style mixing; not for security). Each part ends with a
 * marker above any UTF-16 code unit, so ["ab", "c"] and ["a", "bc"] differ.
 */
export const fingerprint = (parts: readonly string[]): string => {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  const mix = (code: number) => {
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  };
  for (const part of parts) {
    for (let i = 0; i < part.length; i += 1) mix(part.charCodeAt(i));
    mix(0x10000 + part.length);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
};

export interface StorageLock {
  state: 'granted' | 'busy' | 'unsupported';
  /** Lets another tab keep the data, when this one turns out not to. */
  release: () => void;
}

/**
 * Only one tab may keep the demo's data. Each tab works on its own copy in memory and saves all of it, so a second
 * tab would write its older copy over the first one's changes. The first tab holds this lock until it closes; a
 * later tab runs in memory. It waits a moment, because a reloading tab lets go of the lock as the new page starts.
 */
export const holdStorageLock = (waitMs: number): Promise<StorageLock> =>
  new Promise((resolve) => {
    const nothing = () => undefined;
    const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
    if (!locks || typeof locks.request !== 'function') {
      resolve({ state: 'unsupported', release: nothing });
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), waitMs);
    locks
      .request(`${STORE_NAME}:data`, { signal: controller.signal }, () => {
        clearTimeout(timer);
        // Held until the page closes, or until released.
        return new Promise<void>((release) => resolve({ state: 'granted', release: () => release() }));
      })
      .catch((error: unknown) => {
        clearTimeout(timer);
        resolve({ state: error instanceof DOMException && error.name === 'AbortError' ? 'busy' : 'unsupported', release: nothing });
      });
  });

/** Whether IndexedDB opens at all in this browser, within `waitMs` (it can be missing, throw, or never answer). */
export const indexedDbWorks = (waitMs: number): Promise<boolean> =>
  new Promise((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      if (typeof indexedDB === 'undefined') {
        resolve(false);
        return;
      }
      request = indexedDB.open(STORE_DATABASE);
    } catch {
      resolve(false);
      return;
    }
    const timer = setTimeout(() => resolve(false), waitMs);
    request.onsuccess = () => {
      clearTimeout(timer);
      request.result.close();
      resolve(true);
    };
    request.onerror = () => {
      clearTimeout(timer);
      resolve(false);
    };
  });

/** Whether this browser already holds a copy of the demo. Only for the loading screen's words; false if unsure. */
export const storedCopyExists = async (): Promise<boolean> => {
  try {
    if (typeof indexedDB === 'undefined' || typeof indexedDB.databases !== 'function') return false;
    return (await indexedDB.databases()).some((info) => info.name === STORE_DATABASE);
  } catch {
    return false;
  }
};

/** Deletes the stored copy of the demo. False if the browser refused, or was still busy after `waitMs`. */
export const deleteStoredCopy = (waitMs: number): Promise<boolean> =>
  new Promise((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      if (typeof indexedDB === 'undefined') {
        resolve(true);
        return;
      }
      request = indexedDB.deleteDatabase(STORE_DATABASE);
    } catch {
      resolve(false);
      return;
    }
    const timer = setTimeout(() => resolve(false), waitMs);
    request.onsuccess = () => {
      clearTimeout(timer);
      resolve(true);
    };
    request.onerror = () => {
      clearTimeout(timer);
      resolve(false);
    };
  });

export interface SavedSession {
  id: string;
  email: string;
}

/** The Test person signed in on this device, as saved at sign-in; null if none or unreadable. */
export const readSavedSession = (): SavedSession | null => {
  const raw = readItem(PREVIEW_KEYS.session);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<SavedSession> | null;
    return value && typeof value.id === 'string' && typeof value.email === 'string' ? { id: value.id, email: value.email } : null;
  } catch {
    return null;
  }
};

export const saveSession = (session: SavedSession | null): void =>
  writeItem(PREVIEW_KEYS.session, session ? JSON.stringify({ id: session.id, email: session.email }) : null);

/**
 * Reset: forget the preview's own keys ("gpa.preview.…") and what the app keeps about the people who signed in,
 * whose records the reset deletes. The device's own settings (keyboard shortcuts, tips seen) stay.
 */
export const forgetPreviewKeys = (): void => {
  try {
    const storage = window.localStorage;
    const doomed: string[] = [];
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (key && (key.startsWith(`${STORAGE_PREFIX}preview.`) || key.startsWith(`${STORAGE_PREFIX}${KEYS.pendingSends}`))) doomed.push(key);
    }
    for (const key of doomed) storage.removeItem(key);
  } catch {
    // Storage is unavailable, so nothing was kept.
  }
  for (const key of [KEYS.signInEmail, KEYS.business, KEYS.nextAfterSignIn]) writeItem(key, null);
};
