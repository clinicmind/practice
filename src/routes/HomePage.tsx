import { Suspense } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useExtrasEnabled } from '../extras/ExtrasContext';
import { LazyHomeCards } from '../extras/lazy';
import { useT } from '../i18n';
import { stagePath } from '../stages';
import { useStageList } from '../useStageList';
import { ErrorBlock } from './ModuleGate';
import { StagePage } from './StagePage';

/**
 * With one stage the home page is that stage's page, exactly as before stages existed.
 * With more, it lists them.
 */
export function HomePage() {
  const s = useT();
  const state = useStageList();
  const notice = (useLocation().state as { notice?: string } | null)?.notice;
  const extras = useExtrasEnabled();
  const cards = extras && LazyHomeCards ? <Suspense fallback={null}><LazyHomeCards /></Suspense> : null;
  if (state.status === 'loading') return <p>{s.common.loading}</p>;
  if (state.status === 'error') return <ErrorBlock message={s.stage.loadError} onRetry={state.reload} />;
  if (state.entries.length <= 1) return <StagePage extra={cards} />;

  const nextUp = [...state.entries].reverse().find((e) => e.open)?.stage;
  return (
    <div>
      <h1>{s.stage.listHeading}</h1>
      <p className="lede">{s.stage.listLede}</p>
      {notice && <p role="status" className="notice">{notice}</p>}
      {cards}
      <ol className="module-list arc">
        {state.entries.map((e, i) => (
          <li key={e.stage} className={!e.open ? 'arc-locked' : e.stage === nextUp ? 'arc-next' : 'arc-open'}>
            <span className="arc-step" aria-hidden="true">{i + 1}</span>
            {e.open ? (
              <>
                <Link className="module-title" to={stagePath(e.stage)}>{e.title}</Link>
                {e.unreviewed && <>{' '}<span className="badge">{s.stage.unreviewed}</span></>}
              </>
            ) : (
              <div className="locked">
                <span className="module-title">{e.title}</span>{' '}
                <span className="badge">{s.stage.locked}</span>
                <p className="muted">{s.stage.stageNotOpen}</p>
              </div>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
