import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useT } from '../i18n';
import { loadReviewLog, pickReviewItems } from './review';
import { useCourse } from './useCourse';

/** Student home page: the mixed review card (only when something is due) and a link to the supervision prep sheet. */
export function HomeCards() {
  const s = useT();
  const x = s.practiceExtras;
  const { status } = useAuth();
  const course = useCourse();
  const due = useMemo(() => {
    if (course.status !== 'ready') return [];
    const { items, attempts } = course.data;
    return pickReviewItems({
      candidates: items.map((i) => ({ itemId: i.drill.id, moduleKey: `${i.stage}/${i.slug}` })),
      attempts, log: loadReviewLog(), now: new Date(),
    });
  }, [course]);
  // Supervisors are not students: they have nothing of their own to review.
  if (status !== 'student' && status !== 'local') return null;
  return (
    <div className="extras-home">
      {due.length > 0 && (
        <section className="card" aria-labelledby="review-card">
          <h2 id="review-card" style={{ marginTop: 0 }}>{x.review.cardHeading}</h2>
          <p>{x.review.cardText(due.length)}</p>
          <Link className="btn primary" to="/review" style={{ display: 'inline-block', textDecoration: 'none', lineHeight: '1.9' }}>{x.review.start}</Link>
        </section>
      )}
      <p><Link to="/supervision-prep">{x.prep.nav}</Link></p>
    </div>
  );
}
