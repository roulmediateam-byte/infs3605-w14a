// Who is signed in, which business they are acting for and in which role (FR-01, FR-25). After every sign-in the
// app calls accept_invitations, which activates any invitation for the email and returns the person's businesses.
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { MESSAGES, toAppError } from '../backend/errors.ts';
import type { AuthUser, Backend, Membership, Role } from '../backend/types.ts';
import { forgetPerson, KEYS, readItem, setStoragePerson, writeItem } from '../lib/storage.ts';
import { currentLocation, navigate } from './router.tsx';

const BackendContext = createContext<Backend | null>(null);

export const BackendProvider = ({ backend, children }: { backend: Backend; children: ReactNode }) => (
  <BackendContext.Provider value={backend}>{children}</BackendContext.Provider>
);

export const useBackend = (): Backend => {
  const backend = useContext(BackendContext);
  if (!backend) throw new Error('useBackend needs BackendProvider');
  return backend;
};

export type SessionStatus = 'loading' | 'signed-out' | 'signed-in' | 'error';

export interface SessionValue {
  status: SessionStatus;
  user: AuthUser | null;
  memberships: Membership[];
  businessId: string | null;
  role: Role | null;
  /** The session ended without the person signing out: a sign-in sheet covers the screen (App Flow, Journey 2). */
  sessionEnded: boolean;
  /** A one-off line for the sign-in screen, such as the message after deleting the business. */
  notice: string | null;
  loadError: string | null;
  chooseBusiness: (businessId: string) => void;
  signOut: (notice?: string) => Promise<void>;
  /** Call after a successful code sign-in (on the sign-in screen or in the session sheet). */
  signedIn: (user: AuthUser) => Promise<void>;
  reportSignedOut: () => void;
  retry: () => void;
}

const SessionContext = createContext<SessionValue | null>(null);

export const useSession = (): SessionValue => {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession needs SessionProvider');
  return value;
};

/** The business and role for screens that only render once both are known. */
export const useBusiness = (): { businessId: string; role: Role; user: AuthUser } => {
  const { businessId, role, user } = useSession();
  if (!businessId || !role || !user) throw new Error('useBusiness used before a business was chosen');
  return { businessId, role, user };
};

const pickBusiness = (memberships: Membership[]): string | null => {
  const remembered = readItem(KEYS.business);
  if (remembered && memberships.some((m) => m.business_id === remembered)) return remembered;
  return memberships.length === 1 ? (memberships[0]?.business_id ?? null) : null;
};

