import { Link, Navigate, useLocation } from 'react-router-dom';
import { useT } from '../i18n';
import { DEFAULT_STAGE, modulePath } from '../stages';
import { useStageData } from '../useStageData';
import { NotFound } from './NotFound';
import { ErrorBlock, lockedModuleNotice } from './ModuleGate';

export function StagePage() {
  const s = useT();
  const state = useStageData();
  const notice = (useLocation().state as { notice?: string } | null)?.notice;

  if (state.status === 'loading') return <p>{s.common.loading}</p>;
  if (state.status === 'notfound') return <NotFound />;
  if (state.status === 'locked') return <Navigate to="/" replace state={{ notice: s.stage.stageNotOpenNotice }} />;
  if (state.status === 'error') return <ErrorBlock message={s.stage.loadError} onRetry={state.reload} />;
  const { data } = state;
  // The furthest module the student can open is where they will most likely want to go.
  const nextUp = [...data.visible].reverse().find((m) => !m.lockedReason)?.slug;
  return (
    <div>
      <h1>{data.stage.title}</h1>
      {data.stage.stage === DEFAULT_STAGE && <p className="lede">{s.stage.lede}</p>}
      {data.stage.notice && <aside className="stage-note" aria-label={s.eft.noticeLabel}><p>{data.stage.notice}</p></aside>}
      {notice && <p role="status" className="notice">{notice}</p>}
      {data.visible.length === 0 ? (
        <p>{s.stage.empty}</p>
      ) : (
        <ol className="module-list arc">
          {data.visible.map((m, i) => (
            <li key={m.slug} className={m.lockedReason ? 'arc-locked' : m.slug === nextUp ? 'arc-next' : 'arc-open'}>
              <span className="arc-step" aria-hidden="true">{i + 1}</span>
              {m.lockedReason ? (
                <div className="locked">
                  <span className="module-title">{m.title}</span>{' '}
                  <span className="badge">{s.stage.locked}</span>
                  <p className="muted">{lockedModuleNotice(m, s)}</p>
                </div>
              ) : (
                <>
                  <Link className="module-title" to={modulePath(data.stage.stage, m.slug)}>{m.title}</Link>
                  {m.slug === nextUp && <>{' '}<span className="badge next">{s.stage.nextUp}</span></>}
                  {m.unreviewed && <>{' '}<span className="badge">{s.stage.unreviewed}</span></>}
                </>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
