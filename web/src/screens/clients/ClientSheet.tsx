// A client's sheet (UI-09): fix a missing or wrong email (owner or checker; FR-10), set the tone (owner; FR-23) and
// pause or resume reminders (owner; FR-26, BR-11). Pausing asks once and says what it cancels. The checker sees the
// tone as a plain chip, and pausing is hidden rather than greyed out (App Flow, Journey 3).
import { useMemo, useRef, useState } from 'react';
import { useMessages } from '../../app/messages.tsx';
import { useOnline } from '../../app/online.ts';
import { useAction, useClients, useDrafts, useInvoices } from '../../app/queries.ts';
import { useBackend, useBusiness } from '../../app/session.tsx';
import type { Tone } from '../../backend/types.ts';
import { pluralise, TONE_LABEL } from '../../lib/words.ts';
import { Button, Chip, Choices, ErrorPanel, FormError, Skeleton, TextField } from '../../ui/controls.tsx';
import { NoData } from '../../ui/QueryState.tsx';
import { Sheet } from '../../ui/Sheet.tsx';

const TONES: { value: Tone; label: string }[] = [
  { value: 'gentle', label: 'Gentle' },
  { value: 'standard', label: 'Standard' },
  { value: 'firm', label: 'Firm' },
];

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export const ClientSheet = ({ clientId, onClose }: { clientId: string; onClose: () => void }) => {
  const { role } = useBusiness();
  const backend = useBackend();
  const clients = useClients();
  const invoices = useInvoices();
  const live = useDrafts(['waiting', 'approved']);
  const { run, busy } = useAction();
  const { show } = useMessages();
  const online = useOnline();
  const client = clients.data?.find((c) => c.id === clientId);
  const [email, setEmail] = useState<string | null>(null);
  const [contact, setContact] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmPause, setConfirmPause] = useState(false);
  // The chosen tone shows at once while it saves, and goes back if the save fails.
  const [pendingTone, setPendingTone] = useState<Tone | null>(null);
  const keepRef = useRef<HTMLButtonElement>(null);

  const liveCount = useMemo(() => {
    const ids = new Set((invoices.data ?? []).filter((invoice) => invoice.client_id === clientId).map((invoice) => invoice.id));
    return (live.data ?? []).filter((draft) => ids.has(draft.invoice_id)).length;
  }, [invoices.data, live.data, clientId]);

  if (clients.data === undefined) {
    return (
      <Sheet open onClose={onClose} title="Client">
        <NoData query={clients} loading={<Skeleton height={120} />} />
      </Sheet>
    );
  }
  if (!client) {
    return (
      <Sheet open onClose={onClose} title="Client">
        <ErrorPanel message="This item is no longer available." />
      </Sheet>
    );
  }

  const emailValue = email ?? client.email ?? '';
  const contactValue = contact ?? client.contact_name ?? '';
  const canEditContact = role === 'owner' || role === 'checker';
  const isOwner = role === 'owner';

  const saveContact = async () => {
    const value = emailValue.trim().toLowerCase();
    if (!EMAIL.test(value)) {
      setEmailError('Enter one valid email address, such as accounts@example.com.');
      return;
    }
    setEmailError(null);
    const hadEmail = Boolean(client.email);
    const result = await run('contact', () => backend.updateClientContact(clientId, value, contactValue.trim() || undefined));
    if (!result.ok) {
      setEmailError(result.error.kind === 'rule' ? result.error.message : null);
      if (result.error.kind !== 'rule') setError(result.error.message);
      return;
    }
    setEmail(null);
    setContact(null);
    show({ text: hadEmail ? 'Saved.' : "Saved. Your apprentice drafts for this client from Sunday's run." });
  };

  const setTone = async (tone: Tone) => {
    if (tone === client.tone) return;
    setPendingTone(tone);
    const result = await run('tone', () => backend.setClientTone(clientId, tone), { refresh: 'wait' });
    setPendingTone(null);
    if (!result.ok) setError(result.error.message);
    else show({ text: `Saved. New drafts use the ${TONE_LABEL[tone]} tone from Sunday. Waiting drafts keep their wording.` });
  };

  const setPaused = async (paused: boolean) => {
    const result = await run('pause', () => backend.setClientPaused(clientId, paused));
    setConfirmPause(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    show({
      text: paused
        ? `Paused.${result.value.drafts_cancelled > 0 ? ` ${pluralise(result.value.drafts_cancelled, 'reminder')} cancelled.` : ''}`
        : "Resumed. Reminders start again from Sunday's run.",
    });
  };

  return (
    <Sheet open onClose={onClose} title={client.name} busy={busy !== null}>
      <div className="stack-lg">
        <div className="row-wrap">
          <Chip>{TONE_LABEL[client.tone]}</Chip>
          {client.paused ? <Chip>Paused</Chip> : null}
          {!client.email ? <Chip>No email</Chip> : null}
        </div>

        {canEditContact ? (
          <section className="stack-sm" aria-labelledby="contact-heading">
            <h3 className="t-heading" id="contact-heading">
              Email for reminders
            </h3>
            <TextField
              label="Email"
              type="email"
              inputMode="email"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              value={emailValue}
              onChange={(event) => setEmail(event.target.value)}
              error={emailError}
              hint="Reminders go here from your own email. Use the address that pays your invoices."
            />
            <TextField
              label="Contact name (optional)"
              value={contactValue}
              maxLength={120}
              onChange={(event) => setContact(event.target.value)}
              hint="Reminders greet this person. Leave it empty to use the client's name."
            />
            <Button variant="primary" busy={busy === 'contact'} busyLabel="Saving…" unavailable={!online} onClick={() => void saveContact()}>
              {client.email ? 'Save' : 'Add the email'}
            </Button>
          </section>
        ) : (
          <p>{client.email ?? 'No email address yet.'}</p>
        )}

        {isOwner ? (
          <section className="stack-sm" aria-labelledby="tone-heading">
            <h3 className="t-heading" id="tone-heading">
              Tone
            </h3>
            <Choices legend="Tone for this client" hideLegend segmented name={`tone-${client.id}`} value={pendingTone ?? client.tone} options={TONES} onChange={(tone) => void setTone(tone)} />
            <p className="t-caption">New drafts use it from the next run; waiting drafts keep their wording.</p>
          </section>
        ) : null}

        {isOwner ? (
          <section className="stack-sm" aria-labelledby="pause-heading">
            <h3 className="t-heading" id="pause-heading">
              Reminders
            </h3>
            {client.paused ? (
              <>
                <p className="t-secondary">Paused: no reminders are drafted for this client.</p>
                <Button variant="secondary" busy={busy === 'pause'} busyLabel="Saving…" unavailable={!online} onClick={() => void setPaused(false)}>
                  Resume reminders
                </Button>
              </>
            ) : (
              <>
                <p className="t-secondary">Pause a client you'd rather speak to yourself, such as a head contractor who gives repeat work.</p>
                <Button variant="secondary" unavailable={!online} onClick={() => setConfirmPause(true)}>
                  Pause reminders
                </Button>
              </>
            )}
          </section>
        ) : null}
        <FormError message={error} />
      </div>
      <Sheet
        open={confirmPause}
        onClose={() => setConfirmPause(false)}
        title={`Pause reminders for ${client.name}?`}
        alert
        busy={busy === 'pause'}
        initialFocus={keepRef}
        footer={
          <>
            <Button variant="primary" block busy={busy === 'pause'} busyLabel="Pausing…" onClick={() => void setPaused(true)}>
              Pause reminders
            </Button>
            <Button ref={keepRef} variant="secondary" block onClick={() => setConfirmPause(false)}>
              Keep them on
            </Button>
          </>
        }
      >
        <p>
          {liveCount > 0 ? `Pausing cancels ${pluralise(liveCount, 'waiting reminder')}. ` : ''}No new drafts are made until you resume, and the briefing lists the client as
          paused.
        </p>
      </Sheet>
    </Sheet>
  );
};