export const SessionProvider = ({ children }: { children: ReactNode }) => {
  const backend = useBackend();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<SessionStatus>('loading');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [sessionEnded, setSessionEnded] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const signingOut = useRef(false);
  const userRef = useRef<AuthUser | null>(null);
  const inFlight = useRef<{ userId: string; promise: Promise<void> } | null>(null);

  const load = useCallback(
    async (signedInUser: AuthUser): Promise<void> => {
      try {
        let list = await backend.acceptInvitations();
        // The demonstration build's sign-up: an account made there gets its Test data business if it has none (its
        // first try didn't finish, or the owner deleted it in Settings). Any other account waits for an invitation.
        if (list.length === 0 && backend.ensureDemoBusiness && (await backend.ensureDemoBusiness())) {
          list = await backend.acceptInvitations();
        }
        setStoragePerson(signedInUser.id);
        userRef.current = signedInUser;
        setUser(signedInUser);
        setMemberships(list);
        setBusinessId((current) => (current && list.some((m) => m.business_id === current) ? current : pickBusiness(list)));
        setSessionEnded(false);
        setLoadError(null);
        setStatus('signed-in');
      } catch (error) {
        const appError = toAppError(error);
        if (appError.kind === 'signed-out') {
          userRef.current = null;
          setUser(null);
          setStatus('signed-out');
          return;
        }
        setLoadError(appError.message);
        setStatus('error');
      }
    },
    [backend],
  );

  const loadMemberships = useCallback(
    (signedInUser: AuthUser): Promise<void> => {
      // The sign-in screen and the auth listener can both report the same sign-in; ask the server once.
      if (inFlight.current?.userId === signedInUser.id) return inFlight.current.promise;
      const promise = load(signedInUser).finally(() => {
        if (inFlight.current?.promise === promise) inFlight.current = null;
      });
      inFlight.current = { userId: signedInUser.id, promise };
      return promise;
    },
    [load],
  );

  useEffect(() => {
    let active = true;
    backend.auth.currentUser().then(
      (current) => {
        if (!active) return;
        if (current) void loadMemberships(current);
        else setStatus('signed-out');
      },
      (error: unknown) => {
        // Offline with a session that needs refreshing: say so, with Try again, rather than asking for a code that
        // can't arrive (TRD, Web app: "Offline, the app says so").
        if (!active) return;
        const appError = toAppError(error);
        setLoadError(appError.kind === 'offline' ? MESSAGES.offlineNoData : appError.message);
        setStatus('error');
      },
    );
    const unsubscribe = backend.auth.onChange((event, changed) => {
      // Supabase advises doing no other calls inside this callback, so the work waits a tick.
      window.setTimeout(() => {
        if (!active) return;
        if (event === 'SIGNED_OUT') {
          if (signingOut.current || !userRef.current) {
            userRef.current = null;
            setUser(null);
            setStatus('signed-out');
          } else {
            setSessionEnded(true);
          }
        } else if (event === 'SIGNED_IN' && changed && changed.id !== userRef.current?.id) {
          void loadMemberships(changed);
        }
      }, 0);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [backend, loadMemberships, attempt]);

  // "Switch business" (More) opens the chooser with ?choose=1: choosing lands on that business's Home. At first
  // sign-in the chooser comes up wherever the person was going, and they carry on there.
  const chooseBusiness = useCallback((id: string) => {
    writeItem(KEYS.business, id);
    setBusinessId(id);
    if (currentLocation().params.get('choose') === '1') navigate('', { replace: true });
  }, []);

  const signOut = useCallback(
    async (message?: string) => {
      signingOut.current = true;
      try {
        await backend.auth.signOut();
      } catch {
        // The adapter forgets the session on this device before anything else, so this is only the server's part.
      } finally {
        signingOut.current = false;
        // A deliberate sign-out forgets the person on this device and starts again at sign-in, not where they were
        // (shared phones; App Flow, Navigation map: Home opens after sign-in).
        forgetPerson();
        navigate('sign-in', { replace: true });
        userRef.current = null;
        queryClient.clear();
        setUser(null);
        setMemberships([]);
        setBusinessId(null);
        setSessionEnded(false);
        setNotice(message ?? null);
        setStatus('signed-out');
      }
    },
    [backend, queryClient],
  );

  const signedIn = useCallback(
    async (signedInUser: AuthUser) => {
      const sameUser = userRef.current?.id === signedInUser.id;
      setNotice(null);
      await loadMemberships(signedInUser);
      // Back from an ended session: refetch everything the screen showed.
      if (sameUser) await queryClient.invalidateQueries();
    },
    [loadMemberships, queryClient],
  );

  const reportSignedOut = useCallback(() => {
    if (userRef.current && !signingOut.current) setSessionEnded(true);
  }, []);

  const retry = useCallback(() => {
    setStatus('loading');
    setAttempt((n) => n + 1);
  }, []);

  const role = useMemo(() => memberships.find((m) => m.business_id === businessId)?.role ?? null, [memberships, businessId]);

  const value = useMemo<SessionValue>(
    () => ({
      status,
      user,
      memberships,
      businessId,
      role,
      sessionEnded,
      notice,
      loadError,
      chooseBusiness,
      signOut,
      signedIn,
      reportSignedOut,
      retry,
    }),
    [status, user, memberships, businessId, role, sessionEnded, notice, loadError, chooseBusiness, signOut, signedIn, reportSignedOut, retry],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
};
