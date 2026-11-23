import { createAnthropicClient, LlmError, newNonce, type LlmClient } from '../../../../packages/ai-feedback/src';
import { handleRequest } from './handler';

declare const Deno: { serve(h: (r: Request) => Response | Promise<Response>): void; env: { toObject(): Record<string, string> } } | undefined;

// Supabase gives the function SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY by itself.
// The owner sets SITE_URL, ANTHROPIC_API_KEY and the three GOOGLE_* secrets (the same ones as the `reports` function)
// in the function's secrets (see docs/SETUP-ai.md). A missing key is not an error here: every call that would
// need it fails as "unavailable", and nothing is billed.
if (typeof Deno !== 'undefined') {
  Deno.serve((req) => {
    const env = Deno!.env.toObject();
    const llm: LlmClient = env.ANTHROPIC_API_KEY
      ? createAnthropicClient({ apiKey: env.ANTHROPIC_API_KEY, fetchFn: fetch, timeoutMs: 90_000 })
      : { complete: () => Promise.reject(new LlmError('auth')) };
    return handleRequest(req, env, { fetchFn: fetch, llm, nonce: newNonce });
  });
}

// Exported so the build test can check that the bundle behaves like the original.
export { handleRequest } from './handler';
export { checkReportOutput, guardReport, buildReportRequest } from '../../../../packages/ai-feedback/src';
