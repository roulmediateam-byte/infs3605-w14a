// Set up a business, or join one with a code. Both work for any signed-in account, including a demonstration one,
// so they also appear on the "no business yet" screen. A new business is Test data, can start with the sample
// invoices and this week's drafts, and starts on a plan's 3-month intro (no card needed in test mode).
import { Building2, KeyRound } from 'lucide-react';
import { useState } from 'react';
import { useMessages } from '../app/messages.tsx';
import { useAction } from '../app/queries.ts';
import { navigate } from '../app/router.tsx';
import { useBackend, useSession } from '../app/session.tsx';
import type { PlanId } from '../backend/types.ts';
import { PLANS, priceLine } from '../lib/plans.ts';
import { Button, Choices, FormError, IconTile, PageTitle, TextField } from '../ui/controls.tsx';

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const CODE = /^[A-HJKMNP-Z2-9]{8}$/;

/** "k7qf 2mwd" or "K7QF-2MWD" to "K7QF2MWD". */
export const normaliseCode = (typed: string): string => typed.toUpperCase().replace(/[^A-Z0-9]/g, '');

export const JoinWithCode = () => {
  const backend = useBackend();
  const { refresh, chooseBusiness } = useSession();
  const { run, busy } = useAction();
  const { show } = useMessages();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const clean = normaliseCode(code);
    if (!CODE.test(clean)) {
      setError('Enter the 8 letters and numbers the owner gave you, such as K7QF-2MWD.');
      return;
    }
    setError(null);
    void run('join', () => backend.joinWithCode(clean), { refresh: 'none' }).then(async (result) => {
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      await refresh();
      chooseBusiness(result.value.business_id);
      show({ text: `You've joined as the ${result.value.role === 'owner' ? 'owner' : 'checker'}.` });
      navigate('');
    });
  };
  return (
    <form className="card stack" onSubmit={submit} aria-labelledby="join-heading" noValidate>
      <div className="row">
        <IconTile icon={KeyRound} tone="action" />
        <h2 id="join-heading" className="t-heading">
          Join a business with a code
        </h2>
      </div>
      <p className="t-secondary">The owner sees the code in Settings, under Team, when they invite you. It works for 7 days.</p>
      <TextField label="Join code" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" inputClassName="input-code" error={error} />
      <Button type="submit" variant="primary" busy={busy === 'join'} busyLabel="Joining…">
        Join
      </Button>
    </form>
  );
};

export const SetUpBusiness = ({ defaultOwnerName = '', defaultEmail = '' }: { defaultOwnerName?: string; defaultEmail?: string }) => {
  const backend = useBackend();
  const { refresh, chooseBusiness } = useSession();
  const { run, busy } = useAction();
  const { show } = useMessages();
  const [name, setName] = useState('');
  const [ownerName, setOwnerName] = useState(defaultOwnerName);
  const [email, setEmail] = useState(defaultEmail);
  const [plan, setPlan] = useState<PlanId>('crew');
  const [sample, setSample] = useState<'sample' | 'empty'>('sample');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const next: Record<string, string> = {};
    if (name.trim().length < 1 || name.trim().length > 120) next.name = 'Enter the business name, up to 120 characters.';
    if (ownerName.trim().length < 1 || ownerName.trim().length > 80) next.ownerName = 'Enter your name, up to 80 characters.';
    if (!EMAIL.test(email.trim())) next.email = 'Enter one valid email address for client replies.';
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    setProblem(null);
    void run(
      'setup',
      async () => {
        const id = await backend.createBusiness(name.trim(), ownerName.trim(), email.trim());
        await backend.choosePlan(id, plan);
        const added = sample === 'sample' ? await backend.addSampleInvoices(id) : null;
        return { id, added };
      },
      { refresh: 'none' },
    ).then(async (result) => {
      if (!result.ok) {
        setProblem(result.error.message);
        return;
      }
      await refresh();
      chooseBusiness(result.value.id);
      show({
        text: result.value.added
          ? `Set up, with ${result.value.added.invoices} sample invoices and ${result.value.added.drafts} drafts waiting for you.`
          : 'Set up. Import your open invoices to get your first drafts.',
      });
      navigate(result.value.added ? '' : 'import');
    });
  };

  return (
    <form className="card stack" onSubmit={submit} aria-labelledby="setup-heading" noValidate>
      <div className="row">
        <IconTile icon={Building2} tone="action" />
        <h2 id="setup-heading" className="t-heading">
          Set up a business
        </h2>
      </div>
      <TextField label="Business name" value={name} onChange={(e) => setName(e.target.value)} error={errors.name} autoComplete="organization" />
      <TextField label="Your name" hint="Signs your reminders." value={ownerName} onChange={(e) => setOwnerName(e.target.value)} error={errors.ownerName} autoComplete="name" />
      <TextField
        label="Email for client replies"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        error={errors.email}
        autoComplete="email"
      />
      <Choices
        legend="Plan"
        name="setup-plan"
        value={plan}
        onChange={setPlan}
        options={PLANS.map((p) => ({ value: p.id, label: `${p.name}: ${priceLine(p, true)}` }))}
      />
      <Choices
        legend="Start with"
        name="setup-sample"
        value={sample}
        onChange={setSample}
        options={[
          { value: 'sample', label: 'Sample Test data: 12 invoices and this week’s drafts, to try it' },
          { value: 'empty', label: 'Nothing: I’ll import my open invoices' },
        ]}
      />
      <p className="t-caption">Everything here is Test data. No card is needed: this build uses Stripe's test mode.</p>
      <FormError message={problem} />
      <Button type="submit" variant="primary" busy={busy === 'setup'} busyLabel="Setting up…">
        Set up the business
      </Button>
    </form>
  );
};

export const SetupScreen = () => {
  const { user } = useSession();
  return (
    <div className="page stack-lg">
      <PageTitle documentTitle="Set up or join">Set up or join a business</PageTitle>
      <SetUpBusiness defaultEmail={user?.email ?? ''} />
      <JoinWithCode />
    </div>
  );
};
