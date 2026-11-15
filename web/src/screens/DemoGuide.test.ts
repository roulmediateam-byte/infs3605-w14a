import { describe, expect, it } from 'vitest';
import type { ActivityAction, LogEntry } from '../lib/activity.ts';
import { demoProgress } from './DemoGuide.tsx';

const entry = (id: number, action: ActivityAction, actor: LogEntry['actor_role'] = 'owner', details: Record<string, unknown> = {}): LogEntry => ({
  id,
  at: '2026-10-28T00:00:00Z',
  actor_user_id: actor === 'system' ? null : '7d1f0000-0000-4000-8000-000000000001',
  actor_role: actor,
  action,
  invoice_id: null,
  draft_id: null,
  client_id: null,
  import_id: null,
  run_id: null,
  details,
});

/** What supabase/seed.sql logs: its own drafting run and drafts, but no import (the seed adds invoices directly). */
const seed = [
  entry(1, 'draft_created', 'system'),
  entry(2, 'draft_flagged', 'system'),
  entry(3, 'draft_created', 'system'),
  entry(4, 'weekly_run_completed', 'system', { drafts_created: 5, source: 'seed' }),
  entry(5, 'member_joined'),
];

describe('demo guide steps', () => {
  it('starts with nothing done, even though the seed already ran a draft', () => {
    expect(demoProgress([])).toEqual({ imported: false, drafted: false, reviewed: false });
    expect(demoProgress(seed)).toEqual({ imported: false, drafted: false, reviewed: false });
  });

  it('ticks the import once someone imports a file', () => {
    expect(demoProgress([...seed, entry(6, 'import_completed'), entry(7, 'invoice_closed', 'owner')])).toEqual({
      imported: true,
      drafted: false,
      reviewed: false,
    });
  });

  it('counts a drafting run only after the import', () => {
    const runFirst = [...seed, entry(6, 'weekly_run_completed', 'system', { template: 5 }), entry(7, 'import_completed')];
    expect(demoProgress(runFirst).drafted).toBe(false);
    const importFirst = [...seed, entry(6, 'import_completed'), entry(7, 'draft_created', 'system'), entry(8, 'weekly_run_completed', 'system', { template: 6 })];
    expect(demoProgress(importFirst)).toEqual({ imported: true, drafted: true, reviewed: false });
  });

  it('counts a review only after the run', () => {
    const before = [...seed, entry(6, 'draft_approved'), entry(7, 'import_completed'), entry(8, 'weekly_run_completed', 'system')];
    expect(demoProgress(before).reviewed).toBe(false);
    for (const action of ['draft_approved', 'draft_rejected', 'reminder_sent'] as const) {
      expect(demoProgress([...before, entry(9, action, 'checker')]).reviewed).toBe(true);
    }
    expect(demoProgress([...before, entry(9, 'review_session')]).reviewed).toBe(false);
  });

  it('reads the log in any order, as the app gets it newest first', () => {
    const all = [...seed, entry(6, 'import_completed'), entry(7, 'weekly_run_completed', 'system'), entry(8, 'draft_rejected')];
    expect(demoProgress([...all].reverse())).toEqual({ imported: true, drafted: true, reviewed: true });
  });

  it('keeps a step done after a later import', () => {
    const all = [...seed, entry(6, 'import_completed'), entry(7, 'weekly_run_completed', 'system'), entry(8, 'draft_approved'), entry(9, 'import_completed')];
    expect(demoProgress(all)).toEqual({ imported: true, drafted: true, reviewed: true });
  });
});
