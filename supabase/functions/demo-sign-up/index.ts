// Supabase Edge Function "demo-sign-up": the demonstration build's sign-up (handler.ts says who gets what).
// Deploy to the dev project only, with JWT checking off, because people use it before they have a session:
// supabase functions deploy demo-sign-up --no-verify-jwt (docs/runbook.md, "Week 7 demonstration").
import { handle } from './handler.ts';

type DenoLike = {
  serve(handler: (request: Request) => Response | Promise<Response>): unknown;
  env: { toObject(): Record<string, string> };
};

const deno = (globalThis as unknown as { Deno: DenoLike }).Deno;
deno.serve((request) => handle(request, deno.env.toObject()));
