import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useT } from '../i18n';
import type { Reflection } from '../progress/types';
import { modulePath } from '../stages';
import { useStore } from '../StoreContext';
import { FallbackNotice, useGate } from './ModuleGate';

function PromptForm({ promptId, text, entries, onSave }: {
  promptId: string; text: string; entries: Reflection[]; onSave: (promptId: string, value: string) => Promise<void>;
}) {
  const s = useT();
  const t = s.reflect;
  const [value, setValue] = useState('');
  const [error, setError] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const id = `reflect-${promptId}`;
  const sorted = [...entries].reverse().sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));

  async function submit() {
    if (saving) return;
    setSaving(true);
    setError(false);
    setSaved(false);
    try {
      await onSave(promptId, value);
      setValue('');
      setSaved(true);
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  }
  return (
    <section className="card">
      <label htmlFor={id}>{text}</label>
      <textarea id={id} rows={4} value={value} onChange={(e) => setValue(e.target.value)} />
      {error && <p role="alert" className="error">{t.saveError}</p>}
      {saved && <p role="status">{t.saved}</p>}
      <button type="button" className="btn primary" disabled={value.trim().length === 0 || saving} onClick={() => void submit()}>
        {t.save}
      </button>
      {sorted.length > 0 && (
        <ul aria-label={t.earlier(text)} className="attempt-list">
          {sorted.map((r) => (
            <li key={r.id}>
              <time dateTime={r.createdAt} className="muted">{new Date(r.createdAt).toLocaleString()}</time>
              <br />
              {r.text}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function ReflectPage() {
  const s = useT();
  const t = s.reflect;
  const { stage, slug, bundle } = useGate();
  const store = useStore();
  const [entries, setEntries] = useState<Reflection[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    store.listReflections(slug).then((r) => live && setEntries(r), () => live && setFailed(true));
    return () => { live = false; };
  }, [store, slug]);

  async function save(promptId: string, value: string) {
    await store.saveReflection({ moduleSlug: slug, promptId, text: value });
    setEntries(await store.listReflections(slug));
  }

  if (failed) return <p role="alert" className="error">{t.saveError}</p>;
  if (!entries) return <p>{s.common.loading}</p>;
  return (
    <div>
      <h1>{t.heading(bundle.meta.title)}</h1>
      <FallbackNotice />
      {bundle.meta.reflection_prompts.map((p) => (
        <PromptForm key={p.id} promptId={p.id} text={p.text} entries={entries.filter((e) => e.promptId === p.id)} onSave={save} />
      ))}
      <p><Link to={modulePath(stage, slug)}>{t.backToModule}</Link></p>
    </div>
  );
}
