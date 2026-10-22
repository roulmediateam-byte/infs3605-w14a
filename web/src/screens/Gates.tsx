// Screens around the signed-in app: no business yet, choosing a business, a missing page and a load error.
import { config } from '../app/config.ts';
import { Link } from '../app/router.tsx';
import { useSession } from '../app/session.tsx';
import { BrandFrame } from '../ui/BrandFrame.tsx';
import { Button, ErrorPanel, PageTitle } from '../ui/controls.tsx';

const Frame = ({ children }: { children: React.ReactNode }) => (
  <BrandFrame>
    <div className="stack-lg">{children}</div>
  </BrandFrame>
);

/** Signed in, but no business: "Ask the owner to invite you, or contact the team" (FR-01). */
export const NoBusinessScreen = () => {
  const { user, signOut } = useSession();
  return (
    <Frame>
      <PageTitle documentTitle="No business yet">You're signed in, but not to a business yet</PageTitle>
      <p>
        Ask the owner to invite you, or contact the team. You're signed in as <strong>{user?.email}</strong>.
      </p>
      {config.supportEmail ? (
        <a className="btn btn-secondary" href={`mailto:${config.supportEmail}?subject=${encodeURIComponent('Get-Paid Apprentice: no business yet')}`}>
          Contact the team
        </a>
      ) : null}
      <Button variant="quiet" onClick={() => void signOut()}>
        Sign out
      </Button>
    </Frame>
  );
};

/** More than one business (a team admin, or a bookkeeper later): pick which one to act for. */
export const ChooseBusinessScreen = ({ names }: { names: Record<string, string> }) => {
  const { memberships, chooseBusiness, signOut } = useSession();
  return (
    <Frame>
      <PageTitle documentTitle="Choose a business">Choose a business</PageTitle>
      <ul className="menu">
        {memberships.map((m) => (
          <li key={m.business_id}>
            <button type="button" onClick={() => chooseBusiness(m.business_id)}>
              <span>
                <span className="list-title" style={{ display: 'block' }}>
                  {names[m.business_id] ?? 'Business'}
                </span>
                <span className="t-caption">{m.role === 'owner' ? 'Owner' : m.role === 'checker' ? 'Checker' : 'Team admin, Test data only'}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <Button variant="quiet" onClick={() => void signOut()}>
        Sign out
      </Button>
    </Frame>
  );
};

export const NotFoundScreen = () => (
  <div className="page stack">
    <PageTitle documentTitle="Page not found">This page isn't here</PageTitle>
    <p>The link may be old, or the screen isn't part of this version of the app.</p>
    <Link className="btn btn-primary" to="">
      Go to Home
    </Link>
  </div>
);

export const LoadErrorScreen = () => {
  const { loadError, retry, signOut } = useSession();
  return (
    <Frame>
      <PageTitle documentTitle="Couldn't load">Couldn't load your business</PageTitle>
      <ErrorPanel message={loadError ?? "Couldn't reach the server. Check your connection, then try again."} onRetry={retry} />
      <Button variant="quiet" onClick={() => void signOut()}>
        Sign out
      </Button>
    </Frame>
  );
};
