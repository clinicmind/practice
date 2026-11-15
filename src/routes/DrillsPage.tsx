import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { DrillCard } from '../components/DrillCard';
import { loadModels, loadModule } from '../content/client';
import { LEVELS, type Level, type ModuleBundle } from '../content/schema';
import { en } from '../i18n/en';
import { itemMet } from '../progress/rules';
import type { Attempt, NewAttempt } from '../progress/types';
import { useStore } from '../StoreContext';

export function DrillsPage() {
  const { slug = '', level = '' } = useParams();
  const store = useStore();
  const [bundle, setBundle] = useState<ModuleBundle | null>(null);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [index, setIndex] = useState(0);
  const [error, setError] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let live = true;
    setError(false);
    Promise.all([loadModule(slug), store.listAttempts()])
      .then(([b, a]) => {
        if (!live) return;
        setBundle(b);
        setAttempts(a);
      })
      .catch(() => live && setError(true));
    return () => { live = false; };
  }, [slug, store, reload]);

  const submit = useCallback(
    async (a: NewAttempt) => {
      await store.saveAttempt(a);
      setAttempts(await store.listAttempts());
    },
    [store],
  );

  if (error) {
    return (
      <div>
        <p role="alert" className="error">{en.drillsPage.loadError}</p>
        <button type="button" className="btn" onClick={() => setReload((n) => n + 1)}>{en.common.retry}</button>
      </div>
    );
  }
  if (!bundle) return <p>{en.common.loading}</p>;

  const lv = level as Level;
  const drills = bundle.drills.filter((d) => d.level === (LEVELS.includes(lv) ? lv : undefined));
  const met = drills.filter((d) => itemMet(attempts, d.id)).length;
  const drill = drills[index];

  return (
    <div>
      <h1>{en.drillsPage.heading(en.levels[lv] ?? level)}</h1>
      <p aria-live="polite">{en.drillsPage.progress(met, drills.length)}</p>
      {drill ? (
        <>
          <p className="muted">{en.drill.questionOf(index + 1, drills.length)}</p>
          <DrillCard
            key={drill.id}
            drill={drill}
            attempts={attempts.filter((a) => a.itemId === drill.id)}
            onSubmit={submit}
            getModel={async () => {
              const models = await loadModels(slug);
              const m = models[drill.id];
              if (!m) throw new Error('missing model');
              return m;
            }}
            onNext={() => setIndex((i) => i + 1)}
          />
        </>
      ) : (
        <p>{en.drillsPage.levelDone}</p>
      )}
      <p><Link to={`/m/${slug}`}>{en.drillsPage.backToModule}</Link></p>
    </div>
  );
}
