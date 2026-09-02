import { redirect } from 'next/navigation';

/**
 * The root path has no content of its own. Middleware has already decided
 * whether there is a session, so by the time this renders the user is
 * authenticated and belongs on the dashboard.
 */
export default function RootPage() {
  redirect('/dashboard');
}
