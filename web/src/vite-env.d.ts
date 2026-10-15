/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  readonly VITE_SUPPORT_EMAIL?: string;
  readonly VITE_HIDE_SCREENS?: string;
  readonly VITE_BACKEND?: 'supabase' | 'preview';
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
