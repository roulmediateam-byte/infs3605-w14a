import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import { appShell, previewEngine } from './build/plugins.ts';

// BASE_PATH is where the build is served: "/" locally, "/<repository>/" on GitHub Pages and
// "/<repository>/demo/" for the demonstration build (TRD, Environments and release).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const preview = env.VITE_BACKEND === 'preview';
  return {
    // The preview is published as an artifact, so every path is relative to its page.
    base: preview ? './' : env.BASE_PATH || '/',
    resolve: {
      alias: {
        // One backend per build, so the preview build carries no Supabase client and the real one no database engine.
        '@backend': path.resolve(import.meta.dirname, preview ? 'src/backend/preview.ts' : 'src/backend/supabase.ts'),
      },
    },
    plugins: [
      react(),
      preview
        ? previewEngine()
        : appShell({
            supabaseUrl: env.VITE_SUPABASE_URL,
            subApps: (env.SUB_APPS ?? '').split(',').map((app) => app.trim()).filter(Boolean),
          }),
    ],
    build: {
      target: 'es2022',
      sourcemap: false,
      reportCompressedSize: true,
      // The budget that matters is compressed JavaScript at first load, checked by scripts/check-size.ts (200 KB).
      chunkSizeWarningLimit: 700,
    },
    worker: { format: 'es' },
    // Pre-bundle the worker's dependency, so the dev server doesn't reload the page the first time a file is read.
    optimizeDeps: { include: ['papaparse'], exclude: ['@electric-sql/pglite'] },
    // The preview reads the migrations and seed from the repository, one folder up.
    server: { host: '127.0.0.1', port: 5173, strictPort: true, fs: { allow: ['..'] } },
    preview: { host: '127.0.0.1', port: 4173, strictPort: true },
  };
});
