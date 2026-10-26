// UI-11 Settings (owner only; FR-02, FR-03, FR-22, FR-25, FR-27, FR-32, FR-33, D3). Grouped as Business, Briefing,
// Reminders, Your voice, Team and Data. Changes apply from the next run. Delete all sits alone at the bottom in the
// destructive style and asks for the typed business name.
import { BellRing, Building2, Check, CircleDashed, Database, Download, Gauge, MessageSquareText, Sunrise, Trash2, Users, type LucideIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMessages } from '../app/messages.tsx';
import { useOnline } from '../app/online.ts';
import { useAction, useBusinessRecord, useMembers, useRecordCounts, useTrustSummary } from '../app/queries.ts';
import { useBackend, useBusiness, useSession } from '../app/session.tsx';
import type { Business, SettingsChanges, XeroReminders } from '../backend/types.ts';
import { formatDateLong, sydneyDate } from '../lib/dates.ts';
import { exportEntries, slug, zip } from '../lib/export.ts';
import { dollarsToCents, formatAud } from '../lib/money.ts';
import { firstName, pluralise } from '../lib/words.ts';
import { Banner, Button, Chip, Choices, FormError, IconTile, LoadingBlock, PageTitle, TextAreaField, TextField } from '../ui/controls.tsx';
import { useInsetRef } from '../ui/insets.ts';
import { XeroOffSteps } from '../ui/XeroSteps.tsx';
import { NoData } from '../ui/QueryState.tsx';
import { Sheet } from '../ui/Sheet.tsx';

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const VOICE_SAFE = (value: string): boolean => !/[0-9@$]/.test(value.replace(/\{[a-z_]+\}/g, ''));

interface Form {
  name: string;
  owner_name: string;
  sign_off: string;
  reply_to_email: string;
  briefing_time: '07:00' | '18:00';
  overdue_threshold_days: string;
  cooldown_days: string;
  call_first: string;
  xero_reminders: XeroReminders;
  style_note: string;
  example_reminder: string;
}

const toForm = (b: Business): Form => ({
  name: b.name,
  owner_name: b.owner_name,
  sign_off: b.sign_off,
  reply_to_email: b.reply_to_email,
  briefing_time: b.briefing_time.startsWith('18') ? '18:00' : '07:00',
  overdue_threshold_days: String(b.overdue_threshold_days),
  cooldown_days: String(b.cooldown_days),
  call_first: b.call_first_threshold_cents ? formatAud(b.call_first_threshold_cents).replace('$', '') : '',
  xero_reminders: b.xero_reminders,
  style_note: b.style_note ?? '',
  example_reminder: b.example_reminder ?? '',
});

type Errors = Partial<Record<keyof Form, string>>;

const validate = (form: Form): Errors => {
  const errors: Errors = {};
  const length = (value: string) => [...value.trim()].length;
  if (length(form.name) < 1 || length(form.name) > 120) errors.name = 'Enter the business name, up to 120 characters.';
  if (length(form.owner_name) < 1 || length(form.owner_name) > 80) errors.owner_name = 'Enter your name, up to 80 characters.';
  if (length(form.sign_off) < 1 || length(form.sign_off) > 60) errors.sign_off = 'Enter a sign-off, such as "Thanks,", up to 60 characters.';
  if (!EMAIL.test(form.reply_to_email.trim())) errors.reply_to_email = 'Enter one valid email address for client replies.';
  const threshold = Number(form.overdue_threshold_days);
  if (!Number.isInteger(threshold) || threshold < 1 || threshold > 60) errors.overdue_threshold_days = 'Enter a whole number of days from 1 to 60.';
  const cooldown = Number(form.cooldown_days);
  if (!Number.isInteger(cooldown) || cooldown < 1 || cooldown > 28) errors.cooldown_days = 'Enter a whole number of days from 1 to 28.';
  if (form.call_first.trim() !== '') {
    const cents = dollarsToCents(form.call_first);
    if (cents === null || cents <= 0) errors.call_first = 'Enter an amount in dollars, such as 15,000, or leave it empty.';
  }
  if ([...form.style_note].length > 300) errors.style_note = 'Keep the style note to 300 characters.';
  else if (!VOICE_SAFE(form.style_note)) errors.style_note = 'Leave out numbers, @ and $. Your apprentice adds the facts itself.';
  if ([...form.example_reminder].length > 1200) errors.example_reminder = 'Keep the example to 1,200 characters.';
  else if (!VOICE_SAFE(form.example_reminder)) errors.example_reminder = 'Leave out numbers, @ and $, and replace names with {client_name}. Your apprentice adds the facts itself.';
  return errors;
};

