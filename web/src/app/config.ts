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
} as const;

/** The navigation shows a screen only once it is built (App Flow; implementation plan): no link to an unbuilt screen. */
export const screenEnabled = (screen: Screen): boolean => !hidden.has(screen);
