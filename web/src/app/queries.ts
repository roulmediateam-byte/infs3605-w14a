// Server state through TanStack Query (TRD, Web app). Every key starts with the business, so one call refreshes
// everything after an import, approval or payment (FR-13). Queues refresh when the app regains focus.
import { QueryCache, QueryClient, useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useRef, useState } from 'react';
import { AppError, MESSAGES, toAppError } from '../backend/errors.ts';
import type { DraftStatus } from '../backend/types.ts';
import { useBackend, useSession } from './session.tsx';

type SignedOutListener = () => void;
const signedOutListeners = new Set<SignedOutListener>();

export const onSignedOutError = (listener: SignedOutListener): (() => void) => {
  signedOutListeners.add(listener);
  return () => signedOutListeners.delete(listener);
};

export const createQueryClient = (): QueryClient =>
  new QueryClient({
    queryCache: new QueryCache({
      onError: (error) => {
        if (toAppError(error).kind === 'signed-out') signedOutListeners.forEach((listener) => listener());
      },
    }),
    defaultOptions: {
      queries: {
        staleTime: 15_000,
        retry: (count, error) => ['network', 'unknown'].includes(toAppError(error).kind) && count < 2,
        refetchOnWindowFocus: true,
      },
    },
  });

const useIds = () => {
  const { businessId } = useSession();
  return { businessId, enabled: Boolean(businessId) };
};

export const keys = {
  business: (businessId: string | null) => ['b', businessId] as const,
};

export const useBriefing = () => {
  const backend = useBackend();
  const { businessId, enabled } = useIds();
  return useQuery({ queryKey: ['b', businessId, 'briefing'], queryFn: () => backend.getBriefing(businessId as string), enabled });
};

export const useQueue = () => {
  const backend = useBackend();
  const { businessId, enabled } = useIds();
  return useQuery({ queryKey: ['b', businessId, 'queue'], queryFn: () => backend.reviewQueue(businessId as string), enabled, staleTime: 0 });
};

export const useBusinessRecord = () => {
  const backend = useBackend();
  const { businessId, enabled } = useIds();
  return useQuery({ queryKey: ['b', businessId, 'business'], queryFn: () => backend.business(businessId as string), enabled, staleTime: 60_000 });
};

export const useMembers = () => {
  const backend = useBackend();
  const { businessId, enabled } = useIds();
  return useQuery({ queryKey: ['b', businessId, 'members'], queryFn: () => backend.members(businessId as string), enabled, staleTime: 60_000 });
};

export const useInvoices = () => {
  const backend = useBackend();
  const { businessId, enabled } = useIds();
  return useQuery({ queryKey: ['b', businessId, 'invoices'], queryFn: () => backend.invoices(businessId as string), enabled });
};

export const useClients = () => {
  const backend = useBackend();
  const { businessId, enabled } = useIds();
  return useQuery({ queryKey: ['b', businessId, 'clients'], queryFn: () => backend.clients(businessId as string), enabled });
};

export const useDrafts = (statuses: DraftStatus[]) => {
  const backend = useBackend();
  const { businessId, enabled } = useIds();
  return useQuery({
    queryKey: ['b', businessId, 'drafts', statuses.join(',')],
    queryFn: () => backend.drafts(businessId as string, statuses),
    enabled,
  });
};

export const useOpenAttention = () => {
  const backend = useBackend();
  const { businessId, enabled } = useIds();
  return useQuery({ queryKey: ['b', businessId, 'attention'], queryFn: () => backend.openAttention(businessId as string), enabled });
};

export const useLastImport = () => {
  const backend = useBackend();
  const { businessId, enabled } = useIds();
  return useQuery({ queryKey: ['b', businessId, 'last-import'], queryFn: () => backend.lastImport(businessId as string), enabled });
};

export const useWeeklyRuns = (sinceDate: string) => {
  const backend = useBackend();
  const { businessId, enabled } = useIds();
  return useQuery({
    queryKey: ['b', businessId, 'weekly-runs', sinceDate],
    queryFn: () => backend.weeklyRuns(businessId as string, sinceDate),
    enabled,
    staleTime: 60_000,
  });
};

export const useTrustSummary = () => {
  const backend = useBackend();
  const { businessId, enabled } = useIds();
  return useQuery({ queryKey: ['b', businessId, 'trust'], queryFn: () => backend.getTrustSummary(businessId as string), enabled });
};

export const useRecordCounts = (enabled: boolean) => {
  const backend = useBackend();
  const { businessId } = useIds();
  return useQuery({
    queryKey: ['b', businessId, 'counts'],
    queryFn: () => backend.recordCounts(businessId as string),
    enabled: enabled && Boolean(businessId),
    staleTime: 0,
  });
};

const LOG_PAGE = 100;

export const useActivity = (invoiceId?: string) => {
  const backend = useBackend();
  const { businessId, enabled } = useIds();
  return useInfiniteQuery({
    queryKey: ['b', businessId, 'activity', invoiceId ?? 'all'],
    queryFn: ({ pageParam }) => backend.activity(businessId as string, { before: pageParam ?? undefined, limit: LOG_PAGE, invoiceId }),
    initialPageParam: null as number | null,
    getNextPageParam: (last) => (last.length < LOG_PAGE ? null : (last[last.length - 1]?.id ?? null)),
    enabled,
  });
};

export const useDraftRecord = (draftId: string | null) => {
  const backend = useBackend();
  const { businessId } = useIds();
  return useQuery({
    queryKey: ['b', businessId, 'draft', draftId],
    queryFn: () => backend.draft(draftId as string),
    enabled: Boolean(draftId && businessId),
    staleTime: 0,
  });
};

export type ActionResult<T> = { ok: true; value: T } | { ok: false; error: AppError };

/**
 * Runs one change against the server. It refuses while offline (an approval must reach the server to count, so
 * nothing is queued), ignores a second call while one is running, and refreshes the business's data afterwards.
 */
export const useAction = () => {
  const queryClient = useQueryClient();
  const { businessId, reportSignedOut } = useSession();
  const [busy, setBusy] = useState<string | null>(null);
  const running = useRef(false);

  const run = useCallback(
    async <T>(name: string, task: () => Promise<T>, options: { refresh?: 'none' | 'background' | 'wait' } = {}): Promise<ActionResult<T>> => {
      if (running.current) return { ok: false, error: new AppError('unknown', 'Still working on the last step.') };
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return { ok: false, error: new AppError('offline', MESSAGES.offline) };
      running.current = true;
      setBusy(name);
      try {
        const value = await task();
        const refresh = options.refresh ?? 'background';
        if (refresh !== 'none') {
          const done = queryClient.invalidateQueries({ queryKey: keys.business(businessId) });
          if (refresh === 'wait') await done;
        }
        return { ok: true, value };
      } catch (error) {
        const appError = toAppError(error);
        if (appError.kind === 'signed-out') reportSignedOut();
        return { ok: false, error: appError };
      } finally {
        running.current = false;
        setBusy(null);
      }
    },
    [queryClient, businessId, reportSignedOut],
  );

  return { run, busy };
};
