// Two things that can appear over any screen: the sign-in sheet when a session ends mid-task (typing the 6-digit code
// signs in without leaving the screen), and "Did it send?" for a draft whose question was left open by a reload.
import { useEffect, useState } from 'react';
import { CodeSignIn } from '../screens/SignIn.tsx';
import { openSendSheets, SendSheet } from '../screens/review/SendSheet.tsx';
import { pendingSends, setPendingSend } from '../lib/storage.ts';
import { NOT_SENT_YET } from '../lib/words.ts';
import { Button } from '../ui/controls.tsx';
import { Sheet } from '../ui/Sheet.tsx';
import { useMessages } from './messages.tsx';
import { useBackend, useSession } from './session.tsx';

export const SessionEndedSheet = () => {
  const { sessionEnded, user, signedIn, signOut } = useSession();
  if (!sessionEnded || !user) return null;
  return (
    <Sheet open onClose={() => undefined} title="Sign in again to carry on" dismissible={false} alert>
      <div className="stack">
        <p>Your session ended. Sign in with a code and you'll stay right here, with nothing lost.</p>
        <CodeSignIn lockedEmail={user.email} onSignedIn={(next) => signedIn(next)} />
        <Button variant="quiet" onClick={() => void signOut()}>
          Sign out instead
        </Button>
      </div>
    </Sheet>
  );
};

export const PendingSendPrompt = () => {
  const backend = useBackend();
  const { businessId, sessionEnded } = useSession();
  const { show } = useMessages();
  const [draftId, setDraftId] = useState<string | null>(null);
  const [checked, setChecked] = useState(0);

  useEffect(() => {
    if (!businessId || sessionEnded || draftId) return;
    let active = true;
    const ids = Object.keys(pendingSends()).filter((id) => !openSendSheets.has(id));
    const look = async () => {
      for (const id of ids) {
        try {
          const record = await backend.draft(id);
          if (!active) return;
          if (record && record.status === 'approved') {
            setDraftId(id);
            return;
          }
          setPendingSend(id, false);
        } catch {
          // Try again on the next load; the question stays saved.
          return;
        }
      }
    };
    void look();
    return () => {
      active = false;
    };
  }, [backend, businessId, sessionEnded, draftId, checked]);

  if (!draftId) return null;
  return (
    <SendSheet
      draftId={draftId}
      onClose={() => setDraftId(null)}
      onDone={(outcome) => {
        setDraftId(null);
        setChecked((n) => n + 1);
        show(outcome === 'sent' ? { text: 'Sent.' } : { text: NOT_SENT_YET, tone: 'info' });
      }}
    />
  );
};
