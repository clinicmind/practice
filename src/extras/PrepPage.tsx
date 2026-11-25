import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useT } from '../i18n';
import { itemMet } from '../progress/rules';
import type { Attempt, Reflection } from '../progress/types';
import { ErrorBlock } from '../routes/ModuleGate';
import { useCourse, type CourseData, type OpenItem } from './useCourse';

export const MAX_PREP_ITEMS = 3;

function latestAttempt(attempts: Attempt[], itemId: string): Attempt | undefined {
  let best: Attempt | undefined;
  for (const a of attempts) if (a.itemId === itemId && (!best || a.createdAt >= best.createdAt)) best = a;
  return best;
}

/** Finished questions (latest attempt counts as met), in course order. */
export function finishedItems(data: CourseData): OpenItem[] {
  return data.items.filter((i) => itemMet(data.attempts, i.drill.id));
}

/** Reflections whose module and prompt are in the course the student can open. */
export function usableReflections(data: CourseData): { r: Reflection; prompt: string; moduleTitle: string }[] {
  const out: { r: Reflection; prompt: string; moduleTitle: string }[] = [];
  const bySlug = new Map<string, OpenItem>();
  for (const i of data.items) if (!bySlug.has(i.slug)) bySlug.set(i.slug, i);
  for (const r of data.reflections) {
    const m = bySlug.get(r.moduleSlug);
    const p = m?.bundle.meta.reflection_prompts.find((x) => x.id === r.promptId);
    if (m && p && r.text.trim()) out.push({ r, prompt: p.text, moduleTitle: m.moduleTitle });
  }
  return out.sort((a, b) => (a.r.createdAt < b.r.createdAt ? 1 : -1));
}

/**
 * Pick up to 3 finished questions and 1 reflection; get a sheet laid out like the supervision prep workbook
 * (what I practised this week / what I tried / what I want to practise in supervision), to print or save as PDF.
 * Nothing about the account is shown, and nothing here is saved.
 */
export function PrepPage() {
  const s = useT();
  const t = s.practiceExtras.prep;
  const state = useCourse();
  const [chosen, setChosen] = useState<string[]>([]);
  const [reflectionId, setReflectionId] = useState<string | null>(null);

  if (state.status === 'loading') return <p>{s.common.loading}</p>;
  if (state.status === 'error') return <ErrorBlock message={t.loadError} onRetry={state.reload} />;
  const { data } = state;
  const items = finishedItems(data);
  const reflections = usableReflections(data);
  const picked = items.filter((i) => chosen.includes(i.drill.id));
  const reflection = reflections.find((x) => x.r.id === reflectionId);
  const full = chosen.length >= MAX_PREP_ITEMS;

  return (
    <div>
      <div className="no-print">
        <h1>{t.heading}</h1>
        <p className="lede">{t.intro}</p>
        <section aria-labelledby="prep-items">
          <h2 id="prep-items">{t.itemsHeading}</h2>
          {items.length === 0 ? (
            <p className="muted">{t.noItems}</p>
          ) : (
            <fieldset>
              <legend>{t.itemsCount(chosen.length)}</legend>
              <ul className="prep-pick">
                {items.map((i) => {
                  const on = chosen.includes(i.drill.id);
                  return (
                    <li key={i.drill.id}>
                      <label className="check">
                        <input
                          type="checkbox" checked={on} disabled={!on && full}
                          onChange={(e) => setChosen(e.target.checked ? [...chosen, i.drill.id] : chosen.filter((x) => x !== i.drill.id))}
                        />
                        <span><span className="muted">{i.moduleTitle}</span><br />“{i.drill.client}”</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
              {full && <p className="muted" role="status">{t.itemsFull}</p>}
            </fieldset>
          )}
        </section>
        <section aria-labelledby="prep-refl">
          <h2 id="prep-refl">{t.reflectionsHeading}</h2>
          {reflections.length === 0 ? (
            <p className="muted">{t.noReflections}</p>
          ) : (
            <fieldset>
              <legend className="visually-hidden">{t.reflectionsHeading}</legend>
              <label className="check">
                <input type="radio" name="prep-reflection" checked={reflectionId === null} onChange={() => setReflectionId(null)} />
                <span>{t.noReflectionChoice}</span>
              </label>
              {reflections.map(({ r, prompt, moduleTitle }) => (
                <label key={r.id} className="check">
                  <input type="radio" name="prep-reflection" checked={reflectionId === r.id} onChange={() => setReflectionId(r.id)} />
                  <span><span className="muted">{moduleTitle}: {prompt}</span><br />{r.text}</span>
                </label>
              ))}
            </fieldset>
          )}
        </section>
        <h2>{t.previewHeading}</h2>
        {picked.length === 0 && !reflection && <p className="muted">{t.nothingChosen}</p>}
        <p><button type="button" className="btn primary" onClick={() => window.print()}>{t.print}</button></p>
      </div>

      <article className="prep-sheet" aria-labelledby="sheet-title">
        <h2 id="sheet-title">{t.sheet.title}</h2>
        <h3 id="sheet-practised">{t.sheet.practised}</h3>
        {picked.map((i) => {
          const a = latestAttempt(data.attempts, i.drill.id);
          return (
            <div key={i.drill.id} className="prep-entry">
              <p className="muted"><strong>{t.sheet.situation}:</strong> {i.drill.context}</p>
              <p><strong>{t.sheet.clientSays}:</strong> “{i.drill.client}”</p>
              <p><strong>{t.sheet.myResponse}:</strong></p>
              <blockquote>{a?.response}</blockquote>
              {a && <p className="muted">{t.sheet.selfCheck(a.criteriaMet.filter(Boolean).length)}</p>}
            </div>
          );
        })}
        {reflection && (
          <div className="prep-entry">
            <p className="muted"><strong>{t.sheet.reflectionPrompt}:</strong> {reflection.prompt}</p>
            <p><strong>{t.sheet.myReflection}:</strong></p>
            <blockquote>{reflection.r.text}</blockquote>
          </div>
        )}
        <h3 id="sheet-tried">{t.sheet.tried}</h3>
        <textarea className="prep-blank" aria-labelledby="sheet-tried" rows={7} />
        <h3 id="sheet-to">{t.sheet.toPractise}</h3>
        <textarea className="prep-blank" aria-labelledby="sheet-to" rows={7} />
      </article>
      <p className="no-print"><Link to="/">{s.notFound.home}</Link></p>
    </div>
  );
}
