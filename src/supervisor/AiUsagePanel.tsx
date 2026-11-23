import { useEffect, useId, useState } from 'react';
import { useT } from '../i18n';
import { budgetLevel, monthStartIso, percent, summarizeUsage, usd, type AiBudget, type UsageRow } from './aiUsage';
import { useSupervisorApi } from './SupervisorContext';

type State = { status: 'loading' } | { status: 'error' } | { status: 'ready'; rows: UsageRow[]; budget: AiBudget | null };

/**
 * This month's AI use and cost, against the owner's monthly limit. Counts the rows this supervisor can read
 * (their own cohorts), and says so. Money and counts only: ai_usage has no text. It fails on its own.
 */
export function AiUsagePanel() {
  const t = useT().aiFeedback.usage;
  const api = useSupervisorApi();
  const id = useId();
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    let live = true;
    Promise.all([api.listAiUsage(monthStartIso(new Date())), api.getAiBudget()])
      .then(([rows, budget]) => live && setState({ status: 'ready', rows, budget }))
      .catch(() => live && setState({ status: 'error' }));
    return () => { live = false; };
  }, [api]);

  return (
    <section aria-labelledby={id} className="card ai-supervisor">
      <h2 id={id}>{t.heading}</h2>
      {state.status === 'loading' && <p role="status">{t.loading}</p>}
      {state.status === 'error' && <p role="alert" className="error">{t.loadError}</p>}
      {state.status === 'ready' && <Body rows={state.rows} budget={state.budget} />}
    </section>
  );
}

function Body({ rows, budget }: { rows: UsageRow[]; budget: AiBudget | null }) {
  const t = useT().aiFeedback.usage;
  const sum = summarizeUsage(rows);
  const level = budgetLevel(sum.spent, budget);
  const share = budget && budget.monthlyLimitUsd > 0 ? Math.min(100, Math.round((sum.spent / budget.monthlyLimitUsd) * 100)) : 0;
  const cache = percent(sum.cacheHitRate);
  const dropped = percent(sum.discardedRate);
  return (
    <>
      <p className="muted">{t.scopeNote}</p>
      {level === 'unset' ? (
        <p role="status" className="notice">{t.budgetUnset}</p>
      ) : (
        <>
          <p><strong>{t.spent(usd(sum.spent), usd(budget!.monthlyLimitUsd))}</strong></p>
          <div className={level === 'exhausted' ? 'bar stopped' : level === 'warn' ? 'bar warn' : 'bar'}>
            <span style={{ width: `${share}%` }} role="progressbar" aria-label={t.barLabel} aria-valuemin={0} aria-valuemax={100} aria-valuenow={share} />
          </div>
          <p className="muted">{t.percent(share)}</p>
          {level === 'warn' && <p role="status" className="notice">{t.warn}</p>}
          {level === 'exhausted' && <p role="status" className="notice">{t.stopped}</p>}
        </>
      )}
      <ul className="plain">
        <li>{t.calls(sum.calls)}</li>
        <li>{t.kindPractice(sum.byKind.practice)}</li>
        <li>{t.kindReport(sum.byKind.report_draft)}</li>
        <li>{t.kindEval(sum.byKind.eval)}</li>
        <li>{t.cacheHit(cache ?? t.noData)}</li>
        <li>{t.discarded(dropped ?? t.noData)}</li>
      </ul>
    </>
  );
}
