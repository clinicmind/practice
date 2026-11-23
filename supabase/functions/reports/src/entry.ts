import { handleRequest } from './handler';

declare const Deno: { serve(h: (r: Request) => Response | Promise<Response>): void; env: { toObject(): Record<string, string> } } | undefined;

// Supabase gives the function SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY by itself.
// The Google values are secrets the owner sets in the Supabase page (see docs/SETUP-reports.md).
if (typeof Deno !== 'undefined') {
  Deno.serve((req) => handleRequest(req, Deno!.env.toObject(), fetch));
}
