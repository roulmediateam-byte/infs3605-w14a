import { useSyncExternalStore } from 'react';

const subscribe = (listener: () => void): (() => void) => {
  window.addEventListener('online', listener);
  window.addEventListener('offline', listener);
  return () => {
    window.removeEventListener('online', listener);
    window.removeEventListener('offline', listener);
  };
};

/** False while the device reports no connection (NFR-11): buttons pause with "You're offline. Your place is saved." */
export const useOnline = (): boolean =>
  useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
