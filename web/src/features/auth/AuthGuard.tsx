import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { Spinner } from '@/components/primitives';
import { useSession } from './useSession';

/** Gates the authenticated app. Redirects anonymous users to /login. */
export function AuthGuard() {
  const { user, isLoading } = useSession();
  const location = useLocation();

  if (isLoading) {
    return (
      <div
        style={{
          height: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--bg)',
        }}
      >
        <Spinner size={26} />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <Outlet />;
}
