import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { APP_NAME } from '@iris/shared';
import { Button, Field, Input } from '@/components/primitives';
import { IrisMark } from '@/components/icons';
import { ApiError } from '@/lib/api';
import { authApi, startGoogleSignIn } from './api';
import { sessionKey, useAuthProviders } from './useSession';
import styles from './Login.module.css';

const ERROR_COPY: Record<string, string> = {
  signin_failed: 'Google sign-in could not be completed. Please try again.',
  state_mismatch: 'Your sign-in session expired. Please try again.',
  expired: 'Your sign-in session expired. Please try again.',
  access_denied: 'Sign-in was cancelled.',
};

export function Login() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const { data: providers } = useAuthProviders();

  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const urlError = params.get('error');

  const mutation = useMutation({
    mutationFn: () =>
      mode === 'login' ? authApi.login(email, password) : authApi.register(name, email, password),
    onSuccess: (data) => {
      qc.setQueryData(sessionKey, { user: data.user });
      navigate('/', { replace: true });
    },
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    mutation.mutate();
  };

  const formError =
    mutation.error instanceof ApiError ? mutation.error.message : urlError ? (ERROR_COPY[urlError] ?? 'Sign-in failed.') : null;

  return (
    <div className={styles.screen}>
      <div className={styles.card}>
        <div className={styles.mark}>
          <IrisMark size={28} />
        </div>
        <h1 className={styles.title}>Sign in to {APP_NAME}</h1>
        <p className={styles.subtitle}>Your executive intelligence layer.</p>

        {formError && <div className={styles.error}>{formError}</div>}

        {providers?.google && (
          <button className={styles.google} onClick={startGoogleSignIn} type="button">
            <GoogleGlyph />
            Continue with Google
          </button>
        )}

        {providers?.google && providers?.password && <div className={styles.divider}><span>or</span></div>}

        {providers?.password && (
          <form className={styles.form} onSubmit={onSubmit}>
            {mode === 'register' && (
              <Field label="Name" htmlFor="name">
                <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" />
              </Field>
            )}
            <Field label="Email" htmlFor="email">
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </Field>
            <Field label="Password" htmlFor="password">
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                minLength={8}
              />
            </Field>
            <Button type="submit" block loading={mutation.isPending}>
              {mode === 'login' ? 'Sign in' : 'Create account'}
            </Button>
            <button
              type="button"
              className={styles.switch}
              onClick={() => setMode((m) => (m === 'login' ? 'register' : 'login'))}
            >
              {mode === 'login' ? 'New here? Create an account' : 'Have an account? Sign in'}
            </button>
          </form>
        )}

        {!providers?.google && !providers?.password && (
          <p className={styles.unconfigured}>
            No sign-in method is configured yet. Set <code>GOOGLE_CLIENT_ID</code> / <code>GOOGLE_CLIENT_SECRET</code>
            (or enable password auth) and restart the server.
          </p>
        )}

        <div className={styles.footnote}>End-to-end encrypted · isolated workspace · you control every action</div>
      </div>
    </div>
  );
}

function GoogleGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.9 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34.5 6.1 29.5 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16 19 12 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7C34.5 6.1 29.5 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.5-5.2l-6.2-5.3C29.2 35 26.7 36 24 36c-5.3 0-9.7-3.1-11.3-7.5l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4 5.5l6.2 5.3C41.4 35.6 44 30.3 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}
