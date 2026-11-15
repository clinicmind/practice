import { Link, useLocation } from 'react-router-dom';
import { en } from '../i18n/en';
import { useStageData } from '../useStageData';
import { ErrorBlock, lockedModuleNotice } from './ModuleGate';

export function StagePage() {
  const state = useStageData();
  const notice = (useLocation().state as { notice?: string } | null)?.notice;

  if (state.status === 'loading') return <p>{en.common.loading}</p>;
  if (state.status === 'error') return <ErrorBlock message={en.stage.loadError} onRetry={state.reload} />;
  const { data } = state;
  return (
    <div>
      <h1>{data.stage.title}</h1>
      {notice && <p role="status" className="notice">{notice}</p>}
      {data.visible.length === 0 ? (
        <p>{en.stage.empty}</p>
      ) : (
        <ol className="module-list">
          {data.visible.map((m) => (
            <li key={m.slug}>
              {m.lockedReason ? (
                <div className="locked">
                  <span className="module-title">{m.title}</span>{' '}
                  <span className="badge">{en.stage.locked}</span>
                  <p className="muted">{lockedModuleNotice(m)}</p>
                </div>
              ) : (
                <>
                  <Link to={`/m/${m.slug}`}>{m.title}</Link>
                  {m.unreviewed && <>{' '}<span className="badge">{en.stage.unreviewed}</span></>}
                </>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
