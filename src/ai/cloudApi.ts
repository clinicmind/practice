import { AiError, type AiFeedbackClient, type AiLocale, type AiOutput, type AiResult } from './AiContext';

/**
 * The real client: the `ai-feedback` Edge Function. Only loaded when the build turns AI feedback on,
 * so the normal build does not contain it. The student's own session token is sent, never a service key.
 * Only the attempt id and the language go out; the function reads the response from the database itself.
 */
export type AiCloudDeps = {
  url: string;
  anonKey: string;
  getToken: () => Promise<string | null>;
  fetch?: typeof fetch;
};

const isOutput = (o: unknown): o is AiOutput => {
  const x = o as AiOutput | null;
  return !!x && Array.isArray(x.criteria) && x.criteria.length === 3
    && x.criteria.every((c) => typeof c?.met === 'boolean' && typeof c?.evidence === 'string')
    && typeof x.suggestion === 'string';
};

/** Turns the function's reply into a result, or null for "nothing stored yet". Anything unexpected is `unavailable`. */
function parse(status: number, body: Record<string, unknown>): AiResult | null {
  if (status === 200) {
    if (body.status === 'none') return null;
    if (body.status === 'concern' && (body.concern === 'risk-content' || body.concern === 'off-task')) return { status: 'concern', concern: body.concern };
    if (body.status === 'ok' && isOutput(body.output)) {
      const warnings = Array.isArray(body.warnings) ? (body.warnings as { criterion?: unknown; kind?: unknown }[]) : [];
      const unsupported = warnings.filter((w) => w.kind === 'unsupported' && typeof w.criterion === 'number').map((w) => w.criterion as number);
      return { status: 'ok', output: body.output, unsupported };
    }
    throw new AiError('unavailable');
  }
  throw new AiError(typeof body.error === 'string' ? body.error : 'unavailable');
}

export function createCloudAiClient(deps: AiCloudDeps): AiFeedbackClient {
  async function call(action: 'get' | 'practice', attemptId: string, locale: AiLocale): Promise<AiResult | null> {
    const token = await deps.getToken();
    if (!token) throw new AiError('unauthorized');
    let res: Response;
    try {
      res = await (deps.fetch ?? fetch)(`${deps.url}/functions/v1/ai-feedback`, {
        method: 'POST',
        headers: { apikey: deps.anonKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, attempt_id: attemptId, locale }),
      });
    } catch {
      throw new AiError('unavailable');
    }
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return parse(res.status, body);
  }
  return {
    get: (id, locale) => call('get', id, locale),
    async request(id, locale) {
      const r = await call('practice', id, locale);
      if (!r) throw new AiError('unavailable');
      return r;
    },
  };
}
