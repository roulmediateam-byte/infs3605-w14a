/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  readonly VITE_SUPPORT_EMAIL?: string;
  readonly VITE_HIDE_SCREENS?: string;
  readonly VITE_BACKEND?: 'supabase' | 'preview';
  /** "link" when the project's sign-in email carries only a link (Supabase's built-in email); otherwise "code". */
  readonly VITE_SIGN_IN_EMAIL?: string;
  /** "on" in the demonstration build: the owner of a Test data business can run Sunday's drafting now. */
  readonly VITE_DEMO_TOOLS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
