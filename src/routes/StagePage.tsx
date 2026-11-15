import { Link, useLocation } from 'react-router-dom';
import { useT } from '../i18n';
import { useStageData } from '../useStageData';
import { ErrorBlock, lockedModuleNotice } from './ModuleGate';

export function StagePage() {
  const s = useT();
  const state = useStageData();
  const notice = (useLocation().state as { notice?: string } | null)?.notice;

  if (state.status === 'loading') return <p>{s.common.loading}</p>;
  if (state.status === 'error') return <ErrorBlock message={s.stage.loadError} onRetry={state.reload} />;
  const { data } = state;
  return (
    <div>
      <h1>{data.stage.title}</h1>
      {notice && <p role="status" className="notice">{notice}</p>}
      {data.visible.length === 0 ? (
        <p>{s.stage.empty}</p>
      ) : (
        <ol className="module-list">
          {data.visible.map((m) => (
            <li key={m.slug}>
              {m.lockedReason ? (
                <div className="locked">
                  <span className="module-title">{m.title}</span>{' '}
                  <span className="badge">{s.stage.locked}</span>
                  <p className="muted">{lockedModuleNotice(m, s)}</p>
                </div>
              ) : (
                <>
                  <Link to={`/m/${m.slug}`}>{m.title}</Link>
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
