// Supabase Edge Function "billing-checkout": Stripe Checkout in test mode for the chosen plan (handler.ts).
// Deploy: supabase functions deploy billing-checkout (docs/runbook.md, "Plans and Stripe test mode").
import { denoServe } from '../_shared/owner.ts';
import { handle } from './handler.ts';

denoServe((request, env) => handle(request, env));
