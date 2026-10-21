import { afterEach, describe, expect, it, vi } from 'vitest';
import { fingerprint, forgetPreviewKeys, holdStorageLock, PREVIEW_KEYS, readSavedSession, saveSession } from './preview-store.ts';

/** A stand-in for window.localStorage, as a plain map. */
const fakeStorage = (entries: Record<string, string> = {}) => {
  const map = new Map(Object.entries(entries));
  return {
    map,
    get length() {
      return map.size;
    },
    key: (index: number) => [...map.keys()][index] ?? null,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, String(value)),
    removeItem: (key: string) => void map.delete(key),
  };
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('preview fingerprint', () => {
  const sql = ['create table a (id int);', 'insert into a values (1);'];

  it('is the same for the same SQL, as 16 hex characters', () => {
    expect(fingerprint(sql)).toBe(fingerprint([...sql]));
    expect(fingerprint(sql)).toMatch(/^[0-9a-f]{16}$/);
  });

  it('changes when any character of the SQL changes', () => {
    const base = fingerprint(sql);
    expect(fingerprint(['create table a (id int);', 'insert into a values (2);'])).not.toBe(base);
    expect(fingerprint(['create table a (id int); ', 'insert into a values (1);'])).not.toBe(base);
    expect(fingerprint([...sql, ''])).not.toBe(base);
  });

  it('changes when the order of the files changes', () => {
    expect(fingerprint(['a', 'b'])).not.toBe(fingerprint(['b', 'a']));
  });

  it('tells apart where one file ends and the next begins', () => {
    expect(fingerprint(['ab', 'c'])).not.toBe(fingerprint(['a', 'bc']));
    expect(fingerprint(['abc'])).not.toBe(fingerprint(['ab', 'c']));
  });

  it('gives a different answer for each of many similar inputs', () => {
    const seen = new Set(Array.from({ length: 2000 }, (_, i) => fingerprint([`select ${i};`])));
    expect(seen.size).toBe(2000);
  });
});

describe('preview session and keys', () => {
  it('keeps the signed-in Test person, and reads back only a well-formed record', () => {
    const storage = fakeStorage();
    vi.stubGlobal('window', { localStorage: storage });
    expect(readSavedSession()).toBeNull();
    saveSession({ id: '7d1f0000-0000-4000-8000-000000000001', email: 'owner@example.test' });
    expect(storage.getItem('gpa.preview.session')).not.toBeNull();
    expect(readSavedSession()).toEqual({ id: '7d1f0000-0000-4000-8000-000000000001', email: 'owner@example.test' });
    storage.setItem('gpa.preview.session', '{"id": 42}');
    expect(readSavedSession()).toBeNull();
    storage.setItem('gpa.preview.session', 'not json');
    expect(readSavedSession()).toBeNull();
    saveSession(null);
    expect(storage.getItem('gpa.preview.session')).toBeNull();
  });

  it('works without storage: nothing is kept and nothing throws', () => {
    vi.stubGlobal('window', {
      get localStorage(): never {
        throw new DOMException('Blocked', 'SecurityError');
      },
    });
    expect(() => saveSession({ id: 'x', email: 'owner@example.test' })).not.toThrow();
    expect(readSavedSession()).toBeNull();
    expect(() => forgetPreviewKeys()).not.toThrow();
  });

  it('Reset forgets the preview and the people in it, and keeps the device settings', () => {
    const storage = fakeStorage({
      'gpa.preview.session': '{}',
      [`gpa.${PREVIEW_KEYS.demoGuideHidden}`]: 'yes',
      'gpa.pendingSends.7d1f0000-0000-4000-8000-000000000001': '{"d1":1}',
      'gpa.signInEmail': 'owner@example.test',
      'gpa.business': '0d5e0000-0000-4000-8000-000000000001',
      'gpa.nextAfterSignIn': 'review',
      'gpa.shortcuts': 'on',
      'gpa.fromLineTipSeen': '1',
      'something.else': 'kept',
    });
    vi.stubGlobal('window', { localStorage: storage });
    forgetPreviewKeys();
    expect([...storage.map.keys()].sort()).toEqual(['gpa.fromLineTipSeen', 'gpa.shortcuts', 'something.else']);
  });
});

describe('one tab keeps the data', () => {
  it('carries on without the lock where the browser has no Web Locks', async () => {
    vi.stubGlobal('navigator', {});
    expect((await holdStorageLock(50)).state).toBe('unsupported');
  });

  it('is granted when no other tab holds it, and held until released', async () => {
    let held: Promise<void> | undefined;
    const request = vi.fn((_name: string, _options: unknown, callback: () => Promise<void>) => {
      held = callback();
      return held;
    });
    vi.stubGlobal('navigator', { locks: { request } });
    const lock = await holdStorageLock(50);
    expect(lock.state).toBe('granted');
    expect(request).toHaveBeenCalledTimes(1);
    let released = false;
    void held?.then(() => {
      released = true;
    });
    await Promise.resolve();
    expect(released).toBe(false);
    lock.release();
    await held;
    expect(released).toBe(true);
  });

  it('gives up after the wait while another tab holds it', async () => {
    const request = (_name: string, options: { signal: AbortSignal }) =>
      new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))));
    vi.stubGlobal('navigator', { locks: { request } });
    expect((await holdStorageLock(20)).state).toBe('busy');
  });
});
