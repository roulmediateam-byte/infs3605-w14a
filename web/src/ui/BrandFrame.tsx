// The frame for sign-in, the preview's start-up and the screens around the signed-in app: the app's one brand
// moment. On a computer a panel in the brand gradient (blue to the apprentice's violet) sits beside the content, with
// the mark, the name and what the app does; on a phone it shrinks to a short header, so the form stays above the fold.
// On the gradient the mark is its white-tile version, so it stands out without a ring (docs/brand/README.md).
import type { ReactNode } from 'react';
import { AppMark } from './AppMark.tsx';

export const BrandFrame = ({ children }: { children: ReactNode }) => (
  <main className="sign-in" id="main">
    <div className="sign-in-brand">
      <div className="brand">
        <AppMark variant="inverse" detail />
        <span>Payprentice</span>
      </div>
      <div className="sign-in-pitch">
        <p>Approve and send the payment reminders your apprentice drafts each week.</p>
        <p>Nothing is sent until you approve and send it.</p>
      </div>
    </div>
    <div className="sign-in-body">{children}</div>
  </main>
);
