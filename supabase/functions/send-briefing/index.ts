// Supabase Edge Function "send-briefing": the Monday briefing by email, now, to the signed-in owner (handler.ts).
// Deploy: supabase functions deploy send-briefing (docs/runbook.md, "Briefing emails through Resend").
import { denoServe } from '../_shared/owner.ts';
import { handle } from './handler.ts';

denoServe((request, env) => handle(request, env));
