// Settings: tone presets and "firmer by itself". A preset is a name and a tone the owner reuses ("Good payers:
// gentle"); clients remember the preset their tone came from, and a preset for a client group is given to new clients
// in that group by itself. Firmer by itself moves a client one tone firmer after a set number of unpaid reminders.
// Nothing is ever sent without approval: these only change how next week's drafts are worded.
import { useQuery } from '@tanstack/react-query';
import { SlidersHorizontal, Trash2, TrendingUp } from 'lucide-react';
import { useState } from 'react';
import { useMessages } from '../app/messages.tsx';
import { useAction, useBusinessRecord, useClients } from '../app/queries.ts';
import { useBackend, useBusiness } from '../app/session.tsx';
import type { TonePreset, Tone } from '../backend/types.ts';
import { TONE_LABEL } from '../lib/words.ts';
import { Button, Chip, Choices, FormError, IconTile, SelectField, TextField } from '../ui/controls.tsx';

export const GROUP_LABEL: Record<NonNullable<TonePreset['client_group']>, string> = {
  head_contractor: 'Head contractors',
  homeowner: 'Homeowners',
  other: 'Other clients',
};

export const usePresets = () => {
  const backend = useBackend();
  const { businessId } = useBusiness();
  return useQuery({ queryKey: ['b', businessId, 'presets'], queryFn: () => backend.presets(businessId) });
};

const STARTERS: Omit<TonePreset, 'id'>[] = [
  { name: 'Good payers', tone: 'gentle', note: 'Usually pay, just need a nudge', client_group: null },
  { name: 'Head contractors', tone: 'standard', note: 'Clear and businesslike', client_group: 'head_contractor' },
  { name: 'Slow payers', tone: 'firm', note: 'Polite but direct', client_group: null },
];

