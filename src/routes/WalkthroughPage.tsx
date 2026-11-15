import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { DecisionPointView } from '../components/DecisionPointView';
import { loadModule } from '../content/client';
import { isDecision, type ModuleBundle } from '../content/schema';
import { useT } from '../i18n';
import type { Decision, NewDecision } from '../progress/types';
import { useStore } from '../StoreContext';
import { NotFound } from './NotFound';

export function WalkthroughPage() {
  const s = useT();
  const t = s.walkthrough;
  const { slug = '', sessionId = '' } = useParams();
  const store = useStore();
  const [bundle, setBundle] = useState<ModuleBundle | null>(null);
  const [decisions, setDecisions] = useState<Decision[] | null>(null);
  const [error, setError] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let live = true;
    setError(false);
    Promise.all([loadModule(slug), store.listDecisions(sessionId)])
      .then(([b, d]) => {
        if (!live) return;
        setBundle(b);
        setDecisions(d);
      })
      .catch(() => live && setError(true));
    return () => { live = false; };
  }, [slug, sessionId, store, reload]);

  const answer = useCallback(
    async (d: NewDecision) => {
      await store.saveDecision(d);
      setDecisions(await store.listDecisions(sessionId));
    },
    [store, sessionId],
  );

  if (error) {
    return (
      <div>
        <p role="alert" className="error">{t.loadError}</p>
        <button type="button" className="btn" onClick={() => setReload((n) => n + 1)}>{s.common.retry}</button>
      </div>
    );
  }
  if (!bundle || !decisions) return <p>{s.common.loading}</p>;

  const session = bundle.sessions.find((s) => s.id === sessionId);
  if (!session) return <NotFound />;

  const answerOf = (id: string) => decisions.find((d) => d.sessionId === session.id && d.decisionId === id);
  // Show turns up to and including the first unanswered decision point; nothing after it is rendered.
  const firstOpen = session.turns.findIndex((x) => isDecision(x) && !answerOf(x.id));
  const visible = firstOpen === -1 ? session.turns : session.turns.slice(0, firstOpen + 1);
  const finished = firstOpen === -1;

  return (
    <div>
      <h1>{t.heading(session.title)}</h1>
      <ol className="turns">
        {visible.map((turn) => (
          <li key={turn.id}>
            {isDecision(turn) ? (
              <DecisionPointView
                sessionId={session.id}
                decision={turn}
                answer={answerOf(turn.id)}
                onAnswer={answer}
              />
            ) : (
              <p className={`turn turn-${turn.speaker}`}>
                <strong>{turn.speaker === 'therapist' ? t.speakerTherapist : t.speakerClient}:</strong> {turn.text}
              </p>
            )}
          </li>
        ))}
      </ol>
      {finished && (
        <section aria-labelledby="notes-h" className="card">
          <h2 id="notes-h">{t.notesHeading}</h2>
          <p><strong>{t.notesGoals}:</strong> {session.notes.goals}</p>
          <p><strong>{t.notesAlliance}:</strong> {session.notes.alliance}</p>
          <p><strong>{t.notesFormulation}:</strong> {session.notes.formulation_update}</p>
        </section>
      )}
      <p><Link to={`/m/${slug}`}>{t.backToModule}</Link></p>
    </div>
  );
}
