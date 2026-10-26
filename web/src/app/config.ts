// Build-time settings (web/.env.example). Everything here is public by design: the bundle carries the publishable
// key and nothing secret, because a GitHub Pages site is public even from a private repository (TRD, Web app).

export type Screen = 'invoices' | 'clients' | 'settings';

const hidden = new Set(
  (import.meta.env.VITE_HIDE_SCREENS ?? '')
    .split(',')
    .map((screen) => screen.trim().toLowerCase())
    .filter(Boolean),
);

export const config = {
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL ?? '',
  supabaseKey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '',
  supportEmail: import.meta.env.VITE_SUPPORT_EMAIL ?? '',
  base: import.meta.env.BASE_URL,
  /**
   * What the sign-in email holds. "code": a 6-digit code and a link (the production email template). "link": only a
   * link, as Supabase's built-in email sends on a new free project, whose templates can't be changed without custom
   * SMTP. The sign-in screen then leads with the link and takes a pasted one (web/README.md, "Sign-in email").
   */
  signInEmail: (import.meta.env.VITE_SIGN_IN_EMAIL === 'link' ? 'link' : 'code') as 'code' | 'link',
  /** The demonstration build's "Run it now" for Test data businesses (supabase/functions/demo-weekly-run). */
  demoTools: import.meta.env.VITE_DEMO_TOOLS === 'on',
} as const;

/** The navigation shows a screen only once it is built (App Flow; implementation plan): no link to an unbuilt screen. */
export const screenEnabled = (screen: Screen): boolean => !hidden.has(screen);
