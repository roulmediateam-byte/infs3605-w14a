// Supabase Edge Function "demo-weekly-run": the demonstration build's "Run it now" (handler.ts says who may run it).
// Deploy: supabase functions deploy demo-weekly-run (docs/runbook.md, "Week 7 demonstration").
import { handle } from './handler.ts';

type DenoLike = {
  serve(handler: (request: Request) => Response | Promise<Response>): unknown;
  env: { toObject(): Record<string, string> };
};

const deno = (globalThis as unknown as { Deno: DenoLike }).Deno;
deno.serve((request) => handle(request, deno.env.toObject()));