export const PresetsSection = () => {
  const backend = useBackend();
  const { businessId } = useBusiness();
  const presets = usePresets();
  const clients = useClients();
  const business = useBusinessRecord();
  const { run, busy } = useAction();
  const { show } = useMessages();
  const [draft, setDraft] = useState<{ name: string; tone: Tone; note: string; group: string }>({ name: '', tone: 'standard', note: '', group: '' });
  const [error, setError] = useState<string | null>(null);
  // The choice shows at once while it saves, and goes back if the save fails.
  const [pendingAuto, setPendingAuto] = useState<string | null>(null);

  const list = presets.data ?? [];
  const using = (id: string) => (clients.data ?? []).filter((c) => c.preset_id === id).length;

  const save = (preset: Omit<TonePreset, 'id'>) =>
    void run('preset-save', () => backend.savePreset(businessId, preset)).then((result) => {
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setError(null);
      setDraft({ name: '', tone: 'standard', note: '', group: '' });
      show({ text: `Saved the preset "${preset.name}".` });
    });
  const remove = (preset: TonePreset) =>
    void run(`preset-delete-${preset.id}`, () => backend.deletePreset(preset.id)).then((result) => {
      show(result.ok ? { text: `Deleted "${preset.name}". Clients keep their tone.` } : { text: result.error.message, tone: 'critical' });
    });
  const setAuto = (value: string) => {
    setPendingAuto(value);
    void run('auto-firm', () => backend.updateSettings(businessId, { auto_firm_after: value === 'off' ? null : Number(value) }), { refresh: 'wait' }).then((result) => {
      setPendingAuto(null);
      show(
        result.ok
          ? { text: value === 'off' ? 'Firmer by itself is off.' : `From the next run, clients get one tone firmer after ${value} unpaid ${value === '1' ? 'reminder' : 'reminders'}.` }
          : { text: result.error.message, tone: 'critical' },
      );
    });
  };

  const auto = business.data?.auto_firm_after ?? null;

  return (
    <section className="settings-group" aria-labelledby="g-presets">
      <h2 id="g-presets" className="t-heading settings-title">
        <IconTile icon={SlidersHorizontal} tone="action" size="sm" /> Tone presets
      </h2>
      <p className="t-secondary">
        Save the tones you use, then give them to clients on the Clients screen. Each client remembers its preset. A preset for a group goes to new
        clients in that group by itself.
      </p>
      {list.length > 0 ? (
        <ul className="list">
          {list.map((preset) => (
            <li key={preset.id} className="list-row preset-row">
              <div className="list-main">
                <span className="list-title">{preset.name}</span>
                <span className="t-caption">
                  {TONE_LABEL[preset.tone]}
                  {preset.client_group ? `, new ${GROUP_LABEL[preset.client_group].toLowerCase()} get it` : ''}
                  {`, ${using(preset.id) === 1 ? '1 client' : `${using(preset.id)} clients`}`}
                  {preset.note ? `. ${preset.note}` : ''}
                </span>
              </div>
              <Button variant="quiet" aria-label={`Delete ${preset.name}`} busy={busy === `preset-delete-${preset.id}`} onClick={() => remove(preset)}>
                <Trash2 size={18} aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="panel stack-sm">
          <p>No presets yet. Start with three common ones:</p>
          <Button
            variant="secondary"
            busy={busy === 'preset-starters'}
            busyLabel="Adding…"
            onClick={() =>
              void run('preset-starters', async () => {
                for (const starter of STARTERS) await backend.savePreset(businessId, starter);
              }).then((result) => show(result.ok ? { text: 'Added Good payers, Head contractors and Slow payers.' } : { text: result.error.message, tone: 'critical' }))
            }
          >
            Add the three starter presets
          </Button>
        </div>
      )}
      <form
        className="panel stack-sm"
        onSubmit={(event) => {
          event.preventDefault();
          if (draft.name.trim() === '') {
            setError('Give the preset a name, such as "Good payers".');
            return;
          }
          save({ name: draft.name.trim(), tone: draft.tone, note: draft.note.trim() || null, client_group: (draft.group || null) as TonePreset['client_group'] });
        }}
      >
        <TextField label="New preset name" value={draft.name} maxLength={40} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        <Choices
          legend="Tone"
          name="preset-tone"
          segmented
          value={draft.tone}
          onChange={(tone) => setDraft({ ...draft, tone })}
          options={(['gentle', 'standard', 'firm'] as Tone[]).map((tone) => ({ value: tone, label: TONE_LABEL[tone] }))}
        />
        <SelectField label="Give it to new clients in a group (optional)" value={draft.group} onChange={(e) => setDraft({ ...draft, group: e.target.value })}>
          <option value="">No group</option>
          {Object.entries(GROUP_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </SelectField>
        <TextField label="Note to yourself (optional)" hint="Only you see it. It's never sent to clients." value={draft.note} maxLength={160} onChange={(e) => setDraft({ ...draft, note: e.target.value })} />
        <FormError message={error} />
        <Button type="submit" variant="secondary" busy={busy === 'preset-save'} busyLabel="Saving…">
          Save preset
        </Button>
      </form>

      <div className="panel stack-sm">
        <div className="row">
          <IconTile icon={TrendingUp} tone="apprentice" size="sm" />
          <span className="list-title">Firmer by itself</span>
          {auto ? <Chip tone="apprentice">On</Chip> : null}
        </div>
        <p className="t-secondary">
          When an invoice stays unpaid after a number of reminders, your apprentice moves that client one tone firmer for next week's draft: gentle to
          standard, then standard to firm. You still approve every reminder, and the log shows each change.
        </p>
        <Choices
          legend="Move a client one tone firmer after"
          name="auto-firm"
          value={pendingAuto ?? (auto ? String(auto) : 'off')}
          onChange={setAuto}
          options={[
            { value: 'off', label: 'Off' },
            { value: '1', label: '1 unpaid reminder' },
            { value: '2', label: '2 unpaid reminders' },
            { value: '3', label: '3 unpaid reminders' },
          ]}
        />
      </div>
    </section>
  );
};
