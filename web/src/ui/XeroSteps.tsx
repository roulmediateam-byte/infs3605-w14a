// How to turn off Xero's own invoice reminders, so clients aren't chased twice (FR-32: the app "warns that clients
// could be chased twice and shows how to turn them off"). Steps checked against Xero's help and two guides on
// Thu 15 Oct 2026: Sales, then Invoices, then Invoice reminders.
export const XERO_REMINDERS_HELP = 'https://central.xero.com/0/article/Turn-invoice-reminders-on-or-off';

export const XeroOffSteps = () => (
  <>
    In Xero, go to Sales, then Invoices, then Invoice reminders. Untick “Email customers when an invoice is…”, then save.{' '}
    <a href={XERO_REMINDERS_HELP} target="_blank" rel="noopener noreferrer">
      Xero's help (opens in a new tab)
    </a>
  </>
);
