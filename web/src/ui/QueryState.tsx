// What a screen shows while a query has nothing to show yet. Offline, a request is paused rather than loading, so
// without this a list would wrongly say it is empty ("All caught up", "No clients yet"); instead it says the app is
// offline and offers Try again (App Flow, No signal on site; TRD, Web app: "Offline, the app says so").
import type { ReactNode } from 'react';
import { MESSAGES, toAppError } from '../backend/errors.ts';
import { ErrorPanel } from './controls.tsx';

export interface QueryLike {
  isError: boolean;
  error: unknown;
  fetchStatus: 'fetching' | 'paused' | 'idle';
  refetch: () => Promise<unknown>;
}

/** True while the query is waiting for a connection before it has any data. */
export const isPausedOffline = (query: Pick<QueryLike, 'fetchStatus'>): boolean => query.fetchStatus === 'paused';

/** Loading, waiting for a connection, or failed with "Try again": for a query that has no data yet. */
export const NoData = ({ query, loading, errorMessage }: { query: QueryLike; loading: ReactNode; errorMessage?: string }) => {
  if (query.isError) return <ErrorPanel message={errorMessage ?? toAppError(query.error).message} onRetry={() => void query.refetch()} />;
  if (isPausedOffline(query)) return <ErrorPanel message={MESSAGES.offlineNoData} onRetry={() => void query.refetch()} />;
  return <>{loading}</>;
};
