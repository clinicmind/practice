import { useEffect, useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { useT } from '../../i18n';
import type { CohortInfo, StudentSummary } from '../../supervisor/api';
import { riskOf, summarizeByStudent, type AiDisagreement, type AiEvaluation } from '../../supervisor/aiSummary';
import { useSupervisorApi } from '../../supervisor/SupervisorContext';

type State = { status: 'loading' } | { status: 'error' } | { status: 'ready'; evals: AiEvaluation[]; diffs: AiDisagreement[] };

/**
 * For a cohort whose AI switch is on: responses the AI marked as possible risk content (first), then where the AI and
 * the student's self-check disagree, by student. Reads ids and flags only. It fails on its own: an error here
 * leaves the rest of the class page working. The caller renders this only when the cohort's switch is on.
 */
export function AiCohortPanel({ cohort, students }: { cohort: CohortInfo; students: StudentSummary[] }) {
  const t = useT().aiFeedback.supervisor;
  const api = useSupervisorApi();
  const id = useId();
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    let live = true;
    setState({ status: 'loading' });
    Promise.all([api.listAiEvaluations(), api.listAiDisagreements()])
      .then(([evals, diffs]) => live && setState({ status: 'ready', evals, diffs }))
      .catch(() => live && setState({ status: 'error' }));
    return () => { live = false; };
  }, [api, cohort.id]);

  if (state.status === 'loading') return <p role="status">{t.loading}</p>;
  if (state.status === 'error') return <p role="alert" className="error">{t.loadError}</p>;

  const ids = students.map((s) => s.id);
  const name = (userId: string) => students.find((s) => s.id === userId)?.displayName ?? userId;
  const risk = riskOf(state.evals, ids);
  const rows = summarizeByStudent(state.evals, state.diffs, ids);
  return (
    <div className="ai-supervisor">
      <section aria-labelledby={`${id}-risk`}>
        <h3 id={`${id}-risk`}>{t.riskHeading}</h3>
        {risk.length === 0 ? (
          <p className="muted">{t.riskNone}</p>
        ) : (
          <ul className="plain">
            {risk.map((e) => (
              <li key={e.attemptId}>
                <span className="badge risk">{t.riskFlag}</span>{' '}
                <Link to={`/supervisor/students/${e.userId}`}>{t.riskItem(name(e.userId), e.itemId)}</Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby={`${id}-diff`}>
        <h3 id={`${id}-diff`}>{t.heading}</h3>
        <p className="muted">{t.intro}</p>
        {rows.length === 0 ? (
          <p>{t.none}</p>
        ) : (
          <div className="table-scroll">
            <table>
              <caption className="visually-hidden">{t.caption}</caption>
              <thead>
                <tr>
                  <th scope="col">{t.colStudent}</th>
                  <th scope="col">{t.colTotal}</th>
                  <th scope="col">{t.colSelfOnly}</th>
                  <th scope="col">{t.colAiOnly}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.userId}>
                    <th scope="row"><Link to={`/supervisor/students/${r.userId}`}>{name(r.userId)}</Link></th>
                    <td>{r.checked}</td>
                    <td>{r.selfOnly}</td>
                    <td>{r.aiOnly}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
