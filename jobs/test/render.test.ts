import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { escapeHtml, formatAud, renderBriefing, renderNudge, type Briefing } from '../lib/render.ts';

const briefing: Briefing = {
  business: { id: 'b1', name: 'Harbour Line Electrical (Test data)', owner_name: 'Alex Test', is_test_data: true },
  as_of_date: '2026-11-09',
  totals: { owed_cents: 6244000, overdue_cents: 4279000, open_count: 12, overdue_count: 9, due_this_week_cents: 705000, due_this_week_count: 2 },
  drafts_waiting: 5,
  first_draft_id: 'd-first',
  overdue: [
    { invoice_id: 'i1', invoice_number: '1066', client_name: 'Bayside <Builders>', amount_due_cents: 1870000, days_overdue: 8, call_first: true, client_paused: false },
    { invoice_id: 'i2', invoice_number: '1051', client_name: 'Northshore Homes', amount_due_cents: 845000, days_overdue: 21, call_first: false, client_paused: false },
    { invoice_id: 'i3', invoice_number: '1064', client_name: 'Ridgeway', amount_due_cents: 590000, days_overdue: 35, call_first: false, client_paused: true },
    { invoice_id: 'i4', invoice_number: '1056', client_name: 'M. Chen', amount_due_cents: 320000, days_overdue: 30, call_first: false, client_paused: false },
    { invoice_id: 'i5', invoice_number: '1060', client_name: 'Coastline', amount_due_cents: 218000, days_overdue: 10, call_first: false, client_paused: false },
    { invoice_id: 'i6', invoice_number: '1070', client_name: 'M. Chen', amount_due_cents: 148000, days_overdue: 1, call_first: false, client_paused: false },
  ],
  needs_attention: [{ kind: 'email_missing', invoice_number: '1060', client_name: 'Coastline', amount_due_cents: 218000 }],
  paused_clients: [{ name: 'Ridgeway', overdue_cents: 590000 }],
};

describe('BR-14: money', () => {
  it('formats cents like the database does', () => {
    assert.equal(formatAud(125000), '$1,250.00');
    assert.equal(formatAud(5), '$0.05');
    assert.equal(formatAud(123456789), '$1,234,567.89');
  });
});

describe('EM-01: the Monday briefing email', () => {
  const email = renderBriefing(briefing, 'https://app.example');

  it('leads with what is overdue and what needs review, and labels test data', () => {
    assert.equal(email.subject, '[Test data] This week: $42,790.00 overdue, 5 reminders to review');
  });
  it('shows the top 5 overdue invoices and says how many more', () => {
    assert.match(email.text, /Bayside <Builders>, invoice 1066, \$18,700\.00, 8 days overdue, consider a call/);
    assert.match(email.text, /and 1 more in the app/);
    assert.doesNotMatch(email.text, /1070/);
  });
  it('opens the first draft from the button', () => {
    assert.match(email.html, /href="https:\/\/app\.example\/review\?draft=d-first"/);
  });
  it('explains Needs attention and paused clients in plain words', () => {
    assert.match(email.text, /Coastline, invoice 1060: no email address, so no reminder was drafted\. Add one in Xero and import again, or in Clients\./);
    assert.match(email.text, /Change the briefing time in Settings\.$/);
    assert.match(email.text, /Paused: Ridgeway \(\$5,900\.00 overdue\)/);
  });
  it('escapes names in the HTML version and keeps a plain-text version', () => {
    assert.match(email.html, /Bayside &lt;Builders&gt;/);
    assert.doesNotMatch(email.html, /<Builders>/);
    assert.ok(email.text.length > 100);
  });
  it('says "Nothing to chase this week" when nothing is overdue, so the owner knows it ran', () => {
    const quiet = renderBriefing({ ...briefing, totals: { ...briefing.totals, overdue_cents: 0, overdue_count: 0 }, overdue: [], drafts_waiting: 0, first_draft_id: null }, 'https://app.example');
    assert.equal(quiet.subject, '[Test data] This week: nothing to chase');
    assert.match(quiet.text, /Nothing to chase this week/);
  });
  it('drops the test-data label for a real business', () => {
    const real = renderBriefing({ ...briefing, business: { ...briefing.business, is_test_data: false } }, 'https://app.example');
    assert.doesNotMatch(real.subject, /Test data/);
  });
  it('greets by first name without a time of day, because the briefing may come at 6:00 pm', () => {
    assert.match(email.text, /^Hi Alex,/);
    assert.doesNotMatch(email.text, /Good morning/);
  });
  it('carries the preview text first in the HTML body, and the design brief colours', () => {
    assert.match(email.html, /<body[^>]*><div style="display:none;max-height:0;overflow:hidden">Nothing is sent until you approve it\.<\/div>/);
    assert.match(email.html, /background:#1f4fd1/);
    assert.match(email.html, /max-width:600px/);
  });
});

describe('EM-02: the checker nudge', () => {
  it('says how many reminders still need approval', () => {
    const email = renderNudge({ recipient: { name: 'Jo Test' }, business: { name: 'Harbour Line', is_test_data: false }, drafts_waiting: 3 }, 'https://app.example');
    assert.equal(email.subject, '3 reminders still need approval');
    assert.match(email.text, /^Hi Jo,/);
  });
});

describe('escapeHtml', () => {
  it('escapes the five special characters', () => {
    assert.equal(escapeHtml(`<a href="x">'&'</a>`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  });
});
