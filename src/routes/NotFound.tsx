import { Link } from 'react-router-dom';
import { useT } from '../i18n';

export function NotFound() {
  const s = useT();
  return (
    <div>
      <h1>{s.notFound.heading}</h1>
      <p>{s.notFound.body}</p>
      <p><Link to="/">{s.notFound.home}</Link></p>
    </div>
  );
}
