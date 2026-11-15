import { Link } from 'react-router-dom';
import { en } from '../i18n/en';

export function NotFound() {
  return (
    <div>
      <h1>{en.notFound.heading}</h1>
      <p>{en.notFound.body}</p>
      <p><Link to="/">{en.notFound.home}</Link></p>
    </div>
  );
}
