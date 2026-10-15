import { useCallback, useEffect, useRef } from 'react';

const EMAIL_TRIP_LIMIT_MS = 120_000;

/**
 * Review time (App Flow, Analytics): the clock runs while the app is on screen, plus up to 2 minutes for each trip
 * to the email app after "Send from my email", so a coffee break doesn't count.
 */
export const useReviewClock = (): (() => number) => {
  const visibleMs = useRef(0);
  const visibleSince = useRef<number | null>(typeof document !== 'undefined' && document.visibilityState === 'visible' ? performance.now() : null);
  const hiddenAt = useRef<number | null>(null);
  const tripPending = useRef(false);

  useEffect(() => {
    const onVisibility = () => {
      const now = performance.now();
      if (document.visibilityState === 'hidden') {
        if (visibleSince.current !== null) visibleMs.current += now - visibleSince.current;
        visibleSince.current = null;
        hiddenAt.current = now;
      } else {
        if (hiddenAt.current !== null && tripPending.current) visibleMs.current += Math.min(now - hiddenAt.current, EMAIL_TRIP_LIMIT_MS);
        tripPending.current = false;
        hiddenAt.current = null;
        visibleSince.current = now;
      }
    };
    const onTrip = () => {
      tripPending.current = true;
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('gpa:email-trip', onTrip);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('gpa:email-trip', onTrip);
    };
  }, []);

  return useCallback(() => {
    const running = visibleSince.current !== null ? performance.now() - visibleSince.current : 0;
    return Math.round((visibleMs.current + running) / 1000);
  }, []);
};
