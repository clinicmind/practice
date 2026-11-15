/** One segment per question. Decorative: the count is always given in text beside it. */
export function Meter({ met, total }: { met: number; total: number }) {
  return (
    <span className="meter" aria-hidden="true">
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={i < met ? 'seg on' : 'seg'} />
      ))}
    </span>
  );
}