const changesFrom = (form: Form, b: Business): SettingsChanges => {
  const changes: SettingsChanges = {};
  if (form.name.trim() !== b.name) changes.name = form.name.trim();
  if (form.owner_name.trim() !== b.owner_name) changes.owner_name = form.owner_name.trim();
  if (form.sign_off.trim() !== b.sign_off) changes.sign_off = form.sign_off.trim();
  if (form.reply_to_email.trim().toLowerCase() !== b.reply_to_email) changes.reply_to_email = form.reply_to_email.trim().toLowerCase();
  if (form.briefing_time !== toForm(b).briefing_time) changes.briefing_time = form.briefing_time;
  if (Number(form.overdue_threshold_days) !== b.overdue_threshold_days) changes.overdue_threshold_days = Number(form.overdue_threshold_days);
  if (Number(form.cooldown_days) !== b.cooldown_days) changes.cooldown_days = Number(form.cooldown_days);
  const callFirst = form.call_first.trim() === '' ? null : dollarsToCents(form.call_first);
  if (callFirst !== b.call_first_threshold_cents) changes.call_first_threshold_cents = callFirst;
  if (form.xero_reminders !== b.xero_reminders) changes.xero_reminders = form.xero_reminders;
  if (form.style_note.trim() !== (b.style_note ?? '')) changes.style_note = form.style_note.trim();
  if (form.example_reminder.trim() !== (b.example_reminder ?? '')) changes.example_reminder = form.example_reminder.trim();
  return changes;
};

const downloadBytes = (bytes: Uint8Array, fileName: string): void => {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/zip' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
};

/** A settings group's title, after a blue-tinted tile that names its kind. */
const GroupTitle = ({ id, icon, children }: { id: string; icon: LucideIcon; children: string }) => (
  <h2 className="t-heading settings-title" id={id}>
    <IconTile icon={icon} tone="action" size="sm" />
    {children}
  </h2>
);

