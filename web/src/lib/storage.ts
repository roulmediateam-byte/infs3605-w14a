// Small per-device conveniences in localStorage, never business data (TRD, Web app):
//   * about the person signed in, all forgotten when they sign out (forgetPerson): the email they sign in with, the
//     business they chose, where they were going when sign-in interrupted them, and any "Did it send?" question
//     still open, which is kept per person so nobody else who signs in on the device is asked it;
//   * about the device, kept: the keyboard shortcuts switch and whether the From-line tip was seen.
// supabase-js keeps the sign-in session itself under "gpa.auth.<project host>" (src/backend/supabase.ts). Storage can be missing or
// throw (private windows, blocked site data), so every read and write is guarded and the app works without it.

const PREFIX = 'gpa.';

export const readItem = (key: string): string | null => {
  try {
    return window.localStorage.getItem(PREFIX + key);
  } catch {
    return null;
  }
};

export const writeItem = (key: string, value: string | null): void => {
  try {
    if (value === null) window.localStorage.removeItem(PREFIX + key);
    else window.localStorage.setItem(PREFIX + key, value);
  } catch {
    // Storage is unavailable; the app carries on without remembering.
  }
};

export const readJson = <T>(key: string, fallback: T): T => {
  const raw = readItem(key);
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

export const writeJson = (key: string, value: unknown): void => writeItem(key, JSON.stringify(value));

export const KEYS = {
  business: 'business',
  shortcuts: 'shortcuts',
  fromLineTipSeen: 'fromLineTipSeen',
  pendingSends: 'pendingSends',
  signInEmail: 'signInEmail',
  nextAfterSignIn: 'nextAfterSignIn',
} as const;

let person: string | null = null;

/** Whose questions pendingSends reads and writes: the signed-in person's user id, or null when nobody is signed in. */
export const setStoragePerson = (userId: string | null): void => {
  person = userId;
};

const pendingKey = (): string | null => (person ? `${KEYS.pendingSends}.${person}` : null);

/** The signed-in person's drafts whose "Did it send?" question is still open, by draft id, with when Send was tapped. */
export const pendingSends = (): Record<string, number> => {
  const key = pendingKey();
  return key ? readJson<Record<string, number>>(key, {}) : {};
};

export const setPendingSend = (draftId: string, pending: boolean): void => {
  const key = pendingKey();
  if (!key) return;
  const all = pendingSends();
  if (pending) all[draftId] = Date.now();
  else delete all[draftId];
  writeJson(key, all);
};

/** A deliberate sign-out: forget everything about the person on this device, and keep the device's own settings. */
export const forgetPerson = (): void => {
  const key = pendingKey();
  if (key) writeItem(key, null);
  for (const item of [KEYS.signInEmail, KEYS.business, KEYS.nextAfterSignIn, KEYS.pendingSends]) writeItem(item, null);
  person = null;
};