export const SettingsScreen = () => {
  const { role, businessId, user } = useBusiness();
  const { signOut } = useSession();
  const backend = useBackend();
  const business = useBusinessRecord();
  const members = useMembers();
  const trust = useTrustSummary();
  const { run, busy } = useAction();
  const { show } = useMessages();
  const online = useOnline();
  const saveInset = useInsetRef('save');
  const [form, setForm] = useState<Form | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [invite, setInvite] = useState({ name: '', email: '' });
  const [inviteErrors, setInviteErrors] = useState<{ name?: string; email?: string; form?: string }>({});
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [typedName, setTypedName] = useState('');
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [dataError, setDataError] = useState<string | null>(null);
  const counts = useRecordCounts(deleteOpen);
  const keepRef = useRef<HTMLButtonElement>(null);
  const cancelDeleteRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (business.data && form === null) setForm(toForm(business.data));
  }, [business.data, form]);

  const checker = useMemo(() => members.data?.find((m) => m.role === 'checker' && m.status !== 'removed'), [members.data]);
  const changes = form && business.data ? changesFrom(form, business.data) : {};
  const dirty = Object.keys(changes).length > 0;

  if (role !== 'owner') {
    return (
      <div className="page stack">
        <PageTitle documentTitle="Settings">Settings</PageTitle>
        <p>Only the owner can change settings.</p>
      </div>
    );
  }
  if (business.data === undefined || !form) {
    return <NoData query={business} loading={<LoadingBlock label="Loading settings" />} />;
  }
  const b = business.data as Business;

  const update = <K extends keyof Form>(key: K, value: Form[K]) => {
    setForm((current) => (current ? { ...current, [key]: value } : current));
    setErrors((current) => ({ ...current, [key]: undefined }));
  };

  const save = async () => {
    const found = validate(form);
    setErrors(found);
    const first = (Object.keys(found) as (keyof Form)[])[0];
    if (first) {
      document.getElementById(`setting-${first}`)?.focus();
      return;
    }
    if (!dirty) return;
    setSaveError(null);
    const result = await run('save', () => backend.updateSettings(businessId, changes), { refresh: 'wait' });
    if (!result.ok) {
      setSaveError(result.error.message);
      return;
    }
    setForm(null);
    show({ text: 'Saved. Changes apply from the next run.' });
  };

  const sendInvite = async () => {
    const found: typeof inviteErrors = {};
    if (invite.name.trim() === '') found.name = "Enter the checker's name.";
    if (!EMAIL.test(invite.email.trim())) found.email = 'Enter one valid email address.';
    setInviteErrors(found);
    if (found.name || found.email) return;
    const result = await run('invite', () => backend.inviteChecker(businessId, invite.email.trim().toLowerCase(), invite.name.trim()));
    if (!result.ok) {
      setInviteErrors(result.error.kind === 'rule' ? { email: result.error.message } : { form: result.error.message });
      return;
    }
    show({ text: `Invitation saved for ${firstName(invite.name)}. Ask the team to send their sign-in email.` });
    setInvite({ name: '', email: '' });
  };

  const removeChecker = async () => {
    if (!removeId) return;
    const result = await run('remove', () => backend.removeMember(removeId));
    setRemoveId(null);
    if (!result.ok) show({ text: result.error.message, tone: 'critical' });
    else show({ text: 'Removed. Their access ended straight away.' });
  };

  const setCheckerMaySend = async (value: boolean) => {
    const result = await run('may-send', () => backend.updateSettings(businessId, { checker_may_send: value }));
    if (!result.ok) show({ text: result.error.message, tone: 'critical' });
    else show({ text: value ? `Saved. ${firstName(checker?.display_name ?? 'Your checker')} can send reminders now.` : 'Saved. Only you send reminders now.' });
  };

  const exportAll = async () => {
    setDataError(null);
    if (backend.preview) {
      setDataError("Preview: this viewer can't save files. In the app, Export all downloads a .zip of CSV files.");
      return;
    }
    const result = await run('export', () => backend.exportBusinessData(businessId), { refresh: 'none' });
    if (!result.ok) {
      setDataError(result.error.message);
      return;
    }
    downloadBytes(zip(exportEntries(result.value)), `payprentice-export-${slug(b.name)}-${sydneyDate()}.zip`);
    show({ text: 'Exported. The .zip file is in your downloads.' });
  };

  const deleteAll = async () => {
    if (typedName.trim().toLowerCase() !== b.name.trim().toLowerCase()) {
      setDeleteError('Type the business name exactly to confirm.');
      cancelDeleteRef.current?.focus();
      return;
    }
    const result = await run('delete', () => backend.deleteBusiness(businessId, typedName), { refresh: 'none' });
    if (!result.ok) {
      setDeleteError(result.error.message);
      return;
    }
    setDeleteOpen(false);
    await signOut(
      backend.preview
        ? 'Your business data has been deleted. Reload to start the demo again with fresh Test data.'
        : 'Your business data has been deleted. Your sign-in goes within 14 days.',
    );
  };

  const nameMatches = typedName.trim().toLowerCase() === b.name.trim().toLowerCase();
  const field = (key: keyof Form) => ({ id: `setting-${key}`, error: errors[key] ?? null });

  return (
    <div className="page">
      <div className="page-head stack-sm">
        <PageTitle documentTitle="Settings">Settings</PageTitle>
        <p className="t-caption">Changes apply from the next run.</p>
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
        noValidate
      >
        <section className="settings-group" aria-labelledby="g-business">
          <GroupTitle id="g-business" icon={Building2}>
            Business
          </GroupTitle>
          <TextField label="Business name" value={form.name} maxLength={120} onChange={(e) => update('name', e.target.value)} {...field('name')} />
          <TextField label="Your name" value={form.owner_name} maxLength={80} onChange={(e) => update('owner_name', e.target.value)} {...field('owner_name')} hint="It signs every reminder." />
          <TextField label="Sign-off" value={form.sign_off} maxLength={60} onChange={(e) => update('sign_off', e.target.value)} {...field('sign_off')} hint='The first line of the signature, such as "Thanks,".' />
          <TextField
            label="Reply-to email"
            type="email"
            inputMode="email"
            autoCapitalize="none"
            value={form.reply_to_email}
            onChange={(e) => update('reply_to_email', e.target.value)}
            {...field('reply_to_email')}
            hint="Where client replies should go. The Send screen shows it, so you can check your email app sends from it."
          />
        </section>

        <section className="settings-group" aria-labelledby="g-briefing">
          <GroupTitle id="g-briefing" icon={Sunrise}>
            Briefing
          </GroupTitle>
          <p>Your briefing email comes every Monday.</p>
          <Choices
            legend="Briefing time (Sydney time)"
            name="briefing-time"
            value={form.briefing_time}
            options={[
              { value: '07:00', label: '7:00 am' },
              { value: '18:00', label: '6:00 pm' },
            ]}
            onChange={(value) => update('briefing_time', value)}
          />
          {form.briefing_time === '18:00' ? <p className="t-secondary">Evening briefings don't nudge your checker.</p> : null}
        </section>

        <section className="settings-group" aria-labelledby="g-reminders">
          <GroupTitle id="g-reminders" icon={BellRing}>
            Reminders
          </GroupTitle>
          <TextField
            label="Days overdue before a reminder is drafted"
            inputClassName="input-short"
            inputMode="numeric"
            value={form.overdue_threshold_days}
            onChange={(e) => update('overdue_threshold_days', e.target.value.replace(/\D/g, ''))}
            {...field('overdue_threshold_days')}
          />
          <TextField
            label="Days between reminders for the same invoice"
            inputClassName="input-short"
            inputMode="numeric"
            value={form.cooldown_days}
            onChange={(e) => update('cooldown_days', e.target.value.replace(/\D/g, ''))}
            {...field('cooldown_days')}
          />
          <TextField
            label="Suggest a call for invoices of at least (dollars, optional)"
            inputClassName="input-short"
            inputMode="decimal"
            value={form.call_first}
            onChange={(e) => update('call_first', e.target.value)}
            {...field('call_first')}
            hint='The briefing marks these "consider a call". Leave it empty to turn this off.'
          />
          <Choices
            legend="Does Xero send its own invoice reminders?"
            name="xero"
            value={form.xero_reminders}
            options={[
              { value: 'on', label: 'Yes' },
              { value: 'off', label: 'No' },
              { value: 'unknown', label: 'Not sure' },
            ]}
            onChange={(value) => update('xero_reminders', value)}
          />
          {form.xero_reminders === 'on' ? (
            <Banner tone="warning">
              Turn off Xero's invoice reminders, so clients don't get two for the same invoice. <XeroOffSteps />
            </Banner>
          ) : null}
        </section>

        <section className="settings-group" aria-labelledby="g-voice">
          <GroupTitle id="g-voice" icon={MessageSquareText}>
            Your voice
          </GroupTitle>
          <p className="t-secondary">Your apprentice writes in this style. Leave out numbers, names and emails: it adds the facts from your records.</p>
          <TextAreaField
            label="Style note (optional)"
            rows={3}
            value={form.style_note}
            onChange={(e) => update('style_note', e.target.value)}
            {...field('style_note')}
            hint={`For example: Short and friendly. First names. ${300 - [...form.style_note].length} characters left.`}
          />
          <TextAreaField
            label="An example reminder in your words (optional)"
            rows={6}
            value={form.example_reminder}
            onChange={(e) => update('example_reminder', e.target.value)}
            {...field('example_reminder')}
            hint="Use {client_name}, {invoice_number}, {amount_due} and {due_date} where the facts go."
          />
        </section>

        <div className="sticky-save stack-sm" ref={saveInset}>
          <Button type="submit" variant="primary" size="lg" busy={busy === 'save'} busyLabel="Saving…" unavailable={!dirty || !online}>
            {dirty ? 'Save changes' : 'No changes to save'}
          </Button>
          <FormError message={saveError} />
        </div>
      </form>

      <section className="settings-group" aria-labelledby="g-team">
        <GroupTitle id="g-team" icon={Users}>
          Team
        </GroupTitle>
        <p className="t-secondary">A checker can approve, edit and reject drafts while you're on site. You send them unless you allow otherwise.</p>
        {checker ? (
          <div className="panel stack-sm">
            <p>
              <span className="list-title">{checker.display_name}</span>, {checker.invited_email}
            </p>
            <p className="t-caption">{checker.status === 'active' ? 'Checker, joined' : 'Checker, invited (not signed in yet)'}</p>
            <label className="check">
              <input type="checkbox" checked={b.checker_may_send} disabled={busy === 'may-send' || !online} onChange={(e) => void setCheckerMaySend(e.target.checked)} />
              <span>
                {firstName(checker.display_name)} may send reminders
                <span className="t-caption" style={{ display: 'block' }}>
                  Turn this on when they send from the business's shared mailbox.
                </span>
              </span>
            </label>
            <Button variant="danger-outline" unavailable={!online} onClick={() => setRemoveId(checker.id)}>
              Remove {firstName(checker.display_name)}
            </Button>
          </div>
        ) : (
          <div className="panel stack-sm">
            <TextField label="Checker's name" value={invite.name} maxLength={80} onChange={(e) => setInvite({ ...invite, name: e.target.value })} error={inviteErrors.name ?? null} />
            <TextField
              label="Checker's email"
              type="email"
              inputMode="email"
              autoCapitalize="none"
              value={invite.email}
              onChange={(e) => setInvite({ ...invite, email: e.target.value })}
              error={inviteErrors.email ?? null}
            />
            <Button variant="secondary" busy={busy === 'invite'} busyLabel="Saving…" unavailable={!online} onClick={() => void sendInvite()}>
              Invite a checker
            </Button>
            <FormError message={inviteErrors.form} />
          </div>
        )}
        <p className="t-caption">You're signed in as {user.email}.</p>
      </section>

      <section className="settings-group" aria-labelledby="g-trust">
        <GroupTitle id="g-trust" icon={Gauge}>
          How much your apprentice does
        </GroupTitle>
        <ol className="ladder">
          <li aria-current="true">
            <span>
              <span className="list-title" style={{ display: 'block' }}>
                Drafts only
              </span>
              <span className="t-caption">You approve and send every reminder.</span>
            </span>
            <Chip tone="selected" icon={Check}>
              Current
            </Chip>
          </li>
          <li>
            <span>
              <span className="list-title" style={{ display: 'block' }}>
                Approve in batches
              </span>
              <span className="t-caption">Approve several drafts at once.</span>
            </span>
            <Chip icon={CircleDashed}>Not available yet</Chip>
          </li>
          <li>
            <span>
              <span className="list-title" style={{ display: 'block' }}>
                Small reminders send themselves
              </span>
              <span className="t-caption">Only for amounts you choose, and never to head contractors.</span>
            </span>
            <Chip icon={CircleDashed}>Not available yet</Chip>
          </li>
        </ol>
        {trust.data ? (
          <p className="t-secondary">
            This week: {pluralise(trust.data.this_week.approved_clean, 'draft')} approved as written, {trust.data.this_week.approved_edited} edited and{' '}
            {trust.data.this_week.rejected} rejected. Since you started: {trust.data.overall.approved_clean} as written, {trust.data.overall.approved_edited} edited and{' '}
            {trust.data.overall.rejected} rejected.
          </p>
        ) : null}
      </section>

      <section className="settings-group" aria-labelledby="g-data">
        <GroupTitle id="g-data" icon={Database}>
          Data
        </GroupTitle>
        <p className="t-secondary">
          Export everything held for this business as a .zip of spreadsheet files.
          {b.delete_after ? ` This business's data is deleted on ${formatDateLong(b.delete_after)}.` : ''}
        </p>
        <Button variant="secondary" busy={busy === 'export'} busyLabel="Exporting…" unavailable={!online} onClick={() => void exportAll()}>
          <Download size={20} strokeWidth={1.5} aria-hidden="true" /> Export all
        </Button>
        <FormError message={dataError} />
      </section>

      <section className="danger-zone" aria-labelledby="g-delete">
        <h2 className="t-heading" id="g-delete">
          Delete all
        </h2>
        <p>Delete this business and everything in it: invoices, clients, drafts, the log and the team. This can't be undone.</p>
        <Button
          variant="danger"
          unavailable={!online}
          onClick={() => {
            setTypedName('');
            setDeleteError(null);
            setDeleteOpen(true);
          }}
        >
          <Trash2 size={20} strokeWidth={1.5} aria-hidden="true" /> Delete all
        </Button>
      </section>

      <Sheet
        open={removeId !== null}
        onClose={() => setRemoveId(null)}
        title={`Remove ${checker ? firstName(checker.display_name) : 'the checker'}?`}
        alert
        busy={busy === 'remove'}
        initialFocus={keepRef}
        footer={
          <>
            <Button ref={keepRef} variant="primary" block onClick={() => setRemoveId(null)}>
              Keep them
            </Button>
            <Button variant="danger" block busy={busy === 'remove'} busyLabel="Removing…" onClick={() => void removeChecker()}>
              Remove
            </Button>
          </>
        }
      >
        <p>Their access ends straight away. The log keeps what they did.</p>
      </Sheet>

      <Sheet
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="Delete everything for this business?"
        alert
        busy={busy === 'delete'}
        footer={
          <>
            <Button variant="danger" block busy={busy === 'delete'} busyLabel="Deleting…" unavailable={!nameMatches} aria-describedby="delete-help" onClick={() => void deleteAll()}>
              Delete everything
            </Button>
            <Button variant="secondary" block unavailable={busy === 'delete'} onClick={() => setDeleteOpen(false)}>
              Keep my data
            </Button>
          </>
        }
      >
        <div className="stack">
          <p>All of this goes at once, and a receipt with counts only is kept:</p>
          {counts.data ? (
            <ul className="stack-sm" style={{ listStyle: 'disc', paddingLeft: 24 }}>
              <li>{pluralise(counts.data.invoices ?? 0, 'invoice')}</li>
              <li>{pluralise(counts.data.clients ?? 0, 'client')}</li>
              <li>{pluralise(counts.data.reminder_drafts ?? 0, 'reminder draft')}</li>
              <li>{pluralise(counts.data.imports ?? 0, 'import')}</li>
              <li>{pluralise(counts.data.activity_log ?? 0, 'log entry', 'log entries')}</li>
              <li>{pluralise(counts.data.memberships ?? 0, 'team member')}</li>
            </ul>
          ) : (
            <LoadingBlock label="Counting what will be deleted" />
          )}
          <TextField
            ref={cancelDeleteRef}
            label={`Type the business name to confirm: ${b.name}`}
            value={typedName}
            autoComplete="off"
            onChange={(e) => {
              setTypedName(e.target.value);
              setDeleteError(null);
            }}
            error={deleteError}
          />
          <p id="delete-help" className="t-caption">
            {nameMatches ? 'The name matches. Deleting signs you out.' : 'The button works once the name matches.'}
          </p>
        </div>
      </Sheet>
    </div>
  );
};
